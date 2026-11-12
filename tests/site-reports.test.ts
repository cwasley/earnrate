import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import {
  decodeReport,
  encodeReport,
  reportCodes,
  shortCode,
} from '../site/rate/link.ts'
import {
  DEAD_LINK,
  longUrl,
  NO_SHORT_LINK,
  pickLink,
} from '../site/rate/share.ts'
import { newLink, writeReport, type Written } from '../site/rate/store.ts'
import { checkReport } from '../site/report-check.ts'
import preview from '../site/preview-worker.ts'
import {
  MAX_CARDS,
  MAX_LINES,
  REPORT_LINKS_PER_DAY,
  REPORT_LINKS_PER_MINUTE,
  REPORT_MAX_LENGTH,
  REPORT_REFRESH_DAYS,
  REPORT_RETENTION_MONTHS,
  REPORT_RETENTION_SECONDS,
} from '../site/report-policy.ts'
import {
  BUSY,
  FULL,
  reports,
  type ReportMeta,
  type ReportStore,
} from '../site/reports.ts'
import {
  DELETE_HEADER,
  ID_ALPHABET,
  ID_HEADER,
  ID_LENGTH,
  KEY,
  newId,
  newKey,
  REPORT_HEADER,
} from '../site/report-ids.ts'
import worker, { type SiteEnv } from '../site/worker.ts'
import { ROOT } from './helpers.ts'

const SITE = 'https://earnrate.dev'
const catalog = await loadCatalog()
const REPORT = encodeReport(catalog, {
  input: {
    cards: [
      { id: 'amex-gold', picks: {}, used: ['dining'] },
      { id: 'citi-double-cash', picks: {} },
    ],
    memberships: ['amazon-prime'],
    valuations: { MR: 1.6 },
  },
  lines: null,
}).slice(2)
const OTHER = encodeReport(catalog, {
  input: {
    cards: [
      { id: 'citi-custom-cash', picks: { 'top-category': ['restaurants'] } },
    ],
    memberships: [],
    valuations: {},
  },
  lines: null,
}).slice(2)

const reportKeys = (entries: Map<string, unknown>) =>
  [...entries.keys()].filter((k) => k.startsWith('report:'))

type Entry = { value: string; ttl: number; metadata?: ReportMeta }

function memoryStore() {
  const entries = new Map<string, Entry>()
  const writes: string[] = []
  const store: ReportStore = {
    get: (key) => Promise.resolve(entries.get(key)?.value ?? null),
    getWithMetadata: (key: string) => {
      const e = entries.get(key)
      return Promise.resolve({
        value: e?.value ?? null,
        metadata: e?.metadata ?? null,
      })
    },
    put: (key, value, { expirationTtl, metadata }) => {
      writes.push(key)
      entries.set(key, {
        value,
        ttl: expirationTtl,
        ...(metadata ? { metadata } : {}),
      })
      return Promise.resolve()
    },
    delete: (key) => {
      entries.delete(key)
      return Promise.resolve()
    },
  }
  return { store, entries, writes }
}

function site(allow = true) {
  const { store, entries, writes } = memoryStore()
  const pages: string[] = []
  const env: SiteEnv = {
    ASSETS: {
      fetch: (r) => {
        const { pathname } = new URL(r.url)
        pages.push(pathname)
        return Promise.resolve(
          new Response(
            pathname === '/404' ? '<p>not found page</p>' : '<p>rate page</p>',
            { headers: { 'content-type': 'text/html' } },
          ),
        )
      },
    },
    REPORTS: store,
    REPORT_LIMITER: { limit: () => Promise.resolve({ success: allow }) },
  }
  const call = (
    pathname: string,
    init: { method?: string; body?: string } = {},
    headers: Record<string, string> = {},
  ) =>
    worker.fetch(
      new Request(`${SITE}${pathname}`, {
        ...init,
        headers: {
          [REPORT_HEADER]: '1',
          origin: SITE,
          'sec-fetch-site': 'same-origin',
          'cf-connecting-ip': '203.0.113.9',
          'user-agent': 'Mozilla/5.0 (iPhone) Safari',
          cookie: '__Secure-earnrate-wallet=secret-token',
          ...headers,
        },
      }),
      env,
    )
  const write = (link: Made, body = REPORT) =>
    call(
      '/r',
      { method: 'POST', body },
      { [ID_HEADER]: link.id, [DELETE_HEADER]: link.key },
    )
  const make = async (body = REPORT) => {
    const link = { id: newId(), key: newKey() }
    const res = await write(link, body)
    return { res, made: res.ok ? link : null }
  }
  return { env, entries, writes, pages, call, make, write }
}

type Made = { id: string; key: string }

const sha256 = async (text: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

afterEach(() => {
  vi.useRealTimers()
})

describe('short report links', () => {
  test('a report is stored with only its string, its delete key hash and the day, and reads back', async () => {
    const s = site()
    const { res, made } = await s.make()
    expect(res.status).toBe(201)
    if (!made) throw new Error('not made')
    expect(made.id).toMatch(
      new RegExp(`^[${ID_ALPHABET}]{${String(ID_LENGTH)}}$`),
    )
    const day = Math.floor(Date.now() / 86_400_000)
    expect([...s.entries.keys()].sort()).toEqual(
      [`links:${String(day)}`, `report:${made.id}`].sort(),
    )
    expect(s.entries.get(`links:${String(day)}`)).toEqual({
      value: '1',
      ttl: 2 * 86_400,
    })
    expect(s.entries.get(`report:${made.id}`)).toEqual({
      value: REPORT,
      ttl: REPORT_RETENTION_SECONDS,
      metadata: {
        key: await sha256(made.key),
        opened: Math.floor(Date.now() / 86_400_000),
      },
    })
    expect(res.headers.get('set-cookie')).toBeNull()
    const read = await s.call(`/r/${made.id}/data`)
    expect(read.status).toBe(200)
    expect(await read.text()).toBe(REPORT)
  })

  test('garbage, oversize and other versions are refused, and nothing is stored', async () => {
    const s = site()
    const bad = [
      '',
      'hello',
      `w=${REPORT}`,
      REPORT.replace(/^1\//, '2/'),
      `${REPORT}/x`,
      `${REPORT}<script>`,
      '1/abcd,' + 'abcd,'.repeat(200) + 'abcd',
      `1/abcd//zz:1`,
      `1/ABCD`,
    ]
    for (const body of bad) {
      const { res } = await s.make(body)
      expect([400, 413], body.slice(0, 40)).toContain(res.status)
    }
    expect(
      (await s.make(`1/${'abcd,'.repeat(REPORT_MAX_LENGTH)}abcd`)).res.status,
    ).toBe(413)
    expect(s.entries.size).toBe(0)
  })

  test('requests from another site, or without the page header, are refused', async () => {
    const s = site()
    for (const headers of [
      { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'cross-site' },
      { [REPORT_HEADER]: '' },
    ]) {
      const res = await s.call('/r', { method: 'POST', body: REPORT }, headers)
      expect(res.status).toBe(403)
    }
    expect(s.entries.size).toBe(0)
  })

  test('a link is made only at exactly /r, the path the rate limiting rule watches', async () => {
    const s = site()
    for (const path of ['/r/', '/r//', '//r']) {
      const res = await s.call(path, { method: 'POST', body: REPORT })
      expect(res.status).not.toBe(201)
      expect(res.headers.get('content-type') ?? '').not.toContain('json')
    }
    expect(s.entries.size).toBe(0)
    expect((await s.make()).res.ok).toBe(true)
  })

  test('the page makes ids and keys at random, and they never repeat', () => {
    const ids = new Set<string>()
    const keys = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const id = newId()
      const key = newKey()
      expect(id).toMatch(new RegExp(`^[${ID_ALPHABET}]{${String(ID_LENGTH)}}$`))
      expect(key).toMatch(KEY)
      ids.add(id)
      keys.add(key)
    }
    expect(ids.size).toBe(500)
    expect(keys.size).toBe(500)
  })

  test('the same id and key update the link in place, without counting toward the day', async () => {
    const s = site()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'))
    const day = Math.floor(Date.now() / 86_400_000)
    const { made } = await s.make()
    if (!made) throw new Error('not made')
    s.entries.set(`links:${String(day)}`, {
      value: String(REPORT_LINKS_PER_DAY),
      ttl: 2 * 86_400,
    })
    vi.setSystemTime(new Date('2027-03-01T12:00:00Z'))
    const later = Math.floor(Date.now() / 86_400_000)
    const res = await s.write(made, OTHER)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(s.entries.get(`report:${made.id}`)).toEqual({
      value: OTHER,
      ttl: REPORT_RETENTION_SECONDS,
      metadata: { key: await sha256(made.key), opened: later },
    })
    expect(s.entries.get(`links:${String(day)}`)?.value).toBe(
      String(REPORT_LINKS_PER_DAY),
    )
    expect(s.entries.has(`links:${String(later)}`)).toBe(false)
    expect(await (await s.call(`/r/${made.id}/data`)).text()).toBe(OTHER)
  })

  test("a link is changed only with its own key, and a refusal doesn't touch it", async () => {
    const s = site()
    const { made } = await s.make()
    if (!made) throw new Error('not made')
    const before = new Map(s.entries)
    for (const key of [newKey(), made.key.slice(0, -1) + 'A']) {
      if (key === made.key) continue
      const res = await s.write({ id: made.id, key }, OTHER)
      expect(res.status).toBe(403)
    }
    expect(s.entries).toEqual(before)
  })

  test('a bad id or key, or a garbage report sent to update a link, is refused', async () => {
    const s = site()
    const { made } = await s.make()
    if (!made) throw new Error('not made')
    const before = new Map(s.entries)
    const key = newKey()
    for (const id of [
      '',
      'abc',
      '7kq3mdx',
      '7kq3mdx90',
      '7kq3mdx0',
      '7KQ3MDX9',
      '7kq3-dx9',
      '../r/abc',
    ]) {
      const res = await s.write({ id, key })
      expect(res.status, id).toBe(400)
    }
    for (const bad of [
      '',
      'short',
      `${key}x`,
      key.replace(/.$/, '='),
      `${key.slice(1)}+`,
    ]) {
      const res = await s.write({ id: newId(), key: bad })
      expect(res.status, bad).toBe(400)
    }
    const missing = await s.call('/r', { method: 'POST', body: REPORT })
    expect(missing.status).toBe(400)
    for (const body of ['', 'hello', `${REPORT}/x`, '1/zzzz']) {
      const res = await s.write(made, body)
      expect(res.status, body).toBe(400)
    }
    expect(s.entries).toEqual(before)
  })

  test(`opening a link pushes its deletion back only when the last push is over ${String(REPORT_REFRESH_DAYS)} days old`, async () => {
    const s = site()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'))
    const { made } = await s.make()
    if (!made) throw new Error('not made')
    const writes = s.writes.length
    vi.setSystemTime(new Date('2026-12-10T12:00:00Z'))
    await s.call(`/r/${made.id}/data`)
    expect(s.writes.length).toBe(writes)
    vi.setSystemTime(new Date('2026-12-12T12:00:00Z'))
    await s.call(`/r/${made.id}/data`)
    expect(s.writes.length).toBe(writes + 1)
    const entry = s.entries.get(`report:${made.id}`)
    expect(entry?.ttl).toBe(REPORT_RETENTION_SECONDS)
    expect(entry?.metadata?.opened).toBe(
      Math.floor(Date.parse('2026-12-12T12:00:00Z') / 86_400_000),
    )
  })

  test('a link is deleted with its key and not without', async () => {
    const s = site()
    const { made } = await s.make()
    if (!made) throw new Error('not made')
    expect((await s.call(`/r/${made.id}`, { method: 'DELETE' })).status).toBe(
      403,
    )
    expect(
      (
        await s.call(
          `/r/${made.id}`,
          { method: 'DELETE' },
          { [DELETE_HEADER]: 'not-the-key' },
        )
      ).status,
    ).toBe(403)
    expect(reportKeys(s.entries)).toHaveLength(1)
    expect(
      (
        await s.call(
          `/r/${made.id}`,
          { method: 'DELETE' },
          { [DELETE_HEADER]: made.key },
        )
      ).status,
    ).toBe(204)
    expect(reportKeys(s.entries)).toEqual([])
    expect((await s.call(`/r/${made.id}/data`)).status).toBe(404)
  })

  test('over the rate limit, nothing is stored', async () => {
    const s = site(false)
    expect((await s.make()).res.status).toBe(429)
    expect(s.entries.size).toBe(0)
  })

  test("a link is handed back when the day's count can't be written, and refused when the link can't be", async () => {
    const s = site()
    const put = s.env.REPORTS?.put.bind(s.env.REPORTS)
    if (!s.env.REPORTS || !put) throw new Error('no store')
    s.env.REPORTS.put = (key, value, options) =>
      key.startsWith('links:')
        ? Promise.reject(new Error('one write a second'))
        : put(key, value, options)
    const { res, made } = await s.make()
    expect(res.status).toBe(201)
    expect(reportKeys(s.entries)).toEqual([`report:${made?.id ?? ''}`])

    const t = site()
    if (!t.env.REPORTS) throw new Error('no store')
    t.env.REPORTS.put = () => Promise.reject(new Error('store down'))
    expect((await t.make()).res.status).toBe(503)
  })

  test('a write refused because another tab just wrote the same report counts as written', async () => {
    const s = site()
    const put = s.env.REPORTS?.put.bind(s.env.REPORTS)
    if (!s.env.REPORTS || !put) throw new Error('no store')
    s.env.REPORTS.put = async (key, value, options) => {
      await put(key, value, options)
      if (key.startsWith('report:')) throw new Error('one write a second')
    }
    const { res, made } = await s.make()
    expect(res.status).toBe(201)
    if (!made) throw new Error('no link')
    expect((await s.write(made, REPORT)).status).toBe(204)
  })

  test('opening and deleting links is limited per address', async () => {
    const s = site()
    const { made } = await s.make()
    s.env.LIMITER = { limit: () => Promise.resolve({ success: false }) }
    const id = made?.id ?? ''
    expect((await s.call(`/r/${id}/data`)).status).toBe(429)
    expect((await s.call(`/r/${id}`, { method: 'DELETE' })).status).toBe(429)
    expect(reportKeys(s.entries)).toHaveLength(1)
  })

  test('the link itself serves the rate page, marked noindex', async () => {
    const s = site()
    const { made } = await s.make()
    const res = await s.call(`/r/${made?.id ?? ''}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<p>rate page</p>')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(s.pages).toEqual(['/rate'])
    for (const p of ['/r/abc', '/r/not-an-id', '/r/abcdefgh/other', '/r']) {
      const missing = await s.call(p)
      expect(missing.status, p).toBe(404)
      expect(await missing.text(), p).toBe('<p>not found page</p>')
    }
    expect(s.pages.slice(1)).toEqual(['/404', '/404', '/404', '/404'])
  })

  test('the preview has the same links in its own store', async () => {
    const { store, entries } = memoryStore()
    const res = await preview.fetch(
      new Request(`https://preview.earnrate.dev/r`, {
        method: 'POST',
        body: REPORT,
        headers: {
          [REPORT_HEADER]: '1',
          'sec-fetch-site': 'same-origin',
          [ID_HEADER]: newId(),
          [DELETE_HEADER]: newKey(),
        },
      }),
      {
        ASSETS: { fetch: () => Promise.resolve(new Response('page')) },
        REPORTS: store,
      },
    )
    expect(res.status).toBe(201)
    expect(reportKeys(entries)).toHaveLength(1)
    const preview_ = await readFile(
      path.join(ROOT, 'wrangler.preview.jsonc'),
      'utf8',
    )
    const live = await readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8')
    const id = (c: string) =>
      /"binding": "REPORTS", "id": "([0-9a-f]+)"/.exec(c)?.[1]
    expect(id(preview_)).toBeDefined()
    expect(id(live)).toBeDefined()
    expect(id(preview_)).not.toBe(id(live))
  })

  test('the privacy page and terms state how long a link is kept and how to delete it', async () => {
    const flat = (t: string) => t.replace(/\s+/g, ' ')
    const privacy = flat(
      await readFile(path.join(ROOT, 'site/privacy.html'), 'utf8'),
    )
    const terms = flat(
      await readFile(path.join(ROOT, 'site/terms.html'), 'utf8'),
    )
    const section = privacy.slice(privacy.indexOf('id="report-links"'))
    const months = `${String(REPORT_RETENTION_MONTHS)} months after it was last opened or updated`
    expect(section.slice(0, 2600)).toContain(months)
    expect(section.slice(0, 2600)).toContain('Delete this link')
    expect(section.slice(0, 2600)).toContain(
      'each change to your wallet, or to your amounts if you put spending in the link, sends the new contents to the same name',
    )
    expect(section.slice(0, 2600)).toContain(
      'until you delete the link or clear the site',
    )
    expect(section.slice(0, 2600)).toContain(
      `${String(REPORT_LINKS_PER_MINUTE)} links a minute`,
    )
    expect(section.slice(0, 2600)).toContain(
      `at most ${String(REPORT_LINKS_PER_DAY)} new links a day`,
    )
    expect(section.slice(0, 2600)).toContain(
      'which for a short link includes its name',
    )
    expect(terms).toContain(months)
    const wrangler = await readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8')
    expect(wrangler).toMatch(
      new RegExp(
        `"name": "REPORT_LIMITER",[^}]*"limit": ${String(REPORT_LINKS_PER_MINUTE)}, "period": 60`,
      ),
    )
  })

  test(`the whole site makes at most ${String(REPORT_LINKS_PER_DAY)} links a day, and the count starts again the next day`, async () => {
    const s = site()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'))
    const day = Math.floor(Date.now() / 86_400_000)
    s.entries.set(`links:${String(day)}`, {
      value: String(REPORT_LINKS_PER_DAY - 1),
      ttl: 2 * 86_400,
    })
    expect((await s.make()).res.status).toBe(201)
    expect(s.entries.get(`links:${String(day)}`)?.value).toBe(
      String(REPORT_LINKS_PER_DAY),
    )
    const before = new Map(s.entries)
    const refused = (await s.make()).res
    expect(refused.status).toBe(503)
    expect(await refused.text()).toBe(FULL)
    expect(s.entries).toEqual(before)
    vi.setSystemTime(new Date('2026-11-12T00:00:01Z'))
    expect((await s.make()).res.status).toBe(201)
    expect(s.entries.get(`links:${String(day + 1)}`)?.value).toBe('1')
  })

  test('the store holds only reports, their delete key hashes and days, and one count a day', async () => {
    const s = site()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'))
    const day = Math.floor(Date.now() / 86_400_000)
    const made: Made[] = []
    for (const body of [REPORT, OTHER, REPORT]) {
      const { made: m } = await s.make(body)
      if (!m) throw new Error('not made')
      made.push(m)
    }
    await s.call(`/r/${made[0]?.id ?? ''}/data`)
    await s.call(
      `/r/${made[1]?.id ?? ''}`,
      { method: 'DELETE' },
      {
        [DELETE_HEADER]: made[1]?.key ?? '',
      },
    )
    await s.make('1/zzzz')
    const [a, , c] = made
    if (!a || !c) throw new Error('not made')
    await s.write(a, OTHER)
    await s.write({ id: c.id, key: newKey() }, OTHER)
    expect(Object.fromEntries(s.entries)).toEqual({
      [`links:${String(day)}`]: { value: '3', ttl: 2 * 86_400 },
      [`report:${a.id}`]: {
        value: OTHER,
        ttl: REPORT_RETENTION_SECONDS,
        metadata: { key: await sha256(a.key), opened: day },
      },
      [`report:${c.id}`]: {
        value: REPORT,
        ttl: REPORT_RETENTION_SECONDS,
        metadata: { key: await sha256(c.key), opened: day },
      },
    })
  })

  test("a report naming anything earnrate does not list, a card twice, another card's option or too much is refused", async () => {
    const s = site()
    const gold = shortCode('card', 'amex-gold')
    const cash = shortCode('card', 'usbank-cash-plus')
    const custom = shortCode('card', 'citi-custom-cash')
    const restaurants = shortCode('option', 'top-category/restaurants')
    const dining = shortCode('category', 'dining')
    const many = catalog.cards
      .slice(0, MAX_CARDS + 1)
      .map((c) => shortCode('card', c.id))
    const bad = [
      '1/zzzz',
      `1/${gold},zzzz`,
      `1/${gold},${gold}`,
      `1/${gold}.p${restaurants}`,
      `1/${custom}.p${restaurants}.p${restaurants}`,
      `1/${cash}.p${restaurants}`,
      `1/${gold}.u${shortCode('credit', 'no-such-credit')}`,
      `1/${gold}/zzzz`,
      `1/${gold}/${shortCode('membership', 'amazon-prime')},${shortCode('membership', 'amazon-prime')}`,
      `1/${gold}//zzzz:1.5`,
      `1/${gold}//${shortCode('currency', 'MR')}:0`,
      `1/${gold}///5mno-such-store`,
      `1/${gold}///5czzzz`,
      `1/${gold}///5c${dining}.${dining}`,
      `1/${many.join(',')}`,
      `1/${gold}///${Array.from({ length: MAX_LINES + 1 }, () => `5c${dining}`).join(',')}`,
    ]
    for (const body of bad) {
      expect(body.length, body).toBeLessThanOrEqual(REPORT_MAX_LENGTH)
      expect((await s.make(body)).res.status, body).toBe(400)
    }
    expect(s.entries.size).toBe(0)
    for (const body of [
      `1/${custom}.p${restaurants}`,
      `1/${many.slice(0, MAX_CARDS).join(',')}`,
      `1/${gold}///${Array.from({ length: MAX_LINES }, () => `5c${dining}`).join(',')}`,
    ])
      expect((await s.make(body)).res.status, body).toBe(201)
  })

  test('the Worker and the page refuse the same reports', () => {
    const codes = reportCodes(catalog)
    const same = (text: string) => {
      expect(checkReport(text, codes), text).toBe(
        decodeReport(catalog, `w=${text}`).ok,
      )
    }
    same(REPORT)
    same(OTHER)
    const tokens = [
      ...catalog.cards.slice(0, 6).map((c) => shortCode('card', c.id)),
      shortCode('option', 'top-category/restaurants'),
      shortCode('credit', 'dining'),
      shortCode('membership', 'costco'),
      shortCode('currency', 'MR'),
      shortCode('category', 'dining'),
      'costco',
      'zzzz',
    ]
    const glue = ['/', ',', '.p', '.u', '.x', ':1.5', '5c', '5m', '5o', '.']
    let seed = 11
    const random = () => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    const pick = <T>(a: T[]) => a[Math.floor(random() * a.length)] as T
    for (let i = 0; i < 3000; i++) {
      const parts = Array.from({ length: 1 + Math.floor(random() * 8) }, () =>
        random() < 0.5 ? pick(tokens) : pick(glue),
      )
      same(`1/${parts.join('')}`)
      const real = [REPORT, OTHER][i % 2] ?? REPORT
      const at = Math.floor(random() * real.length)
      same(real.slice(0, at) + pick([...tokens, ...glue]) + real.slice(at + 1))
    }
  })

  test('a link made before the card data changed still opens', async () => {
    const { store } = memoryStore()
    const env = {
      ASSETS: { fetch: () => Promise.resolve(new Response('page')) },
      REPORTS: store,
    }
    const call = (
      codes: ReturnType<typeof reportCodes>,
      path: string,
      method = 'GET',
      body?: string,
      headers: Record<string, string> = {},
    ) =>
      reports(
        new Request(`${SITE}${path}`, {
          method,
          ...(body === undefined ? {} : { body }),
          headers: {
            [REPORT_HEADER]: '1',
            'sec-fetch-site': 'same-origin',
            ...headers,
          },
        }),
        env,
        codes,
      )
    const made = { id: newId(), key: newKey() }
    const link = { [ID_HEADER]: made.id, [DELETE_HEADER]: made.key }
    expect(
      (await call(reportCodes(catalog), '/r', 'POST', REPORT, link)).status,
    ).toBe(201)
    const none = {
      cards: {},
      memberships: [],
      currencies: [],
      categories: [],
      merchants: [],
    }
    expect((await call(none, '/r', 'POST', REPORT, link)).status).toBe(400)
    const read = await call(none, `/r/${made.id}/data`)
    expect(read.status).toBe(200)
    expect(await read.text()).toBe(REPORT)
  })

  test("the page names the link before anything is sent, and offers the link that isn't saved anywhere when it can't be made", async () => {
    const named = { id: '7kq3mdx9', key: newKey() }
    const fresh = pickLink(SITE, REPORT, null, () => named)
    expect(fresh).toEqual({
      url: `${SITE}/r/7kq3mdx9`,
      short: true,
      fresh: named,
    })
    expect(
      pickLink(SITE, REPORT, named, () => {
        throw new Error('named another')
      }),
    ).toEqual({ url: `${SITE}/r/7kq3mdx9`, short: true, fresh: null })
    expect(pickLink(SITE, REPORT, 'unavailable', newLink)).toEqual({
      url: `${SITE}/rate#w=${REPORT}`,
      short: false,
      fresh: null,
    })
    expect(longUrl(SITE, REPORT)).toBe(`${SITE}/rate#w=${REPORT}`)

    const answers: [() => Promise<Response>, Written][] = [
      [() => Promise.resolve(new Response(null, { status: 201 })), 'ok'],
      [() => Promise.resolve(new Response(null, { status: 204 })), 'ok'],
      [() => Promise.resolve(new Response(BUSY, { status: 429 })), 'busy'],
      [() => Promise.resolve(new Response(FULL, { status: 503 })), 'full'],
      [() => Promise.resolve(new Response(null, { status: 503 })), 'offline'],
      [() => Promise.resolve(new Response(null, { status: 400 })), 'refused'],
      [() => Promise.resolve(new Response(null, { status: 403 })), 'refused'],
      [() => Promise.reject(new TypeError('offline')), 'offline'],
    ]
    for (const [answer, written] of answers) {
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(answer)
      expect(await writeReport(named, REPORT)).toBe(written)
      expect(spy).toHaveBeenCalledTimes(1)
      const [url, init] = spy.mock.calls[0] ?? []
      expect(url).toBe('/r')
      expect(init?.method).toBe('POST')
      expect(init?.credentials).toBe('omit')
      expect(init?.body).toBe(REPORT)
      expect(init?.headers).toEqual({
        [REPORT_HEADER]: '1',
        [ID_HEADER]: named.id,
        [DELETE_HEADER]: named.key,
        'content-type': 'text/plain',
      })
      spy.mockRestore()
    }
    expect(NO_SHORT_LINK).toMatch(/^A short link can't be made right now\./)
    expect(DEAD_LINK).toMatch(/won't open/)
  })
})
