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
import { onSiteHost, SITE_CLIENT_ID, withSiteClient } from './site-client.ts'

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
  if (Array.isArray(uris) && uris.some(onSiteHost))
    return { description: "Redirect URIs on earnrate.dev are earnrate's own." }
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

// Which kind of app a connection comes from, the only thing usage counts
// say about who asked. Never an app's own name, which it chooses itself.
export type AppKind =
  'claude' | 'chatgpt' | 'site' | 'check' | 'local' | 'other'
export const LIVE_CHECK_CLIENT = 'earnrate live check'
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function appKind(client: {
  clientId: string
  redirectUris: string[]
  clientName?: string
}): AppKind {
  if (client.clientName === LIVE_CHECK_CLIENT) return 'check'
  const hosts = [client.clientId, ...client.redirectUris].flatMap((u) => {
    try {
      return [new URL(u).hostname]
    } catch {
      return []
    }
  })
  const under = (domain: string) =>
    hosts.some((h) => h === domain || h.endsWith(`.${domain}`))
  if (under('claude.ai') || under('claude.com') || under('anthropic.com'))
    return 'claude'
  if (under('chatgpt.com') || under('openai.com')) return 'chatgpt'
  if (
    client.clientId === SITE_CLIENT_ID &&
    client.redirectUris.length > 0 &&
    client.redirectUris.every(onSiteHost)
  )
    return 'site'
  if (hosts.length > 0 && hosts.every((h) => LOOPBACK.has(h))) return 'local'
  return 'other'
}

export type VaultFor<Env> = (env: Env, walletId: string) => VaultApi

// The OAuth library's tokens are "{userId}:{grantId}:{secret}". Only the
// grant id is read from one, to refuse a signed-out grant in the vault.
function grantIdOf(token: string): string | null {
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

// The env the OAuth library sees: its KV also holds earnrate.dev's client.
const withClients = <Env extends AuthEnv>(env: Env): Env => ({
  ...env,
  OAUTH_KV: withSiteClient(env.OAUTH_KV),
})

// earnrate.dev's client is known, not self-registered, so the sign-in page
// names it as verified.
const verified = <T extends { clientName: string }>(
  clientId: string,
  facts: T,
): T & { clientDomain?: string } =>
  clientId === SITE_CLIENT_ID
    ? { ...facts, clientDomain: 'earnrate.dev' }
    : facts

export function makeAuth<Env extends AuthEnv>(
  vaultFor: VaultFor<Env>,
  onWalletCreated: (env: Env, kind: AppKind) => void = () => undefined,
) {
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
      const found = await server.validateToken<Grant>(
        resource,
        token,
        withClients(env),
      )
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

  // Cached per isolate: a client's registration doesn't change.
  const kinds = new Map<string, AppKind>()
  async function clientKind(env: Env, clientId: string): Promise<AppKind> {
    const cached = kinds.get(clientId)
    if (cached) return cached
    let kind: AppKind = 'other'
    try {
      // A client metadata document's id is its URL; no need to fetch it.
      const client = /^https:\/\//.test(clientId)
        ? { clientId, redirectUris: [] }
        : await server.getOAuthApi(withClients(env)).lookupClient(clientId)
      if (client) kind = appKind(client)
    } catch {
      // counted as 'other'
    }
    if (kinds.size >= 1000) kinds.clear()
    kinds.set(clientId, kind)
    return kind
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
    const oauth = server.getOAuthApi(withClients(env))
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

  // Ends one connection, such as one browser's, and leaves the wallet's
  // other connections alone, even the same app's.
  async function signOutGrant(
    env: Env,
    walletId: string,
    grantId: string,
  ): Promise<void> {
    await server.getOAuthApi(withClients(env)).revokeGrant(grantId, walletId)
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
    const oauth = server.getOAuthApi(withClients(env))
    const again = await oauth.parseAuthRequest(
      new Request(request.url, { method: 'GET' }),
    )
    return html(
      choosePage(
        verified(again.clientId, await oauth.describeConsent(again)),
        handle,
        error,
      ),
      400,
    )
  }

  async function authorizePage(request: Request, env: Env): Promise<Response> {
    const oauth = server.getOAuthApi(withClients(env))
    if (request.method === 'GET') {
      const parsed = await oauth.parseAuthRequest(request)
      const details = verified(
        parsed.clientId,
        await oauth.describeConsent(parsed),
      )
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
      onWalletCreated(env, await clientKind(env, approved.request.clientId))
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
    clientKind,
    signOutEverywhere,
    signOutGrant,
    fetch: (request: Request, env: Env, ctx: ExecutionContextLike) =>
      server.fetch(request, withClients(env), ctx as never),
  }
}

export type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void
}
