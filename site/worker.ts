// earnrate.dev is static files; this Worker runs only for /count, where
// the page's beacon tallies an event name from EVENTS. It keeps no logs and
// writes only the event and the kind of device to Analytics Engine: no IP
// address, user agent, cookie or id.
import { deviceOf, isEvent } from './events.ts'

type Dataset = {
  writeDataPoint(point: { blobs?: string[]; indexes?: string[] }): void
}
type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}
type Assets = { fetch(request: Request): Promise<Response> }

export type SiteEnv = {
  ASSETS: Assets
  USAGE?: Dataset
  LIMITER?: RateLimit // per IP, so one script can't skew the counts
}

const done = () =>
  new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })

export async function count(request: Request, env: SiteEnv): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const body = (await request.text()).slice(0, 64).trim()
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
    return new URL(request.url).pathname === '/count'
      ? count(request, env)
      : env.ASSETS.fetch(request)
  },
}
