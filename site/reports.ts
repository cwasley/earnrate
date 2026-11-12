// Short links to a Rate my wallet report (earnrate.dev/r/<id>). The page
// names a link (report-ids.ts) when someone first presses Copy link or
// Share, and the browser that made it updates it with the same request when
// its saved wallet changes. What's kept is the report's versioned string,
// the same one a /rate#w= link carries, and nothing else: no IP address,
// user agent, cookie or wallet. Each link is deleted REPORT_RETENTION_MONTHS
// after it was last opened or updated, or sooner with the delete key its
// maker's browser holds. These paths sit outside /api, so the sync cookie
// (scoped to /api) is never sent here, and nothing here reads a cookie.
import { readBody } from '../remote/src/requests.ts'
import { checkReport, type ReportCodes } from './report-check.ts'
import {
  DELETE_HEADER,
  ID,
  ID_HEADER,
  KEY,
  REPORT_HEADER,
} from './report-ids.ts'
import {
  REPORT_LINKS_PER_DAY,
  REPORT_MAX_LENGTH,
  REPORT_REFRESH_DAYS,
  REPORT_RETENTION_SECONDS,
} from './report-policy.ts'

export type ReportStore = {
  get(key: string): Promise<string | null>
  getWithMetadata(
    key: string,
  ): Promise<{ value: string | null; metadata: ReportMeta | null }>
  put(
    key: string,
    value: string,
    options: { expirationTtl: number; metadata?: ReportMeta },
  ): Promise<void>
  delete(key: string): Promise<void>
}

type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export type ReportsEnv = {
  ASSETS: { fetch(request: Request): Promise<Response> }
  REPORTS?: ReportStore
  REPORT_LIMITER?: RateLimit
  LIMITER?: RateLimit // per IP, for opening and deleting links
}

// The delete key's SHA-256, and the day (since 1970) the deletion date was
// last pushed back.
export type ReportMeta = { key: string; opened: number }

export {
  DELETE_HEADER,
  ID_ALPHABET,
  ID_HEADER,
  ID_LENGTH,
  REPORT_HEADER,
} from './report-ids.ts'

const storeKey = (id: string) => `report:${id}`
const today = () => Math.floor(Date.now() / 86_400_000)
// Links made that day, sitewide; nothing about who made them.
const countKey = (day: number) => `links:${String(day)}`
const COUNT_SECONDS = 2 * 86_400

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Why a link wasn't made, for the page.
export const BUSY = 'busy' // the per-minute limit
export const FULL = 'daily-limit'

const plain = (status: number, body: string | null = null) =>
  new Response(body, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
  })

// Only the page itself, on this site: a request from another site's script
// needs a preflight for the custom header, which this never answers.
function fromThePage(request: Request): boolean {
  if (request.headers.get(REPORT_HEADER) !== '1') return false
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') return false
  const origin = request.headers.get('origin')
  return origin === null || origin === new URL(request.url).origin
}

// KV takes one write a second to a key, so two of the maker's own tabs
// writing the same report at once can see this fail; it counts as written
// when the store already holds that report under the same key.
async function put(
  store: ReportStore,
  id: string,
  body: string,
  options: { expirationTtl: number; metadata: ReportMeta },
): Promise<boolean> {
  try {
    await store.put(storeKey(id), body, options)
    return true
  } catch {
    const now = await store.getWithMetadata(storeKey(id))
    return now.value === body && now.metadata?.key === options.metadata.key
  }
}

// One request makes a link or updates it: an unused id is made, counted
// toward the day's links; a used one is replaced only with the key that made
// it, and an update isn't counted. A refusal says no more about whether an
// id is used than opening /r/<id> already does.
async function write(
  request: Request,
  env: ReportsEnv,
  codes: ReportCodes,
): Promise<Response> {
  const store = env.REPORTS
  if (!store) return plain(503)
  const ip = request.headers.get('cf-connecting-ip')
  if (env.REPORT_LIMITER && ip) {
    const { success } = await env.REPORT_LIMITER.limit({ key: ip })
    if (!success) return plain(429, BUSY)
  }
  const id = request.headers.get(ID_HEADER) ?? ''
  const key = request.headers.get(DELETE_HEADER) ?? ''
  if (!ID.test(id) || !KEY.test(key)) return plain(400)
  const body = await readBody(request, REPORT_MAX_LENGTH)
  if (body === null) return plain(413)
  if (!checkReport(body, codes)) return plain(400)
  const hash = await sha256(key)
  const day = today()
  const kept = { expirationTtl: REPORT_RETENTION_SECONDS }
  const { value, metadata } = await store.getWithMetadata(storeKey(id))
  if (value !== null) {
    if (metadata?.key !== hash) return plain(403)
    if (
      !(await put(store, id, body, {
        ...kept,
        metadata: { key: hash, opened: day },
      }))
    )
      return plain(503)
    return plain(204)
  }
  // Sitewide, not per person: the per-IP limit is approximate, and a count
  // per person would mean keeping something about them.
  const made = Number((await store.get(countKey(day))) ?? 0) || 0
  if (made >= REPORT_LINKS_PER_DAY) return plain(503, FULL)
  if (
    !(await put(store, id, body, {
      ...kept,
      metadata: { key: hash, opened: day },
    }))
  )
    return plain(503)
  // KV takes one write a second to a key, so links made in the same second
  // can fail this; the link is kept all the same, since its maker already
  // holds its address.
  try {
    await store.put(countKey(day), String(made + 1), {
      expirationTtl: COUNT_SECONDS,
    })
  } catch {
    // the day's count stays one short
  }
  return plain(201)
}

async function read(id: string, env: ReportsEnv): Promise<Response> {
  const store = env.REPORTS
  if (!store) return plain(503)
  const { value, metadata } = await store.getWithMetadata(storeKey(id))
  if (value === null || metadata === null) return plain(404)
  const now = today()
  if (now - metadata.opened > REPORT_REFRESH_DAYS) {
    try {
      await store.put(storeKey(id), value, {
        expirationTtl: REPORT_RETENTION_SECONDS,
        metadata: { key: metadata.key, opened: now },
      })
    } catch {
      // opened twice in a second: the other opening pushed it back
    }
  }
  return plain(200, value)
}

async function remove(
  request: Request,
  id: string,
  env: ReportsEnv,
): Promise<Response> {
  const store = env.REPORTS
  if (!store) return plain(503)
  const key = request.headers.get(DELETE_HEADER) ?? ''
  const { metadata } = await store.getWithMetadata(storeKey(id))
  if (metadata === null) return plain(404)
  if (key === '' || (await sha256(key)) !== metadata.key) return plain(403)
  await store.delete(storeKey(id))
  return plain(204)
}

// Opening and deleting links each read the store, so one address can't
// read it without end.
async function busy(request: Request, env: ReportsEnv): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip')
  if (!env.LIMITER || !ip) return false
  return !(await env.LIMITER.limit({ key: ip })).success
}

// The site's own 404 page, for an address under /r that isn't a link.
async function notFound(request: Request, env: ReportsEnv): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return plain(404)
  const page = await env.ASSETS.fetch(
    new Request(new URL('/404', request.url), { method: request.method }),
  )
  const headers = new Headers(page.headers)
  headers.set('x-robots-tag', 'noindex')
  return new Response(page.body, { status: 404, headers })
}

// /r (POST: make or update a link), /r/<id> (the page; DELETE: delete it) and
// /r/<id>/data (the report's string, for the page). Reading a link never
// checks it against `codes`, so a link made before the card data changed
// still opens.
export async function reports(
  request: Request,
  env: ReportsEnv,
  codes: ReportCodes,
): Promise<Response> {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter((p) => p !== '')
  const [root, id, data] = parts
  if (root !== 'r') return notFound(request, env)
  // Cloudflare's rate limiting rule matches the path "/r" exactly, so a link
  // is made only there; "/r/" or "//r" would get past it.
  if (parts.length === 1 && request.method === 'POST')
    return url.pathname !== '/r'
      ? plain(404)
      : fromThePage(request)
        ? write(request, env, codes)
        : plain(403)
  if (id === undefined || !ID.test(id) || parts.length > 3)
    return notFound(request, env)
  if (
    (data === 'data' || request.method === 'DELETE') &&
    (await busy(request, env))
  )
    return plain(429, BUSY)
  if (data === 'data' && request.method === 'GET')
    return fromThePage(request) ? read(id, env) : plain(403)
  if (data !== undefined) return notFound(request, env)
  if (request.method === 'DELETE')
    return fromThePage(request) ? remove(request, id, env) : plain(403)
  if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405)
  // The page: /rate's own file, which reads the id from the address.
  const page = await env.ASSETS.fetch(
    new Request(new URL('/rate', url), { method: request.method }),
  )
  const headers = new Headers(page.headers)
  headers.set('x-robots-tag', 'noindex')
  headers.set('cache-control', 'no-store')
  return new Response(page.body, { status: page.status, headers })
}
