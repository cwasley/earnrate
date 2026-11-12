import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { encodeReport } from '../site/rate/link.ts'
import preview from '../site/preview-worker.ts'
import {
  REPORT_LINKS_PER_MINUTE,
  REPORT_MAX_LENGTH,
  REPORT_REFRESH_DAYS,
  REPORT_RETENTION_MONTHS,
  REPORT_RETENTION_SECONDS,
} from '../site/report-policy.ts'
import {
  DELETE_HEADER,
  ID_ALPHABET,
  ID_LENGTH,
  REPORT_HEADER,
  type ReportMeta,
  type ReportStore,
} from '../site/reports.ts'
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

type Entry = { value: string; ttl: number; metadata: ReportMeta }

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
      entries.set(key, { value, ttl: expirationTtl, metadata })
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
        pages.push(new URL(r.url).pathname)
        return Promise.resolve(
          new Response('<p>rate page</p>', {
            headers: { 'content-type': 'text/html' },
          }),
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
  const make = async (body = REPORT) => {
    const res = await call('/r', { method: 'POST', body })
    return { res, made: res.ok ? ((await res.json()) as Made) : null }
  }
  return { env, entries, writes, pages, call, make }
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
    expect([...s.entries.keys()]).toEqual([`report:${made.id}`])
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

  test('ids are random, never repeat, and a taken one is skipped', async () => {
    const s = site()
    const ids = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const { made } = await s.make()
      ids.add(made?.id ?? '')
    }
    expect(ids.size).toBe(200)
    const taken = [...ids][0] ?? ''
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce(((
      a: Uint8Array,
    ) => {
      const bytes = a
      const want = Array.from(taken, (c) => ID_ALPHABET.indexOf(c))
      bytes.forEach((_, i) => {
        bytes[i] = want[i % want.length] ?? 0
      })
      return a
    }) as typeof crypto.getRandomValues)
    const { made } = await s.make()
    spy.mockRestore()
    expect(made?.id).not.toBe(taken)
    expect(s.entries.get(`report:${taken}`)?.value).toBe(REPORT)
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
    expect(entry?.metadata.opened).toBe(
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
    expect(s.entries.size).toBe(1)
    expect(
      (
        await s.call(
          `/r/${made.id}`,
          { method: 'DELETE' },
          { [DELETE_HEADER]: made.key },
        )
      ).status,
    ).toBe(204)
    expect(s.entries.size).toBe(0)
    expect((await s.call(`/r/${made.id}/data`)).status).toBe(404)
  })

  test('over the rate limit, nothing is stored', async () => {
    const s = site(false)
    expect((await s.make()).res.status).toBe(429)
    expect(s.entries.size).toBe(0)
  })

  test('the link itself serves the rate page, marked noindex', async () => {
    const s = site()
    const { made } = await s.make()
    const res = await s.call(`/r/${made?.id ?? ''}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<p>rate page</p>')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(s.pages).toEqual(['/rate'])
    expect((await s.call('/r/not-an-id')).status).toBe(404)
    expect((await s.call('/r/abcdefgh/other')).status).toBe(404)
  })

  test('the preview has the same links in its own store', async () => {
    const { store, entries } = memoryStore()
    const res = await preview.fetch(
      new Request(`https://preview.earnrate.dev/r`, {
        method: 'POST',
        body: REPORT,
        headers: { [REPORT_HEADER]: '1', 'sec-fetch-site': 'same-origin' },
      }),
      {
        ASSETS: { fetch: () => Promise.resolve(new Response('page')) },
        REPORTS: store,
      },
    )
    expect(res.status).toBe(201)
    expect(entries.size).toBe(1)
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
    const months = `${String(REPORT_RETENTION_MONTHS)} months after it was last opened`
    expect(section.slice(0, 2000)).toContain(months)
    expect(section.slice(0, 2000)).toContain('Delete this link')
    expect(section.slice(0, 2000)).toContain(
      `${String(REPORT_LINKS_PER_MINUTE)} links a minute`,
    )
    expect(terms).toContain(months)
    const wrangler = await readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8')
    expect(wrangler).toMatch(
      new RegExp(
        `"name": "REPORT_LIMITER",[^}]*"limit": ${String(REPORT_LINKS_PER_MINUTE)}, "period": 60`,
      ),
    )
  })
})
