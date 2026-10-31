import { createMcpHandler } from '@modelcontextprotocol/server'
import type { Catalog } from '../../src/data/load.ts'
import { noSavedWallet } from '../../src/data/store.ts'
import { createEarnrateServer } from '../../src/mcp/server.ts'

type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}
type Dataset = {
  writeDataPoint(point: { blobs?: string[]; indexes?: string[] }): void
}

export type Env = {
  LIMITER?: RateLimit
  USAGE?: Dataset // counts only: the method or tool name, never arguments
}

export type Bundle = { catalog: Catalog; dataVersion: string; version: string }

// Quarters, caps and rule dates follow the user's calendar; with no user
// location, U.S. Eastern is the closest single choice.
const easternToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  )

// The method, and the tool name for tool calls: the only things counted.
async function usageLabel(request: Request): Promise<string | null> {
  const length = request.headers.get('content-length')
  if (length !== null && Number(length) > MAX_BODY) return null
  try {
    const body = (await request.clone().json()) as {
      method?: unknown
      params?: { name?: unknown }
    }
    if (body.method === 'tools/call' && typeof body.params?.name === 'string')
      return `tool:${body.params.name}`
    return typeof body.method === 'string' ? body.method : null
  } catch {
    return null
  }
}

const MAX_BODY = 64 * 1024

export function makeWorker(bundle: Bundle, today = easternToday) {
  const handler = createMcpHandler(
    () =>
      createEarnrateServer({
        catalog: bundle.catalog,
        store: noSavedWallet('your saved wallet'),
        savedWallets: false,
        today,
        llm: null,
        version: bundle.version,
      }),
    { maxRequestBodySize: MAX_BODY },
  )
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url)
      if (url.pathname === '/' && request.method === 'GET')
        return Response.redirect('https://earnrate.dev/', 302)
      if (url.pathname !== '/mcp')
        return new Response('Not found', { status: 404 })

      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
      if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success)
        return new Response('Too many requests. Try again in a minute.', {
          status: 429,
          headers: { 'retry-after': '60' },
        })
      if (env.USAGE && request.method === 'POST') {
        const label = await usageLabel(request)
        if (label)
          env.USAGE.writeDataPoint({ blobs: [label], indexes: [label] })
      }
      return handler.fetch(request)
    },
  }
}
