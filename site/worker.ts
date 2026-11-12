// earnrate.dev is static files; this Worker runs only for /count, /api/*
// and /r. At /count the page's beacon tallies an event name from EVENTS: it
// keeps no logs and writes only the event and the kind of device to
// Analytics Engine, no IP address, user agent, cookie or id. /api/* is
// opt-in wallet sync with Claude (api.ts), and stores nothing here. /r is
// short report links (reports.ts), the one thing this Worker stores.
import codes from 'earnrate:report-codes'
import { readBody } from '../remote/src/requests.ts'
import { api, type ApiEnv } from './api.ts'
import { deviceOf, isEvent } from './events.ts'
import { reports, type ReportsEnv } from './reports.ts'

type Dataset = {
  writeDataPoint(point: { blobs?: string[]; indexes?: string[] }): void
}
type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}
type Assets = { fetch(request: Request): Promise<Response> }

export type SiteEnv = ApiEnv &
  ReportsEnv & {
    ASSETS: Assets
    USAGE?: Dataset
    LIMITER?: RateLimit // per IP: counts, and opening or deleting report links
  }

const done = () =>
  new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })

export async function count(request: Request, env: SiteEnv): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const body = ((await readBody(request, 64)) ?? '').trim()
  if (!isEvent(body)) return done()
  const ip = request.headers.get('cf-connecting-ip')
  if (env.LIMITER && ip && !(await env.LIMITER.limit({ key: ip })).success)
    return done()
  const device = deviceOf(request.headers.get('user-agent') ?? '')
  env.USAGE?.writeDataPoint({ blobs: [body, device], indexes: [body] })
  return done()
}

export default {
  fetch(request: Request, env: SiteEnv): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/count') return count(request, env)
    if (pathname.startsWith('/api/')) return api(request, env)
    if (pathname === '/r' || pathname.startsWith('/r/'))
      return reports(request, env, codes)
    return env.ASSETS.fetch(request)
  },
}
