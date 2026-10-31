import { createMcpHandler } from '@modelcontextprotocol/server'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { AccountStore } from '../../src/data/store.ts'
import {
  createEarnrateServer,
  SAVED_WALLET_TOOLS,
} from '../../src/mcp/server.ts'
import { signedOutStore, VaultWalletStore } from './account-store.ts'
import {
  challenge,
  makeAuth,
  protectedResourceMetadata,
  SCOPE,
  type AuthEnv,
  type ExecutionContextLike,
  type VaultFor,
} from './auth.ts'

type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}
type Dataset = {
  writeDataPoint(point: { blobs?: string[]; indexes?: string[] }): void
}

export type Env = AuthEnv & {
  LIMITER?: RateLimit // every request, per IP
  SIGN_IN_LIMITER?: RateLimit // the sign-in page, per IP
  USAGE?: Dataset // counts only: the method or tool name, never arguments
}

export type Bundle = { catalog: Catalog; dataVersion: string; version: string }

// Quarters, caps and rule dates follow the user's calendar; with no user
// location, U.S. Eastern is the closest single choice.
const easternToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  )

const MAX_BODY = 64 * 1024

type Call = { method: string; tool: string | null }

// The JSON-RPC methods in a request, and the tool names for tool calls.
async function rpcCalls(request: Request): Promise<Call[]> {
  if (request.method !== 'POST') return []
  const length = request.headers.get('content-length')
  if (length !== null && Number(length) > MAX_BODY) return []
  let body: unknown
  try {
    body = await request.clone().json()
  } catch {
    return []
  }
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

const tooMany = () =>
  new Response('Too many requests. Try again in a minute.', {
    status: 429,
    headers: { 'retry-after': '60' },
  })

async function limited(limiter: RateLimit | undefined, request: Request) {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  return limiter ? !(await limiter.limit({ key: ip })).success : false
}

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
    const calls = await rpcCalls(request)
    for (const { method, tool } of calls) {
      const label = tool ? `tool:${tool}` : method
      env.USAGE?.writeDataPoint({ blobs: [label], indexes: [label] })
    }

    const header = request.headers.get('authorization')
    const token = /^Bearer (\S+)$/i.exec(header ?? '')?.[1]
    if (!token) {
      const needsWallet = calls.some(
        (c) => c.tool !== null && SAVED_WALLET_TOOLS.includes(c.tool),
      )
      return needsWallet ? challenge() : handler.fetch(request)
    }

    const grant = await auth.validate(env, token)
    if (!grant) return challenge(true)
    const store = new VaultWalletStore(
      vaultFor(env, grant.walletId),
      grant.walletKey,
      () => auth.signOutEverywhere(env, grant.walletId),
    )
    return handler.fetch(request, {
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
      if (pathname === '/' && request.method === 'GET')
        return Response.redirect('https://earnrate.dev/', 302)
      if (await limited(env.LIMITER, request)) return tooMany()
      if (
        pathname === '/.well-known/oauth-protected-resource' ||
        pathname === '/.well-known/oauth-protected-resource/mcp'
      )
        return protectedResourceMetadata()
      if (pathname === '/mcp') return mcp(request, env)
      if (pathname === '/authorize') {
        if (
          request.method === 'POST' &&
          (await limited(env.SIGN_IN_LIMITER, request))
        )
          return tooMany()
        return auth.authorize(request, env)
      }
      return auth.fetch(request, env, ctx)
    },
  }
}
