import {
  AuthorizationError,
  OAuthAuthorizationServer,
  type AuthRequest,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider'
import {
  changeCodePage,
  changedCodePage,
  choosePage,
  errorPage,
  html,
  newCodePage,
} from './pages.ts'
import { CONNECTION_IDLE_DAYS } from './policy.ts'
import { readBody } from './requests.ts'
import {
  keysFromCode,
  newRecoveryCode,
  newWalletKey,
  normalizeRecoveryCode,
  unwrapWalletKey,
  wrapWalletKey,
} from './vault-crypto.ts'
import type { VaultApi } from './vault.ts'

export const ORIGIN = 'https://mcp.earnrate.dev'
export const SCOPE = 'wallet'
const DAY_SECONDS = 24 * 60 * 60
const NOT_A_CODE =
  "That isn't a recovery code. It's 25 letters and digits, like ABCDE-12345-…"
const NO_MATCH = 'No saved wallet matches that recovery code.'
const MAX_FORM = 8 * 1024

// A sign-in form's fields; empty for anything else or anything too large.
async function readForm(request: Request): Promise<URLSearchParams> {
  const text = await readBody(request, MAX_FORM)
  return new URLSearchParams(text ?? '')
}

// Registrations are stored for months; anything bigger than an app needs
// is refused so they can't fill storage.
function registrationProblem(metadata: Record<string, unknown>) {
  const uris = metadata.redirect_uris
  const name = metadata.client_name
  if (JSON.stringify(metadata).length > 4096)
    return { description: 'Client metadata is too large.' }
  if (Array.isArray(uris) && uris.length > 10)
    return { description: 'Too many redirect URIs.' }
  if (typeof name === 'string' && name.length > 100)
    return { description: 'The client name is too long.' }
  return undefined
}

// /mcp is an alias with its own resource, so connections made there keep
// working.
export const RESOURCE = ORIGIN
export const ALIAS_RESOURCE = `${ORIGIN}/mcp`
const RESOURCES = [RESOURCE, ALIAS_RESOURCE]

export const resourceFor = (pathname: string) =>
  pathname === '/mcp' ? ALIAS_RESOURCE : RESOURCE

const metadataUrl = (resource: string) =>
  `${ORIGIN}/.well-known/oauth-protected-resource${new URL(resource).pathname.replace(/^\/$/, '')}`

// What a grant carries, encrypted by the OAuth library for the token holder.
type Grant = { walletId: string; walletKey: string }

export type AuthEnv = { OAUTH_KV: unknown }

export type VaultFor<Env> = (env: Env, walletId: string) => VaultApi

// The OAuth library's tokens are "{userId}:{grantId}:{secret}". Only the
// grant id is read from one, to refuse a signed-out grant in the vault.
export function grantIdOf(token: string): string | null {
  const parts = token.split(':')
  return parts.length === 3 && parts[1] ? parts[1] : null
}

export type RevokedGrant = { id: string; expiresAt: number | null } // ms

export function protectedResourceMetadata(resource: string): Response {
  return Response.json({
    resource,
    authorization_servers: [ORIGIN],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'earnrate',
    resource_documentation: 'https://earnrate.dev/',
  })
}

// Sends the client to sign in: earnrate's page, where the user starts or
// reconnects a wallet.
export function challenge(resource: string, invalidToken = false): Response {
  const params = [
    ...(invalidToken ? ['error="invalid_token"'] : []),
    `resource_metadata="${metadataUrl(resource)}"`,
    `scope="${SCOPE}"`,
  ]
  return Response.json(
    {
      error: invalidToken ? 'invalid_token' : 'unauthorized',
      error_description: invalidToken
        ? 'Sign in to earnrate again: start a wallet or reconnect one with its recovery code.'
        : 'Sign in to earnrate: start a wallet or reconnect one with its recovery code.',
    },
    {
      status: 401,
      headers: { 'WWW-Authenticate': `Bearer ${params.join(', ')}` },
    },
  )
}

export function makeAuth<Env extends AuthEnv>(vaultFor: VaultFor<Env>) {
  const server = new OAuthAuthorizationServer<Env>({
    issuer: ORIGIN,
    resources: RESOURCES,
    defaultResource: RESOURCE,
    scopesSupported: [SCOPE],
    clientIdMetadataDocumentEnabled: true,
    clientRegistrationEndpoint: '/oauth/register',
    clientRegistrationCallback: ({ clientMetadata }) =>
      registrationProblem(clientMetadata),
    accessTokenTTL: 60 * 60,
    // Stays signed in while used; 90 idle days ends it.
    refreshTokenTTL: CONNECTION_IDLE_DAYS * DAY_SECONDS,
    refreshTokenIdleTTL: CONNECTION_IDLE_DAYS * DAY_SECONDS,
  })

  // Either address's token works at either address: they reach the same
  // server, so the audience split only keeps old connections valid.
  async function validate(
    env: Env,
    token: string,
    first: string, // the resource of the address the request came to
  ): Promise<{
    grant: Grant
    clientId: string
    grantId: string | null
  } | null> {
    for (const resource of [first, ...RESOURCES.filter((r) => r !== first)]) {
      const found = await server.validateToken<Grant>(resource, token, env)
      if (found)
        return found.scope.includes(SCOPE)
          ? {
              grant: found.props,
              clientId: found.clientId,
              grantId: grantIdOf(token),
            }
          : null
    }
    return null
  }

  // `clientId` limits it to one app's connections. A token doesn't say
  // which grant it came from, so every connection that app made to this
  // wallet is signed out (for claude.ai, every account connected to it).
  // Returns the grants it revoked.
  async function signOutEverywhere(
    env: Env,
    walletId: string,
    clientId: string | null = null,
  ): Promise<RevokedGrant[]> {
    const oauth = server.getOAuthApi(env)
    const revoked: RevokedGrant[] = []
    let cursor: string | undefined
    do {
      const page = await oauth.listUserGrants(
        walletId,
        cursor ? { cursor } : {},
      )
      for (const grant of page.items)
        if (clientId === null || grant.clientId === clientId) {
          await oauth.revokeGrant(grant.id, walletId)
          revoked.push({
            id: grant.id,
            expiresAt:
              grant.expiresAt === undefined ? null : grant.expiresAt * 1000,
          })
        }
      cursor = page.cursor
    } while (cursor)
    return revoked
  }

  function connect(
    oauth: OAuthHelpers,
    request: AuthRequest,
    walletId: string,
    walletKey: string,
  ) {
    return oauth.completeAuthorization({
      request,
      userId: walletId,
      metadata: {},
      scope: [SCOPE],
      props: { walletId, walletKey } satisfies Grant,
      // One wallet can be connected from several apps and accounts.
      revokeExistingGrants: false,
    })
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

    const form = await readForm(request)
    const field = (name: string) => form.get(name) ?? ''
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
      const { redirectTo } = await connect(
        oauth,
        approved.request,
        keys.walletId,
        walletKey,
      )
      return html(newCodePage(code, redirectTo), 200, approved.headers)
    }

    if (choice === 'recover') {
      const code = normalizeRecoveryCode(field('code'))
      if (!code) return chooseAgain(env, request, handle, NOT_A_CODE)
      const keys = await keysFromCode(code)
      const wrapped = await vaultFor(env, keys.walletId).wrappedKey()
      const walletKey = wrapped && (await unwrapWalletKey(wrapped, keys))
      if (!walletKey) return chooseAgain(env, request, handle, NO_MATCH)
      const approved = await oauth.approveConsent(request, handle, {
        scope: [SCOPE],
      })
      const { redirectTo } = await connect(
        oauth,
        approved.request,
        keys.walletId,
        walletKey,
      )
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

  // The wallet moves to a new object under the new code and a new key; the
  // old object is deleted, which signs out every app connected with the old
  // code.
  async function changeCode(request: Request, env: Env): Promise<Response> {
    if (request.method === 'GET') return html(changeCodePage())
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405 })
    const code = normalizeRecoveryCode(
      (await readForm(request)).get('code') ?? '',
    )
    if (!code) return html(changeCodePage(NOT_A_CODE), 400)
    const oldKeys = await keysFromCode(code)
    const oldVault = vaultFor(env, oldKeys.walletId)
    const wrapped = await oldVault.wrappedKey()
    const oldKey = wrapped && (await unwrapWalletKey(wrapped, oldKeys))
    if (!oldKey) return html(changeCodePage(NO_MATCH), 400)

    const wallet = await oldVault.load(oldKey)
    const next = newRecoveryCode()
    const keys = await keysFromCode(next)
    const walletKey = newWalletKey()
    const vault = vaultFor(env, keys.walletId)
    const failed = () =>
      html(
        errorPage(
          "Couldn't change the code. Your current code still works.",
          'Try again in a few minutes.',
        ),
        500,
      )
    if (
      !(await vault.create(keys.walletId, await wrapWalletKey(walletKey, keys)))
    )
      return failed()
    if (wallet && !(await vault.replace(walletKey, wallet)).ok) {
      await vault.destroy()
      return failed()
    }
    await oldVault.destroy()
    await signOutEverywhere(env, oldKeys.walletId)
    return html(changedCodePage(next))
  }

  return {
    authorize,
    changeCode,
    validate,
    signOutEverywhere,
    fetch: (request: Request, env: Env, ctx: ExecutionContextLike) =>
      server.fetch(request, env, ctx as never),
  }
}

export type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void
}
