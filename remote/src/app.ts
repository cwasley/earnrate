import { createMcpHandler } from '@modelcontextprotocol/server'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { AccountStore } from '../../src/data/store.ts'
import {
  ANSWER_TOOLS,
  createEarnrateServer,
  SAVED_WALLET_TOOLS,
} from '../../src/mcp/server.ts'
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
import { errorPage, PAGE_HEADERS } from './pages.ts'
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
const easternToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  )

type Call = { method: string; tool: string | null }

// The JSON-RPC methods in a parsed body, and the tool names for tool calls.
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

const tooMany = () =>
  new Response('Too many requests. Try again in a minute.', {
    status: 429,
    headers: { 'retry-after': '60' },
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
    { status: 503, headers: { 'retry-after': '60' } },
  )

// Sign-in depends on KV, whose free daily limits can run out. Count those
// failures by path so they show up in the usage tally, and say so plainly.
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
      ? new Response(
          errorPage(
            "earnrate's sign-in isn't working right now.",
            'Try again in a few minutes. Questions still work without signing in.',
          ),
          { status: 503, headers: PAGE_HEADERS },
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
    if (!token) return wantsWallet ? challenge(resource) : signedOut()

    // A token that doesn't check out only matters for wallet tools: other
    // questions are answered as if signed out.
    let grant
    try {
      grant = await auth.validate(env, token, resource)
    } catch {
      return wantsWallet ? unavailable() : signedOut()
    }
    if (!grant) {
      if (await limited(env.SIGN_IN_LIMITER, request)) return tooMany()
      return wantsWallet ? challenge(resource, true) : signedOut()
    }
    // Revoking grants goes through KV, which can lag; the wallet's own
    // storage is consistent, so a deleted wallet signs its apps out here.
    const vault = vaultFor(env, grant.walletId)
    let exists
    try {
      exists = await vault.exists()
    } catch {
      return wantsWallet ? unavailable() : signedOut()
    }
    if (!exists) return wantsWallet ? challenge(resource, true) : signedOut()
    const store = new VaultWalletStore(vault, grant.walletKey, () =>
      auth.signOutEverywhere(env, grant.walletId),
    )
    return handler.fetch(forward, {
      ...options,
      authInfo: { token, clientId: '', scopes: [SCOPE], extra: { store } },
    })
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
