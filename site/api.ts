// earnrate.dev's /api/*: signs this browser in to the hosted wallet at
// mcp.earnrate.dev and passes the page's wallet requests to it over a
// service binding. The tokens live only in an HttpOnly cookie the page's
// scripts can't read; nothing is stored here. Searches never come here:
// only the wallet and changes to it.
import { CONNECTION_IDLE_DAYS } from '../remote/src/policy.ts'
import { readBody } from '../remote/src/requests.ts'
import { SITE_CLIENT_ID, SITE_HOSTS } from '../remote/src/site-client.ts'

type Service = { fetch(request: Request): Promise<Response> }

export type ApiEnv = {
  MCP?: Service // the earnrate-mcp Worker
}

const SERVER = 'https://mcp.earnrate.dev'
const TOKENS = '__Secure-earnrate-wallet'
const SIGN_IN = '__Secure-earnrate-sign-in'
const SIGN_IN_SECONDS = 10 * 60
const REFRESH_EARLY_MS = 60_000

// Every wallet request carries this header. A form on another site can't
// add one, and another origin's script would need a CORS preflight this
// Worker never answers.
export const SYNC_HEADER = 'x-earnrate-sync'

type Tokens = { access: string; refresh: string; expiresAt: number }

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const encode = (value: unknown) =>
  base64url(new TextEncoder().encode(JSON.stringify(value)))

function decode(text: string): unknown {
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)))

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return base64url(new Uint8Array(digest))
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

const cookie = (
  name: string,
  value: string,
  maxAge: number,
  sameSite: 'Strict' | 'Lax',
) =>
  `${name}=${value}; Path=/api; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${String(maxAge)}`

const tokensCookie = (tokens: Tokens) =>
  cookie(TOKENS, encode(tokens), CONNECTION_IDLE_DAYS * 24 * 60 * 60, 'Strict')
const clearTokens = () => cookie(TOKENS, '', 0, 'Strict')
const clearSignIn = () => cookie(SIGN_IN, '', 0, 'Lax')

function tokensOf(request: Request): Tokens | null {
  const value = readCookie(request, TOKENS)
  const t = value ? (decode(value) as Partial<Tokens> | null) : null
  return t &&
    typeof t.access === 'string' &&
    typeof t.refresh === 'string' &&
    typeof t.expiresAt === 'number'
    ? { access: t.access, refresh: t.refresh, expiresAt: t.expiresAt }
    : null
}

const json = (body: unknown, status: number, setCookie: string[] = []) => {
  const headers = new Headers({
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  for (const c of setCookie) headers.append('set-cookie', c)
  return new Response(JSON.stringify(body), { status, headers })
}

const back = (sync: string, setCookie: string[]) => {
  const headers = new Headers({
    location: `/#wallet&sync=${sync}`,
    'cache-control': 'no-store',
  })
  for (const c of setCookie) headers.append('set-cookie', c)
  return new Response(null, { status: 303, headers })
}

// What the hosted server sees of the visitor: its address, for the rate
// limits it keeps per address before a token is checked. Nothing else.
const visitor = (request: Request) => {
  const ip = request.headers.get('cf-connecting-ip')
  return ip ? { 'cf-connecting-ip': ip } : {}
}

async function tokenRequest(
  env: Required<ApiEnv>,
  request: Request,
  fields: Record<string, string>,
): Promise<Response> {
  return env.MCP.fetch(
    new Request(`${SERVER}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...visitor(request),
      },
      body: new URLSearchParams({ client_id: SITE_CLIENT_ID, ...fields }),
    }),
  )
}

async function issued(response: Response): Promise<Tokens | null> {
  if (!response.ok) return null
  const t = (await response.json().catch(() => null)) as {
    access_token?: unknown
    refresh_token?: unknown
    expires_in?: unknown
  } | null
  if (
    typeof t?.access_token !== 'string' ||
    typeof t.refresh_token !== 'string'
  )
    return null
  const seconds = typeof t.expires_in === 'number' ? t.expires_in : 0
  return {
    access: t.access_token,
    refresh: t.refresh_token,
    expiresAt: Date.now() + seconds * 1000,
  }
}

// A refresh the server refused means the connection ended (the wallet was
// deleted, its code changed, or it sat unused): 'ended'. Anything else is
// a failure to reach it.
async function refresh(
  env: Required<ApiEnv>,
  request: Request,
  tokens: Tokens,
): Promise<Tokens | 'ended' | 'unreachable'> {
  let response
  try {
    response = await tokenRequest(env, request, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh,
    })
  } catch {
    return 'unreachable'
  }
  if (response.status === 400 || response.status === 401) return 'ended'
  return (await issued(response)) ?? 'unreachable'
}

function connect(request: Request): Promise<Response> | Response {
  const url = new URL(request.url)
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405)
  return (async () => {
    const state = random()
    const verifier = random()
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: SITE_CLIENT_ID,
      redirect_uri: `${url.origin}/api/callback`,
      code_challenge: await challengeFor(verifier),
      code_challenge_method: 'S256',
      state,
      scope: 'wallet',
      resource: SERVER,
    })
    const headers = new Headers({
      location: `${SERVER}/authorize?${query.toString()}`,
      'cache-control': 'no-store',
    })
    headers.append(
      'set-cookie',
      cookie(SIGN_IN, encode({ state, verifier }), SIGN_IN_SECONDS, 'Lax'),
    )
    return new Response(null, { status: 302, headers })
  })()
}

async function callback(
  request: Request,
  env: Required<ApiEnv>,
): Promise<Response> {
  const url = new URL(request.url)
  const params = url.searchParams
  const saved = decode(readCookie(request, SIGN_IN) ?? '') as {
    state?: unknown
    verifier?: unknown
  } | null
  const cleared = [clearSignIn()]
  if (params.get('error') === 'access_denied') return back('canceled', cleared)
  const code = params.get('code')
  if (
    !code ||
    typeof saved?.state !== 'string' ||
    typeof saved.verifier !== 'string' ||
    params.get('state') !== saved.state
  )
    return back('failed', cleared)
  let tokens
  try {
    tokens = await issued(
      await tokenRequest(env, request, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${url.origin}/api/callback`,
        code_verifier: saved.verifier,
        resource: SERVER,
      }),
    )
  } catch {
    tokens = null
  }
  if (!tokens) return back('failed', cleared)
  return back('on', [...cleared, tokensCookie(tokens)])
}

// Refuses requests the page itself didn't send.
function fromThePage(request: Request): boolean {
  if (request.headers.get(SYNC_HEADER) !== '1') return false
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') return false
  const origin = request.headers.get('origin')
  return origin === null || origin === new URL(request.url).origin
}

// Sends one request to the hosted server with this browser's token,
// refreshing it first when it's about to expire or once when it's refused.
async function withToken(
  request: Request,
  env: Required<ApiEnv>,
  send: (access: string) => Promise<Response>,
): Promise<{ response: Response | null; setCookie: string[]; ended: boolean }> {
  let tokens = tokensOf(request)
  if (!tokens) return { response: null, setCookie: [], ended: true }
  const expiring = tokens.expiresAt - Date.now() < REFRESH_EARLY_MS
  if (expiring) {
    const next = await refresh(env, request, tokens)
    if (next === 'ended')
      return { response: null, setCookie: [clearTokens()], ended: true }
    if (next === 'unreachable')
      return { response: null, setCookie: [], ended: false }
    tokens = next
  }
  const setCookie = expiring ? [tokensCookie(tokens)] : []
  let response = await send(tokens.access)
  if (response.status === 401 && !expiring) {
    const next = await refresh(env, request, tokens)
    if (next === 'ended')
      return { response: null, setCookie: [clearTokens()], ended: true }
    if (next === 'unreachable')
      return { response: null, setCookie, ended: false }
    setCookie.push(tokensCookie(next))
    response = await send(next.access)
  }
  if (response.status === 401)
    return { response: null, setCookie: [clearTokens()], ended: true }
  return { response, setCookie, ended: false }
}

const NOT_SYNCED = { error: 'not-synced' }
const UNREACHABLE = {
  error: 'unreachable',
  message: "earnrate's server can't be reached right now. Try again soon.",
}

async function wallet(
  request: Request,
  env: Required<ApiEnv>,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST')
    return json({ error: 'Use GET or POST.' }, 405)
  if (!fromThePage(request)) return json({ error: 'forbidden' }, 403)
  let body: string | null = null
  if (request.method === 'POST') {
    body = await readBody(request)
    if (body === null) return json({ error: 'Request too large.' }, 413)
  }
  const send = (access: string) =>
    env.MCP.fetch(
      new Request(
        `${SERVER}${request.method === 'GET' ? '/wallet' : '/wallet/changes'}`,
        {
          method: request.method,
          headers: {
            authorization: `Bearer ${access}`,
            ...(body === null ? {} : { 'content-type': 'application/json' }),
            ...visitor(request),
          },
          ...(body === null ? {} : { body }),
        },
      ),
    )
  let result
  try {
    result = await withToken(request, env, send)
  } catch {
    return json(UNREACHABLE, 503)
  }
  const { response, setCookie, ended } = result
  if (ended) return json(NOT_SYNCED, 401, setCookie)
  if (!response) return json(UNREACHABLE, 503, setCookie)
  // The server's own words, never its headers.
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed =
      response.status === 429
        ? { error: 'rate-limited', message: text }
        : { error: 'unreachable', message: text }
  }
  return json(parsed, response.status, setCookie)
}

async function disconnect(
  request: Request,
  env: Required<ApiEnv>,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  if (!fromThePage(request)) return json({ error: 'forbidden' }, 403)
  const tokens = tokensOf(request)
  if (tokens) {
    const signOut = (access: string) =>
      env.MCP.fetch(
        new Request(`${SERVER}/wallet/sign-out`, {
          method: 'POST',
          headers: { authorization: `Bearer ${access}`, ...visitor(request) },
        }),
      )
    const done = await withToken(request, env, signOut).then(
      (r) => r.response?.status === 204,
      () => false,
    )
    // Revoking the refresh token ends the grant too, if the sign-out
    // above couldn't run.
    if (!done)
      await tokenRequest(env, request, {
        token: tokens.refresh,
        token_type_hint: 'refresh_token',
      }).catch(() => undefined)
  }
  const headers = new Headers({ 'cache-control': 'no-store' })
  headers.append('set-cookie', clearTokens())
  return new Response(null, { status: 204, headers })
}

// earnrate.dev and preview.earnrate.dev only: the hosted server knows no
// other callback.
export async function api(request: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(request.url)
  if (!SITE_HOSTS.includes(url.hostname) || url.protocol !== 'https:')
    return json({ error: 'Not found.' }, 404)
  if (!env.MCP) return json(UNREACHABLE, 503)
  const bound = { MCP: env.MCP }
  switch (url.pathname) {
    case '/api/connect':
      return connect(request)
    case '/api/callback':
      return callback(request, bound)
    case '/api/wallet':
      return wallet(request, bound)
    case '/api/disconnect':
      return disconnect(request, bound)
    default:
      return json({ error: 'Not found.' }, 404)
  }
}
