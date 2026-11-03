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
  protectedResourceMetadata,
  resourceFor,
  SCOPE,
  type AuthEnv,
  type ExecutionContextLike,
  type VaultFor,
} from './auth.ts'
import { errorPage, FAVICON_SVG, html } from './pages.ts'
import { RATE_LIMIT_SECONDS } from './policy.ts'
import { limitKey, MAX_BODY, readBody } from './requests.ts'

type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}
type Dataset = {
  writeDataPoint(point: { blobs?: string[]; indexes?: string[] }): void
}

export type Env = AuthEnv & {
  LIMITER?: RateLimit // every request, per IP
  SIGN_IN_LIMITER?: RateLimit // sign-in steps and rejected tokens, per IP
  USAGE?: Dataset // counts only: the method or tool name, never arguments
}

export type Bundle = { catalog: Catalog; version: string }

// Quarters, caps and rule dates follow the user's calendar; with no user
// location, U.S. Eastern is the closest single choice.
// The hosted server's calendar is US Eastern, for "today".
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

// A tool that answered with an error (a refusal, like an unknown merchant)
// is counted by tool name only, like every other use.
async function countRefusals(
  env: Env,
  calls: Call[],
  response: Response,
): Promise<void> {
  const tools = calls.flatMap((c) => (c.tool === null ? [] : [c.tool]))
  if (tools.length !== 1 || !env.USAGE || response.status !== 200) return
  const text = await response.clone().text()
  if (!/"isError":\s*true/.test(text)) return
  const tool = tools[0] ?? ''
  const label = `tool-error:${KNOWN_TOOLS.has(tool) ? tool : 'other'}`
  env.USAGE.writeDataPoint({ blobs: [label], indexes: [label] })
}

const tooMany = () =>
  new Response('Too many requests. Try again in a minute.', {
    status: 429,
    headers: { 'retry-after': String(RATE_LIMIT_SECONDS) },
  })

async function limited(limiter: RateLimit | undefined, request: Request) {
  const key = limitKey(request)
  if (!limiter || key === null) return false
  return !(await limiter.limit({ key })).success
}

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
  if (response.status >= 500) {
    const label = `error:${pathname}`
    env.USAGE?.writeDataPoint({ blobs: [label], indexes: [label] })
  }
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
  const auth = makeAuth<E>(vaultFor)
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

  async function mcp(request: Request, env: E): Promise<Response> {
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
    for (const label of usageLabels(calls))
      env.USAGE?.writeDataPoint({ blobs: [label], indexes: [label] })

    const options = parsedBody === undefined ? {} : { parsedBody }
    const signedOut = () => handler.fetch(forward, options)
    const wantsWallet = calls.some(
      (c) => c.tool !== null && SAVED_WALLET_TOOLS.includes(c.tool),
    )

    const header = request.headers.get('authorization')
    const token = /^Bearer (\S+)$/i.exec(header ?? '')?.[1]
    // Every request needs a connected wallet, so apps ask the user to sign
    // in when they add earnrate. Only while sign-in itself is down are
    // questions answered without one.
    if (!token) return challenge(resource)
    let found
    try {
      found = await auth.validate(env, token, resource)
    } catch {
      return wantsWallet ? unavailable() : signedOut()
    }
    if (!found) {
      if (await limited(env.SIGN_IN_LIMITER, request)) return tooMany()
      return challenge(resource, true)
    }
    const { grant, clientId, grantId } = found
    // Revoking grants goes through KV, which can lag; the wallet's own
    // storage is consistent, so a deleted wallet or a signed-out grant is
    // refused here at once.
    const vault = vaultFor(env, grant.walletId)
    let allowed
    try {
      allowed = await vault.checkIn(
        calls.some((c) => c.tool !== null),
        grantId,
      )
    } catch {
      return wantsWallet ? unavailable() : signedOut()
    }
    if (!allowed) return challenge(resource, true)
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
    await countRefusals(env, calls, response)
    return response
  }

  return {
    async fetch(
      request: Request,
      env: E,
      ctx: ExecutionContextLike,
    ): Promise<Response> {
      const { pathname } = new URL(request.url)
      // A person opening the address in a browser gets the website.
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
      if (await limited(env.LIMITER, request)) return tooMany()
      if (pathname === '/.well-known/oauth-protected-resource')
        return protectedResourceMetadata(resourceFor('/'))
      if (pathname === '/.well-known/oauth-protected-resource/mcp')
        return protectedResourceMetadata(resourceFor('/mcp'))
      if (pathname === '/' || pathname === '/mcp') return mcp(request, env)
      // Each of these writes to KV, whose daily writes are limited.
      if (
        SIGN_IN_PATHS.has(pathname) &&
        (await limited(env.SIGN_IN_LIMITER, request))
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
