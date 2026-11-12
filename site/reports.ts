// Short links to a Rate my wallet report (earnrate.dev/r/<id>), made only
// when someone presses Copy link or Share. What's kept is the report's
// versioned string, the same one a /rate#w= link carries, and nothing else:
// no IP address, user agent, cookie or wallet. Each link is deleted
// REPORT_RETENTION_MONTHS after it was last opened, or sooner with the
// delete key its maker's page holds. These paths sit outside /api, so the
// sync cookie (scoped to /api) is never sent here, and nothing here reads
// a cookie.
import { checkReport, type ReportCodes } from './report-check.ts'
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
}

// The delete key's SHA-256, and the day (since 1970) the deletion date was
// last pushed back.
export type ReportMeta = { key: string; opened: number }

export const REPORT_HEADER = 'x-earnrate-report'
export const DELETE_HEADER = 'x-earnrate-delete-key'

// No 0/o, 1/l/i: an id read aloud or retyped can't be mistaken.
export const ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
export const ID_LENGTH = 8
const ID = new RegExp(`^[${ID_ALPHABET}]{${String(ID_LENGTH)}}$`)

const storeKey = (id: string) => `report:${id}`
const today = () => Math.floor(Date.now() / 86_400_000)
// Links made that day, sitewide; nothing about who made them.
const countKey = (day: number) => `links:${String(day)}`
const COUNT_SECONDS = 2 * 86_400

function randomFrom(alphabet: string, length: number): string {
  const out: string[] = []
  // Rejection sampling, so each character is equally likely.
  const limit = 256 - (256 % alphabet.length)
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length)
        out.push(alphabet[b % alphabet.length] ?? '')
    }
  }
  return out.join('')
}

const deleteKey = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

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

async function create(
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
  const body = await request.text()
  if (body.length > REPORT_MAX_LENGTH) return plain(413)
  if (!checkReport(body, codes)) return plain(400)
  // Sitewide, not per person: the per-IP limit is approximate, and a count
  // per person would mean keeping something about them.
  const day = today()
  const made = Number((await store.get(countKey(day))) ?? 0) || 0
  if (made >= REPORT_LINKS_PER_DAY) return plain(503, FULL)
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomFrom(ID_ALPHABET, ID_LENGTH)
    if ((await store.get(storeKey(id))) !== null) continue
    const key = deleteKey()
    await store.put(storeKey(id), body, {
      expirationTtl: REPORT_RETENTION_SECONDS,
      metadata: { key: await sha256(key), opened: day },
    })
    await store.put(countKey(day), String(made + 1), {
      expirationTtl: COUNT_SECONDS,
    })
    return new Response(JSON.stringify({ id, key }), {
      status: 201,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      },
    })
  }
  return plain(503)
}

async function read(id: string, env: ReportsEnv): Promise<Response> {
  const store = env.REPORTS
  if (!store) return plain(503)
  const { value, metadata } = await store.getWithMetadata(storeKey(id))
  if (value === null || metadata === null) return plain(404)
  const now = today()
  if (now - metadata.opened > REPORT_REFRESH_DAYS)
    await store.put(storeKey(id), value, {
      expirationTtl: REPORT_RETENTION_SECONDS,
      metadata: { key: metadata.key, opened: now },
    })
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

// /r (POST: make a link), /r/<id> (the page; DELETE: delete it) and
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
  if (parts.length === 1 && request.method === 'POST')
    return fromThePage(request) ? create(request, env, codes) : plain(403)
  if (id === undefined || !ID.test(id) || parts.length > 3)
    return notFound(request, env)
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
