import {
  AuthorizationError,
  OAuthAuthorizationServer,
} from '@cloudflare/workers-oauth-provider'
import { choosePage, errorPage, newCodePage, PAGE_HEADERS } from './pages.ts'
import type { VaultApi } from './vault.ts'
import {
  keysFromCode,
  newRecoveryCode,
  newWalletKey,
  normalizeRecoveryCode,
  unwrapWalletKey,
  wrapWalletKey,
} from './vault-crypto.ts'

export const ORIGIN = 'https://mcp.earnrate.dev'
export const RESOURCE = `${ORIGIN}/mcp`
export const SCOPE = 'wallet'
const METADATA_URL = `${ORIGIN}/.well-known/oauth-protected-resource/mcp`
const DAY = 24 * 60 * 60

// What a grant carries, encrypted by the OAuth library for the token holder.
export type Grant = { walletId: string; walletKey: string }

export type AuthEnv = { OAUTH_KV: unknown }

export type VaultFor<Env> = (env: Env, walletId: string) => VaultApi

export function protectedResourceMetadata(): Response {
  return Response.json({
    resource: RESOURCE,
    authorization_servers: [ORIGIN],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'earnrate',
    resource_documentation: 'https://earnrate.dev/',
  })
}

// Sends the client to sign in. Claude asks only when a tool needs it.
export function challenge(invalidToken = false): Response {
  const params = [
    ...(invalidToken ? ['error="invalid_token"'] : []),
    `resource_metadata="${METADATA_URL}"`,
    `scope="${SCOPE}"`,
  ]
  return Response.json(
    {
      error: invalidToken ? 'invalid_token' : 'unauthorized',
      error_description: invalidToken
        ? 'Sign in again to use your saved wallet.'
        : 'Connect a saved wallet to use this tool.',
    },
    {
      status: 401,
      headers: { 'WWW-Authenticate': `Bearer ${params.join(', ')}` },
    },
  )
}

function html(body: string, status = 200, extra?: Headers): Response {
  const headers = new Headers(extra)
  for (const [k, v] of Object.entries(PAGE_HEADERS)) headers.set(k, v)
  return new Response(body, { status, headers })
}

export function makeAuth<Env extends AuthEnv>(vaultFor: VaultFor<Env>) {
  const server = new OAuthAuthorizationServer<Env>({
    issuer: ORIGIN,
    resources: [RESOURCE],
    scopesSupported: [SCOPE],
    clientIdMetadataDocumentEnabled: true,
    clientRegistrationEndpoint: '/oauth/register',
    accessTokenTTL: 60 * 60,
    // Stays signed in while used; 90 idle days ends it.
    refreshTokenTTL: 90 * DAY,
    refreshTokenIdleTTL: 90 * DAY,
  })

  async function validate(env: Env, token: string): Promise<Grant | null> {
    const found = await server.validateToken<Grant>(RESOURCE, token, env)
    return found?.scope.includes(SCOPE) ? found.props : null
  }

  async function signOutEverywhere(env: Env, walletId: string) {
    const oauth = server.getOAuthApi(env)
    let cursor: string | undefined
    do {
      const page = await oauth.listUserGrants(
        walletId,
        cursor ? { cursor } : {},
      )
      for (const grant of page.items)
        await oauth.revokeGrant(grant.id, walletId)
      cursor = page.cursor
    } while (cursor)
  }

  // Shows the page again after a wrong code. The form posts back to the
  // authorize URL, so its query still describes the request.
  async function chooseAgain(
    env: Env,
    request: Request,
    handle: string,
    error: string,
  ): Promise<Response> {
    const oauth = server.getOAuthApi(env)
    const again = await oauth.parseAuthRequest(
      new Request(request.url, { method: 'GET' }),
    )
    return html(
      choosePage(await oauth.describeConsent(again), handle, error),
      400,
    )
  }

  async function authorizePage(request: Request, env: Env): Promise<Response> {
    const oauth = server.getOAuthApi(env)
    if (request.method === 'GET') {
      const parsed = await oauth.parseAuthRequest(request)
      const details = await oauth.describeConsent(parsed)
      const consent = await oauth.beginConsent(parsed)
      return html(choosePage(details, consent.handle), 200, consent.headers)
    }
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405 })

    const form = await request.formData()
    const field = (name: string) => {
      const value = form.get(name)
      return typeof value === 'string' ? value : ''
    }
    const handle = field('handle')
    const choice = form.get('choice')

    if (choice === 'deny') {
      const denied = await oauth.denyConsent(request, handle)
      return new Response(null, { status: 302, headers: denied.headers })
    }

    if (choice === 'new') {
      const approved = await oauth.approveConsent(request, handle, {
        scope: [SCOPE],
      })
      const code = newRecoveryCode()
      const keys = await keysFromCode(code)
      const walletKey = newWalletKey()
      const created = await vaultFor(env, keys.walletId).create(
        keys.walletId,
        await wrapWalletKey(walletKey, keys),
      )
      if (!created)
        return html(errorPage("Couldn't start a wallet. Try again."), 500)
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: keys.walletId,
        metadata: {},
        scope: [SCOPE],
        props: { walletId: keys.walletId, walletKey } satisfies Grant,
      })
      return html(newCodePage(code, redirectTo), 200, approved.headers)
    }

    if (choice === 'recover') {
      const code = normalizeRecoveryCode(field('code'))
      if (!code)
        return chooseAgain(
          env,
          request,
          handle,
          "That isn't a recovery code. It's 25 letters and digits, like ABCDE-12345-…",
        )
      const keys = await keysFromCode(code)
      const wrapped = await vaultFor(env, keys.walletId).wrappedKey()
      const walletKey = wrapped && (await unwrapWalletKey(wrapped, keys))
      if (!walletKey)
        return chooseAgain(
          env,
          request,
          handle,
          'No saved wallet matches that recovery code.',
        )
      const approved = await oauth.approveConsent(request, handle, {
        scope: [SCOPE],
      })
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: keys.walletId,
        metadata: {},
        scope: [SCOPE],
        props: { walletId: keys.walletId, walletKey } satisfies Grant,
      })
      approved.headers.set('Location', redirectTo)
      return new Response(null, { status: 302, headers: approved.headers })
    }

    return html(errorPage('Choose to start a wallet or connect one.'), 400)
  }

  async function authorize(request: Request, env: Env): Promise<Response> {
    try {
      return await authorizePage(request, env)
    } catch (e) {
      if (!(e instanceof AuthorizationError)) throw e
      if (e.redirectTo) return Response.redirect(e.redirectTo, 302)
      return html(errorPage(e.description), 400)
    }
  }

  return {
    authorize,
    validate,
    signOutEverywhere,
    fetch: (request: Request, env: Env, ctx: ExecutionContextLike) =>
      server.fetch(request, env, ctx as never),
  }
}

export type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void
}
