import { describe, expect, test } from 'vitest'
import { SYNC_HEADER } from '../site/api.ts'
import { cardChangeOf } from '../site/app/sync.ts'
import preview from '../site/preview-worker.ts'
import worker, { type SiteEnv } from '../site/worker.ts'
import { deployment, ORIGIN } from './remote-helpers.ts'

const SITE = 'https://earnrate.dev'
const TOKENS = '__Secure-earnrate-wallet'
const SIGN_IN = '__Secure-earnrate-sign-in'
const PAGE = { [SYNC_HEADER]: '1' }

type Tokens = { access: string; refresh: string; expiresAt: number }

const decodeTokens = (value: string): Tokens =>
  JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
        c.charCodeAt(0),
      ),
    ),
  ) as Tokens

const encodeTokens = (tokens: Tokens) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(tokens))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const unescape = (html: string) =>
  html.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))

// A browser on earnrate.dev (or the preview), with a cookie jar, talking to
// the site Worker, whose MCP binding reaches an in-memory hosted server.
function browser(origin = SITE, site = worker) {
  const d = deployment()
  const forwarded: Request[] = []
  const env: SiteEnv = {
    ASSETS: { fetch: () => Promise.resolve(new Response('page')) },
    MCP: {
      fetch: (request) => {
        forwarded.push(request.clone())
        return d.fetch(request)
      },
    },
  }
  const jar = new Map<string, string>()
  const tokensSeen = new Set<string>()
  const pageSaw: { body: string; location: string | null }[] = []
  const setCookies: string[] = []

  async function fetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    const cookies = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    if (cookies) headers.set('cookie', cookies)
    headers.set('cf-connecting-ip', '198.51.100.4')
    const res = await site.fetch(
      new Request(`${origin}${path}`, { ...init, headers, redirect: 'manual' }),
      env,
    )
    for (const c of res.headers.getSetCookie()) {
      setCookies.push(c)
      const [pair = ''] = c.split(';')
      const at = pair.indexOf('=')
      const name = pair.slice(0, at)
      const value = pair.slice(at + 1)
      if (/Max-Age=0\b/.test(c)) jar.delete(name)
      else jar.set(name, value)
      if (name === TOKENS && value) {
        const t = decodeTokens(value)
        tokensSeen.add(t.access)
        tokensSeen.add(t.refresh)
      }
    }
    pageSaw.push({
      body: await res.clone().text(),
      location: res.headers.get('location'),
    })
    return res
  }

  const tokens = () => {
    const value = jar.get(TOKENS)
    return value ? decodeTokens(value) : null
  }
  const setTokens = (t: Tokens) => jar.set(TOKENS, encodeTokens(t))

  // Connect, then on earnrate's sign-in page start a wallet (or type a
  // code), and come back to the callback.
  async function syncOn(code: string | null = null) {
    const start = await fetch('/api/connect')
    expect(start.status).toBe(302)
    const authorize = start.headers.get('location') ?? ''
    expect(authorize.startsWith(`${ORIGIN}/authorize?`)).toBe(true)
    const shown = await d.fetch(new Request(authorize))
    const consent = shown.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    const page = await shown.text()
    const handle = unescape(
      /name="handle" value="([^"]+)"/.exec(page)?.[1] ?? '',
    )
    const chosen = await d.fetch(
      new Request(authorize, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: consent,
        },
        body: new URLSearchParams(
          code === null
            ? { handle, choice: 'new' }
            : { handle, choice: 'recover', code },
        ).toString(),
        redirect: 'manual',
      }),
    )
    let recoveryCode = code
    let link: string
    if (code === null) {
      const html = await chosen.text()
      recoveryCode = /<div class="code">([^<]+)<\/div>/.exec(html)?.[1] ?? ''
      link = unescape(/class="button" href="([^"]+)"/.exec(html)?.[1] ?? '')
    } else link = chosen.headers.get('location') ?? ''
    const callback = new URL(link)
    expect(callback.origin).toBe(origin)
    const back = await fetch(callback.pathname + callback.search)
    return { back, code: recoveryCode ?? '' }
  }

  const wallet = (init: RequestInit = {}) =>
    fetch('/api/wallet', {
      ...init,
      headers: { ...PAGE, ...(init.headers as Record<string, string>) },
    })
  const change = (tool: string, input: Record<string, unknown>) =>
    wallet({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool, input }),
    })

  return {
    d,
    env,
    jar,
    fetch,
    syncOn,
    wallet,
    change,
    tokens,
    setTokens,
    tokensSeen,
    pageSaw,
    setCookies,
    forwarded,
  }
}

describe('earnrate.dev wallet sync', () => {
  test('connect keeps the PKCE verifier in a short-lived HttpOnly cookie and goes to the sign-in page', async () => {
    const b = browser()
    const res = await b.fetch('/api/connect')
    expect(res.status).toBe(302)
    const to = new URL(res.headers.get('location') ?? '')
    expect(to.origin + to.pathname).toBe(`${ORIGIN}/authorize`)
    expect(to.searchParams.get('client_id')).toBe('earnrate-site')
    expect(to.searchParams.get('redirect_uri')).toBe(
      'https://earnrate.dev/api/callback',
    )
    expect(to.searchParams.get('code_challenge_method')).toBe('S256')
    const [signIn] = b.setCookies
    expect(signIn).toMatch(
      new RegExp(
        `^${SIGN_IN}=[\\w-]+; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600$`,
      ),
    )
    const saved = decodeTokens(b.jar.get(SIGN_IN) ?? '') as unknown as {
      state: string
      verifier: string
    }
    expect(to.searchParams.get('state')).toBe(saved.state)
    expect(to.toString()).not.toContain(saved.verifier)
  })

  test('the callback keeps the tokens in an HttpOnly, Secure, SameSite=Strict cookie for /api only', async () => {
    const b = browser()
    const { back } = await b.syncOn()
    expect(back.status).toBe(303)
    expect(back.headers.get('location')).toBe('/#wallet&sync=on')
    expect(await back.text()).toBe('')
    const set = b.setCookies.filter((c) => c.startsWith(`${TOKENS}=`))
    expect(set).toHaveLength(1)
    expect(set[0]).toMatch(
      new RegExp(
        `^${TOKENS}=[\\w-]+; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${String(90 * 24 * 60 * 60)}$`,
      ),
    )
    expect(b.jar.has(SIGN_IN)).toBe(false)
    expect(b.tokens()?.access).toMatch(/^[^:]+:[^:]+:[^:]+$/)
  })

  test('the page reads and changes the wallet through /api/wallet', async () => {
    const b = browser()
    await b.syncOn()
    const empty = await b.wallet()
    expect(empty.status).toBe(200)
    expect(empty.headers.get('cache-control')).toBe('no-store')
    expect(
      ((await empty.json()) as { wallet: { cards: [] } }).wallet.cards,
    ).toEqual([])
    const added = await b.change('add_card', { cardId: 'amex-gold' })
    expect(added.status).toBe(200)
    const body = (await added.json()) as {
      message: string
      wallet: { cards: { id: string }[] }
    }
    expect(body.message).toMatch(/^Added /)
    expect(body.wallet.cards.map((c) => c.id)).toEqual(['amex-gold'])
    const refused = await b.change('remove_card', {
      cardId: 'citi-double-cash',
    })
    expect(refused.status).toBe(422)
    expect(((await refused.json()) as { error: string }).error).toBeTruthy()
  })

  test("what a free night is worth syncs like the card's other settings", async () => {
    const b = browser()
    await b.syncOn()
    await b.change('add_card', { cardId: 'amex-hilton-honors-aspire' })
    const set = await b.change(
      'update_card',
      cardChangeOf({
        id: 'amex-hilton-honors-aspire',
        enrolled: ['anniversary-night'],
        skippedCredits: [],
        nightValues: { 'anniversary-night': 450 },
      }),
    )
    expect(set.status).toBe(200)
    const saved = (await (await b.wallet()).json()) as {
      wallet: { cards: { night_values?: Record<string, number> }[] }
    }
    expect(saved.wallet.cards[0]?.night_values).toEqual({
      'anniversary-night': 450,
    })
    const refused = await b.change('update_card', {
      cardId: 'amex-hilton-honors-aspire',
      nightValues: { 'anniversary-night': 6000 },
    })
    expect(refused.status).toBe(422)
    expect(((await refused.json()) as { error: string }).error).toMatch(
      /at most \$5,000/,
    )
  })

  test('no token ever reaches a response body or a redirect the page sees', async () => {
    const b = browser()
    const { code } = await b.syncOn()
    await b.wallet()
    await b.change('add_card', { cardId: 'amex-gold' })
    const t = b.tokens()
    if (t) b.setTokens({ ...t, expiresAt: 0 })
    await b.wallet()
    await b.fetch('/api/disconnect', { method: 'POST', headers: PAGE })
    await b.syncOn(code)
    expect(b.tokensSeen.size).toBeGreaterThanOrEqual(6)
    for (const seen of b.pageSaw)
      for (const token of b.tokensSeen) {
        expect(seen.body).not.toContain(token)
        expect(seen.location ?? '').not.toContain(token)
      }
  })

  test('the hosted server gets only the token, the visitor address and the change', async () => {
    const b = browser()
    await b.syncOn()
    await b.change('add_card', { cardId: 'amex-gold' })
    const sent = b.forwarded.filter((r) => r.url.includes('/wallet'))
    expect(sent.length).toBeGreaterThan(0)
    for (const r of sent) {
      expect([...r.headers.keys()].sort()).toEqual(
        r.method === 'POST'
          ? ['authorization', 'cf-connecting-ip', 'content-type']
          : ['authorization', 'cf-connecting-ip'],
      )
    }
  })

  test("a request the page didn't send is refused", async () => {
    const b = browser()
    await b.syncOn()
    const body = JSON.stringify({
      tool: 'add_card',
      input: { cardId: 'amex-gold' },
    })
    const tries = [
      b.fetch('/api/wallet', { method: 'POST', body }),
      b.fetch('/api/wallet'),
      b.fetch('/api/wallet', {
        method: 'POST',
        body,
        headers: { ...PAGE, 'sec-fetch-site': 'same-site' },
      }),
      b.fetch('/api/wallet', {
        method: 'POST',
        body,
        headers: { ...PAGE, origin: 'https://preview.earnrate.dev' },
      }),
      b.fetch('/api/disconnect', { method: 'POST' }),
    ]
    for (const res of await Promise.all(tries)) expect(res.status).toBe(403)
    expect(b.jar.has(TOKENS)).toBe(true)
    const read = (await (await b.wallet()).json()) as {
      wallet: { cards: [] }
    }
    expect(read.wallet.cards).toEqual([])
  })

  test('an expiring token is refreshed first, and a refused one once', async () => {
    const b = browser()
    await b.syncOn()
    const first = b.tokens()
    if (!first) throw new Error('not synced')
    b.setTokens({ ...first, expiresAt: Date.now() + 1000 })
    expect((await b.wallet()).status).toBe(200)
    const second = b.tokens()
    expect(second?.access).not.toBe(first.access)
    expect(second?.refresh).not.toBe(first.refresh)
    expect(second?.expiresAt).toBeGreaterThan(Date.now() + 30 * 60 * 1000)

    if (!second) throw new Error('not synced')
    const [user = '', grant = ''] = second.access.split(':')
    b.setTokens({ ...second, access: `${user}:${grant}:wrong` })
    expect((await b.wallet()).status).toBe(200)
    expect(b.tokens()?.access).not.toContain('wrong')
  })

  test('requests one after another keep refreshing the token', async () => {
    const b = browser()
    await b.syncOn()
    for (let i = 0; i < 3; i++) {
      const tokens = b.tokens()
      if (!tokens) throw new Error('signed out')
      b.setTokens({ ...tokens, expiresAt: 0 })
      expect((await b.wallet()).status).toBe(200)
    }
  })

  test('disconnect revokes the grant and clears the cookie', async () => {
    const b = browser()
    await b.syncOn()
    const before = b.tokens()
    if (!before) throw new Error('not synced')
    const out = await b.fetch('/api/disconnect', {
      method: 'POST',
      headers: PAGE,
    })
    expect(out.status).toBe(204)
    expect(b.setCookies.at(-1)).toBe(
      `${TOKENS}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    )
    expect(b.jar.has(TOKENS)).toBe(false)
    const hosted = await b.d.fetch('/wallet', {
      headers: { authorization: `Bearer ${before.access}` },
    })
    expect(hosted.status).toBe(401)
    const refreshed = await b.d.fetch('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: before.refresh,
        client_id: 'earnrate-site',
      }).toString(),
    })
    expect(refreshed.status).toBe(400)
    const after = await b.wallet()
    expect(after.status).toBe(401)
    expect(await after.json()).toEqual({ error: 'not-synced' })
  })

  test('changing the recovery code signs this browser out and clears its cookie', async () => {
    const b = browser()
    const { code } = await b.syncOn()
    const changed = await b.d.fetch('/change-code', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code }).toString(),
    })
    expect(changed.status).toBe(200)
    const res = await b.wallet()
    expect(res.status).toBe(401)
    expect(b.jar.has(TOKENS)).toBe(false)
  })

  test('a canceled or forged sign-in sets no token', async () => {
    const b = browser()
    const canceled = await b.fetch('/api/callback?error=access_denied&state=x')
    expect(canceled.headers.get('location')).toBe('/#wallet&sync=canceled')
    await b.fetch('/api/connect')
    const forged = await b.fetch('/api/callback?code=a:b:c&state=not-it')
    expect(forged.headers.get('location')).toBe('/#wallet&sync=failed')
    expect(b.jar.has(SIGN_IN)).toBe(false)
    const noCookie = await b.fetch('/api/callback?code=a:b:c&state=x')
    expect(noCookie.headers.get('location')).toBe('/#wallet&sync=failed')
    expect(b.jar.has(TOKENS)).toBe(false)
  })

  test('a change over 64 KB is refused before it is sent', async () => {
    const b = browser()
    await b.syncOn()
    const sent = b.forwarded.length
    const res = await b.wallet({
      method: 'POST',
      body: JSON.stringify({
        tool: 'add_card',
        input: { x: 'a'.repeat(70_000) },
      }),
    })
    expect(res.status).toBe(413)
    expect(b.forwarded).toHaveLength(sent)
  })

  test('without the hosted server, the page is told so', async () => {
    const b = browser()
    delete b.env.MCP
    const res = await b.wallet()
    expect(res.status).toBe(503)
  })

  test('only /api/* runs here; /count and every other path are unchanged', async () => {
    const b = browser()
    expect(await (await b.fetch('/')).text()).toBe('page')
    expect(await (await b.fetch('/api')).text()).toBe('page')
    expect(await (await b.fetch('/apiary')).text()).toBe('page')
    expect((await b.fetch('/api/other')).status).toBe(404)
    expect(
      (await b.fetch('/count', { method: 'POST', body: 'x' })).status,
    ).toBe(204)
    expect(b.forwarded).toEqual([])
    const elsewhere = await worker.fetch(
      new Request('https://earnrate.workers.dev/api/connect'),
      b.env,
    )
    expect(elsewhere.status).toBe(404)
  })

  test('the preview signs in with its own callback, against the same server', async () => {
    const b = browser('https://preview.earnrate.dev', preview)
    const start = await b.fetch('/api/connect')
    expect(
      new URL(start.headers.get('location') ?? '').searchParams.get(
        'redirect_uri',
      ),
    ).toBe('https://preview.earnrate.dev/api/callback')
    const { back } = await b.syncOn()
    expect(back.headers.get('location')).toBe('/#wallet&sync=on')
    expect((await b.change('add_card', { cardId: 'amex-gold' })).status).toBe(
      200,
    )
  })
})
