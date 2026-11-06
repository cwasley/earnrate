import { createMcpHandler } from '@modelcontextprotocol/server'
import type { AccountStore } from '../../src/data/store.ts'
import {
  ANSWER_TOOLS,
  createEarnrateServer,
  SAVED_WALLET_TOOLS,
} from '../../src/mcp/server.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import { signedOutStore, VaultWalletStore } from './account-store.ts'
import {
  challenge,
  makeAuth,
  type AppKind,
  protectedResourceMetadata,
  resourceFor,
  SCOPE,
  type AuthEnv,
  type ExecutionContextLike,
  type VaultFor,
} from './auth.ts'
import { errorPage, FAVICON_SVG, html } from './pages.ts'
import { RATE_LIMIT_SECONDS } from './policy.ts'
import {
  claimedLimitKey,
  limitKey,
  MAX_BODY,
  readBody,
  walletLimitKey,
} from './requests.ts'

type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}
type Dataset = {
  writeDataPoint(point: { blobs?: string[]; indexes?: string[] }): void
}

export type Env = AuthEnv & {
  LIMITER?: RateLimit // every request: per wallet once signed in, else per IP
  SIGN_IN_LIMITER?: RateLimit // sign-in steps and rejected tokens
  // Counts only: the method or tool name and the kind of app, never
  // arguments, wallets or people.
  USAGE?: Dataset
  // OpenAI's plugin portal checks this token to verify the domain; not secret.
  OPENAI_APPS_CHALLENGE?: string
}

export type Bundle = { catalog: Catalog; version: string }

// Quarters, caps and rule dates follow the user's calendar; with no user
// location, U.S. Eastern is the closest single choice.
const easternToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  )

type Call = { method: string; tool: string | null }

function rpcCalls(body: unknown): Call[] {
  return (Array.isArray(body) ? body : [body]).flatMap((m: unknown) => {
    const msg = m as { method?: unknown; params?: { name?: unknown } } | null
    if (typeof msg?.method !== 'string') return []
    const tool =
      msg.method === 'tools/call' && typeof msg.params?.name === 'string'
        ? msg.params.name
        : null
    return [{ method: msg.method, tool }]
  })
}

// Only names earnrate defines are counted, so a client can't write its own
// text into the tally.
const KNOWN_TOOLS = new Set([...ANSWER_TOOLS, ...SAVED_WALLET_TOOLS])
const KNOWN_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'tools/call',
  'server/discover',
])

function usageLabels(calls: Call[]): Set<string> {
  return new Set(
    calls.map(({ method, tool }) =>
      tool !== null
        ? KNOWN_TOOLS.has(tool)
          ? `tool:${tool}`
          : 'tool:other'
        : KNOWN_METHODS.has(method)
          ? method
          : 'other',
    ),
  )
}

// blob1 is the label and blob2 the kind of app ('signed-out' before a
// token is checked).
type Kind = AppKind | 'signed-out'
const count = (env: Env, label: string, kind: Kind) => {
  env.USAGE?.writeDataPoint({ blobs: [label, kind], indexes: [label] })
}

// A tool that answered with an error (a refusal, like an unknown merchant)
// is counted by tool name only, like every other use.
async function countRefusals(
  env: Env,
  calls: Call[],
  response: Response,
  kind: Kind,
): Promise<void> {
  const tools = calls.flatMap((c) => (c.tool === null ? [] : [c.tool]))
  if (tools.length !== 1 || !env.USAGE || response.status !== 200) return
  const text = await response.clone().text()
  if (!/"isError":\s*true/.test(text)) return
  const tool = tools[0] ?? ''
  count(env, `tool-error:${KNOWN_TOOLS.has(tool) ? tool : 'other'}`, kind)
}

const tooMany = () =>
  new Response('Too many requests. Try again in a minute.', {
    status: 429,
    headers: { 'retry-after': String(RATE_LIMIT_SECONDS) },
  })

// Counts against `key`, or the IP address without one. Anthropic's servers
// are never limited.
async function limited(
  limiter: RateLimit | undefined,
  request: Request,
  key: string | null = null,
) {
  const ip = limitKey(request)
  if (!limiter || ip === null) return false
  return !(await limiter.limit({ key: key ?? ip })).success
}

const bearerToken = (request: Request) =>
  /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ??
  null

const unavailable = () =>
  Response.json(
    {
      error: 'temporarily_unavailable',
      error_description:
        "Saved wallets aren't available right now. Questions still work.",
    },
    { status: 503, headers: { 'retry-after': String(RATE_LIMIT_SECONDS) } },
  )

// Sign-in depends on KV. Its failures are counted by path in the usage
// tally and answered plainly.
async function signInStep(
  env: Env,
  pathname: string,
  step: () => Promise<Response>,
  isPage: boolean,
): Promise<Response> {
  let response: Response
  try {
    response = await step()
  } catch {
    response = isPage
      ? html(
          errorPage(
            "earnrate's sign-in isn't working right now.",
            'Try again in a few minutes.',
          ),
          503,
        )
      : unavailable()
  }
  if (response.status >= 500) count(env, `error:${pathname}`, 'signed-out')
  return response
}

const SIGN_IN_PATHS = new Set([
  '/authorize',
  '/change-code',
  '/oauth/register',
  '/oauth/token',
])

export function makeWorker<E extends Env>(
  bundle: Bundle,
  vaultFor: VaultFor<E>,
  today = easternToday,
) {
  const auth = makeAuth<E>(vaultFor, (env, kind) => {
    count(env, 'wallet-created', kind)
  })
  const handler = createMcpHandler(
    (ctx) =>
      createEarnrateServer({
        catalog: bundle.catalog,
        savedWallets: 'account',
        store:
          (ctx.authInfo?.extra?.store as AccountStore | undefined) ??
          signedOutStore,
        today,
        llm: null,
        version: bundle.version,
      }),
    { maxRequestBodySize: MAX_BODY },
  )

  async function mcp(
    request: Request,
    env: E,
    token: string | null,
  ): Promise<Response> {
    const resource = resourceFor(new URL(request.url).pathname)
    let parsedBody: unknown
    let forward = request
    if (request.method === 'POST') {
      const text = await readBody(request)
      if (text === null)
        return new Response('Request too large.', { status: 413 })
      forward = new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: text,
      })
      try {
        parsedBody = JSON.parse(text)
      } catch {
        parsedBody = undefined // the SDK answers the parse error
      }
    }
    const calls = rpcCalls(parsedBody)
    const tally = { kind: 'signed-out' as Kind }
    try {
      return await answer(
        request,
        env,
        token,
        resource,
        calls,
        forward,
        parsedBody,
        tally,
      )
    } finally {
      for (const label of usageLabels(calls)) count(env, label, tally.kind)
    }
  }

  async function answer(
    request: Request,
    env: E,
    token: string | null,
    resource: string,
    calls: Call[],
    forward: Request,
    parsedBody: unknown,
    tally: { kind: Kind },
  ): Promise<Response> {
    const options = parsedBody === undefined ? {} : { parsedBody }
    const signedOut = () => handler.fetch(forward, options)
    const wantsWallet = calls.some(
      (c) => c.tool !== null && SAVED_WALLET_TOOLS.includes(c.tool),
    )

    // Every request needs a connected wallet, so apps ask the user to sign
    // in when they add earnrate. Only while sign-in itself is down are
    // questions answered without one.
    if (!token) return challenge(resource)
    const claimed = await claimedLimitKey(token)
    let found
    try {
      found = await auth.validate(env, token, resource)
    } catch {
      if (await limited(env.LIMITER, request, claimed)) return tooMany()
      return wantsWallet ? unavailable() : signedOut()
    }
    if (!found) {
      if (await limited(env.SIGN_IN_LIMITER, request, claimed)) return tooMany()
      return challenge(resource, true)
    }
    const { grant, clientId, grantId } = found
    tally.kind = await auth.clientKind(env, clientId)
    if (
      await limited(env.LIMITER, request, await walletLimitKey(grant.walletId))
    )
      return tooMany()
    // Revoking grants goes through KV, which can lag; the wallet's own
    // storage is consistent, so a deleted wallet or a signed-out grant is
    // refused here at once.
    const vault = vaultFor(env, grant.walletId)
    let checked
    try {
      checked = await vault.checkIn(
        calls.some((c) => c.tool !== null),
        grantId,
      )
    } catch {
      return wantsWallet ? unavailable() : signedOut()
    }
    if (checked === 'refused') return challenge(resource, true)
    if (checked === 'first-use-today') count(env, 'wallet-active', tally.kind)
    const store = new VaultWalletStore(
      vault,
      grant.walletKey,
      async () => {
        await auth.signOutEverywhere(env, grant.walletId)
      },
      // This grant first, so it's refused even if revoking in KV fails.
      async () => {
        if (grantId !== null)
          await vault.signOutGrants([{ id: grantId, expiresAt: null }])
        const revoked = await auth.signOutEverywhere(
          env,
          grant.walletId,
          clientId,
        )
        await vault.signOutGrants(revoked)
      },
    )
    const response = await handler.fetch(forward, {
      ...options,
      authInfo: { token, clientId: '', scopes: [SCOPE], extra: { store } },
    })
    await countRefusals(env, calls, response, tally.kind)
    return response
  }

  return {
    async fetch(
      request: Request,
      env: E,
      ctx: ExecutionContextLike,
    ): Promise<Response> {
      const { pathname } = new URL(request.url)
      const browsing =
        request.method === 'GET' &&
        (request.headers.get('accept') ?? '').includes('text/html')
      if (pathname === '/' && browsing)
        return Response.redirect('https://earnrate.dev/', 302)
      if (pathname === '/favicon.svg')
        return new Response(FAVICON_SVG, {
          headers: {
            'content-type': 'image/svg+xml',
            'cache-control': 'public, max-age=86400',
          },
        })
      if (pathname === '/favicon.ico')
        return Response.redirect('https://earnrate.dev/favicon.ico', 301)
      if (pathname === '/.well-known/oauth-protected-resource')
        return protectedResourceMetadata(resourceFor('/'))
      if (pathname === '/.well-known/oauth-protected-resource/mcp')
        return protectedResourceMetadata(resourceFor('/mcp'))
      if (pathname === '/.well-known/oauth-authorization-server')
        return auth.fetch(request, env, ctx)
      if (pathname === '/.well-known/openai-apps-challenge')
        return env.OPENAI_APPS_CHALLENGE
          ? new Response(env.OPENAI_APPS_CHALLENGE.trim(), {
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            })
          : new Response('Not found.', { status: 404 })

      // A request with a credential counts against the wallet or grant it
      // names, so users of one app don't share its servers' limit.
      let key: string | null = null
      if (pathname === '/oauth/token' && request.method === 'POST') {
        const text = await readBody(request)
        if (text === null)
          return new Response('Request too large.', { status: 413 })
        const form = new URLSearchParams(text)
        key = await claimedLimitKey(
          form.get('refresh_token') ?? form.get('code') ?? form.get('token'),
        )
        request = new Request(request.url, {
          method: 'POST',
          headers: request.headers,
          body: text,
        })
      }
      const isMcp = pathname === '/' || pathname === '/mcp'
      const token = isMcp ? bearerToken(request) : null
      // A signed-in MCP request is limited once its token is checked.
      if (token === null && (await limited(env.LIMITER, request, key)))
        return tooMany()
      if (isMcp) return mcp(request, env, token)
      // Each of these writes to KV, whose daily writes are limited.
      if (
        SIGN_IN_PATHS.has(pathname) &&
        (await limited(env.SIGN_IN_LIMITER, request, key))
      )
        return tooMany()
      const page =
        pathname === '/authorize'
          ? auth.authorize
          : pathname === '/change-code'
            ? auth.changeCode
            : null
      return signInStep(
        env,
        pathname,
        () => page?.(request, env) ?? auth.fetch(request, env, ctx),
        page !== null,
      )
    },
  }
}
