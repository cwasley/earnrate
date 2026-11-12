import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { resolveSpendLines, spendLineFor } from '../src/engine/simulate.ts'
import { reportStart } from '../src/engine/wallet-report.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import {
  codeTables,
  decodeReport,
  encodeReport,
  roundedLines,
  shortCode,
  type ReportLink,
} from '../site/rate/link.ts'
import {
  GONE,
  reportSource,
  savedRows,
  storedSource,
} from '../site/rate/source.ts'
import { storedId } from '../site/rate/store.ts'
import { isTypicalRows, PAST_TYPICAL } from '../site/app/spending-rows.ts'
import { TYPICAL_MONTHLY_SPEND } from '../src/engine/simulate.ts'
import { ROOT } from './helpers.ts'

const catalog = await loadCatalog()

const lines = (rows: { what: string; monthly: number }[]) =>
  resolveSpendLines(
    catalog,
    rows.map((r) => spendLineFor(catalog, r.what, r.monthly)),
  )

const EIGHT: ReportLink = {
  input: {
    cards: [
      {
        id: 'amex-gold',
        picks: {},
        used: ['uber-cash', 'dining'],
        skipped: ['dunkin'],
      },
      { id: 'chase-sapphire-preferred', picks: {} },
      { id: 'chase-freedom-unlimited', picks: {} },
      {
        id: 'usbank-cash-plus',
        picks: {
          'five-percent': ['tv-internet-streaming', 'movie-theaters'],
          'two-percent': ['gas-ev-charging'],
        },
      },
      { id: 'citi-custom-cash', picks: { 'top-category': ['restaurants'] } },
      { id: 'amex-blue-cash-preferred', picks: {} },
      { id: 'citi-double-cash', picks: {} },
      { id: 'capital-one-venture-x', picks: {} },
    ],
    memberships: ['amazon-prime', 'costco'],
    valuations: { UR: 1.7, MR: 1.6 },
  },
  lines: lines([
    { what: 'Groceries', monthly: 503 },
    { what: 'Dining', monthly: 253 },
    { what: 'Gas', monthly: 153 },
    { what: 'Amazon', monthly: 103 },
    { what: 'Streaming (Netflix)', monthly: 43 },
    { what: 'Flights', monthly: 63 },
    { what: 'Hotels', monthly: 63 },
    { what: 'Other travel', monthly: 33 },
    { what: 'Everything else', monthly: 803 },
    { what: 'Costco', monthly: 214 },
  ]),
}

const essentials = (link: ReportLink) => ({
  input: link.input,
  lines:
    link.lines?.map((l) => ({
      label: l.label,
      monthly: l.monthly,
      merchantId: l.merchant.merchantId,
      category: l.merchant.category,
      source: l.merchant.source,
    })) ?? null,
})

describe('report links', () => {
  test('cards, picks, memberships, point values and spending come back as they went in, rounded to $5', () => {
    const fragment = encodeReport(catalog, EIGHT)
    const decoded = decodeReport(catalog, `#${fragment}`)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(essentials(decoded.link)).toEqual(
      essentials({ ...EIGHT, lines: roundedLines(EIGHT.lines ?? []) }),
    )
    expect(decoded.link.lines?.map((l) => l.monthly)).toEqual([
      505, 255, 155, 105, 45, 65, 65, 35, 805, 215,
    ])
    expect(encodeReport(catalog, decoded.link)).toBe(fragment)
  })

  test('which credits are marked used or not used come back, and whoever opens the link sees the same headline', () => {
    const decoded = decodeReport(catalog, encodeReport(catalog, EIGHT))
    if (!decoded.ok) throw new Error(decoded.message)
    const gold = decoded.link.input.cards.find((c) => c.id === 'amex-gold')
    expect(gold?.used).toEqual(['uber-cash', 'dining'])
    expect(gold?.skipped).toEqual(['dunkin'])
    const spending = {
      lines: roundedLines(EIGHT.lines ?? []),
      typical: false,
    }
    const own = reportStart(catalog, EIGHT.input, '2026-11-11', spending)
    const theirs = reportStart(catalog, decoded.link.input, '2026-11-11', {
      lines: decoded.link.lines ?? [],
      typical: false,
    })
    expect(own.counted.length).toBe(1)
    expect(theirs.net).toBe(own.net)
    expect(theirs.counted).toEqual(own.counted)
    expect(theirs.credits).toEqual(own.credits)
  })

  test('typical-style amounts go in a link as they are', () => {
    const typicalLines = lines(TYPICAL_MONTHLY_SPEND)
    expect(roundedLines(typicalLines).map((l) => l.monthly)).toEqual(
      TYPICAL_MONTHLY_SPEND.map((t) => t.monthly),
    )
    const link = { ...EIGHT, lines: typicalLines }
    const decoded = decodeReport(catalog, encodeReport(catalog, link))
    expect(decoded.ok && decoded.link.lines?.map((l) => l.monthly)).toEqual(
      TYPICAL_MONTHLY_SPEND.map((t) => t.monthly),
    )
  })

  test('typical spending stays out of the link', () => {
    const fragment = encodeReport(catalog, {
      input: {
        cards: [{ id: 'citi-double-cash', picks: {} }],
        memberships: [],
        valuations: {},
      },
      lines: null,
    })
    expect(fragment).toBe(`w=1/${shortCode('card', 'citi-double-cash')}`)
    const decoded = decodeReport(catalog, fragment)
    expect(decoded.ok && decoded.link.lines).toBeNull()
  })

  test('eight cards with picks, credit marks, memberships, point values and ten spending lines fit in a short link', () => {
    const fragment = encodeReport(catalog, EIGHT)
    expect(fragment.length).toBeLessThanOrEqual(240)
    expect(fragment).toMatch(/^w=1\/[0-9a-z.,/:-]+$/)
  })

  test('every card, category, membership, points currency and pick option has its own code', () => {
    const tables = codeTables(catalog)
    for (const [kind, table] of Object.entries(tables))
      expect(
        [...table.values()].filter((id) => id === null),
        kind,
      ).toEqual([])
    expect(tables.card.size).toBe(catalog.cards.length)
    expect(tables.category.size).toBe(catalog.categories.length)
    expect(tables.membership.size).toBe(catalog.memberships.length)
    expect(tables.currency.size).toBe(catalog.currencies.length)
    for (const card of catalog.cards) {
      const codes = card.choices.flatMap((c) =>
        Object.keys(c.options).map((o) => shortCode('option', `${c.id}/${o}`)),
      )
      expect(new Set(codes).size, card.id).toBe(codes.length)
      const credits = [
        ...card.credits.map((c) => c.id),
        ...card.free_nights.map((n) => n.id),
      ].map((id) => shortCode('credit', id))
      expect(new Set(credits).size, card.id).toBe(credits.length)
    }
  })

  test('a card earnrate no longer lists fails to a plain message, never to another card', () => {
    const fragment = encodeReport(catalog, EIGHT)
    const without: Catalog = {
      ...catalog,
      cards: catalog.cards.map((c) =>
        c.id === 'amex-gold' ? { ...c, id: 'amex-gold-renamed' } : c,
      ),
    }
    const decoded = decodeReport(without, fragment)
    expect(decoded).toEqual({
      ok: false,
      message:
        "This link names a card earnrate doesn't list any more, so the report can't be shown as it was shared.",
    })
  })

  test('a damaged, cut or made-up link fails to a message and never throws', () => {
    const fragment = encodeReport(catalog, EIGHT)
    const bad = [
      '',
      '#',
      'w=',
      'w=1',
      'w=1/',
      'w=0/abcd',
      'w=x/abcd',
      'w=1/zzzz',
      'w=1/!!!!',
      'w=1/abc',
      `w=1/${shortCode('card', 'amex-gold')},${shortCode('card', 'amex-gold')}`,
      `w=1/${shortCode('card', 'amex-gold')}/zzzz`,
      `w=1/${shortCode('card', 'amex-gold')}//${shortCode('currency', 'MR')}:0`,
      `w=1/${shortCode('card', 'amex-gold')}///0c${shortCode('category', 'dining')}`,
      `w=1/${shortCode('card', 'amex-gold')}///5mno-such-store`,
      `w=1/${shortCode('card', 'amex-gold')}/a/b/c/d`,
      'w=%E0%A4%A',
      fragment.slice(0, fragment.length - 3) + '!!!',
      'w=1/' + 'abcd,'.repeat(100),
    ]
    for (const b of bad) {
      const decoded = decodeReport(catalog, b)
      expect(decoded.ok, b).toBe(false)
      if (!decoded.ok) expect(decoded.message, b).toMatch(/^This link/)
    }
    const newer = decodeReport(catalog, 'w=2/abcd')
    expect(!newer.ok && newer.message).toMatch(/newer version/)
    const alphabet = 'w=1/abcdefghijklmnopqrstuvwxyz0123456789.,:/-%'
    let seed = 7
    const random = () => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    for (let i = 0; i < 2000; i++) {
      const text = Array.from(
        { length: Math.floor(random() * 60) },
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join('')
      expect(() => decodeReport(catalog, `w=1/${text}`)).not.toThrow()
    }
  })

  test("opening a shared link reads nothing of the visitor's own", () => {
    const fragment = `#${encodeReport(catalog, EIGHT)}`
    let reads = 0
    const source = reportSource(catalog, fragment, () => {
      reads++
      throw new Error('read the saved wallet')
    })
    expect(source.kind).toBe('shared')
    expect(reads).toBe(0)
    const bad = reportSource(catalog, '#w=1/zzzz', () => {
      reads++
      throw new Error('read the saved wallet')
    })
    expect(bad.kind).toBe('bad')
    expect(reads).toBe(0)
  })

  test("the page's code never writes the browser's storage, and its only requests are the short links' own, beyond the event counter", () => {
    const dir = path.join(ROOT, 'site/rate')
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f))
    expect(files).toContain('Rate.tsx')
    for (const f of files) {
      const source = readFileSync(path.join(dir, f), 'utf8')
      expect(source, f).not.toMatch(
        /\.(setItem|removeItem)\s*\(|localStorage\.clear|sessionStorage|indexedDB|document\.cookie|XMLHttpRequest|sendBeacon|WebSocket/,
      )
      if (f !== 'store.ts') expect(source, f).not.toMatch(/\bfetch\s*\(/)
      expect(source, f).not.toMatch(/app\/(settings|sync)\.ts/)
      expect(source, f).not.toMatch(/from '\.\.\/statement/)
    }
    const store = readFileSync(path.join(dir, 'store.ts'), 'utf8')
    const targets = [...store.matchAll(/\bfetch\(\s*([^,]+),/g)].map(
      (m) => m[1],
    )
    expect(targets).toEqual(["'/r'", '`/r/${id}/data`', '`/r/${saved.id}`'])
    expect(store.match(/credentials: 'omit'/g)?.length).toBe(3)
  })

  test('a short link is read by its id alone, and a gone one says so plainly', () => {
    expect(storedId('/r/7kq3mdx9')).toBe('7kq3mdx9')
    for (const p of ['/rate', '/r/', '/r/7kq3md', '/r/7kq3mdx0', '/r/a/b'])
      expect(storedId(p), p).toBeNull()
    const report = encodeReport(catalog, EIGHT).slice(2)
    const found = storedSource(catalog, { kind: 'found', report })
    expect(found.kind === 'shared' && found.stored).toBe(true)
    expect(storedSource(catalog, { kind: 'gone' })).toEqual({
      kind: 'bad',
      message: GONE,
    })
    expect(storedSource(catalog, { kind: 'found', report: 'junk' }).kind).toBe(
      'bad',
    )
  })

  test('without a link, the saved wallet is rated, or cards are picked when there is none', () => {
    const wallet = {
      valuations: {},
      memberships: [],
      cards: [{ id: 'amex-gold', cap_usage: {}, activated: [] }],
    }
    expect(reportSource(catalog, '', () => ({ wallet, rows: null })).kind).toBe(
      'own',
    )
    expect(
      reportSource(catalog, '#', () => ({
        wallet: { ...wallet, cards: [] },
        rows: null,
      })).kind,
    ).toBe('pick')
    expect(
      reportSource(catalog, '', () => ({ wallet: null, rows: null })).kind,
    ).toBe('pick')
    expect(savedRows('[{"what":"Dining","monthly":200},{"x":1}]')).toEqual([
      { what: 'Dining', monthly: 200 },
    ])
    expect(savedRows('not json')).toBeNull()
  })

  test('spending Find a card started with, in any order, reads as typical, as it does there', () => {
    const wallet = {
      valuations: {},
      memberships: [],
      cards: [{ id: 'amex-gold', cap_usage: {}, activated: [] }],
    }
    const reordered = [...TYPICAL_MONTHLY_SPEND].reverse()
    for (const rows of [...PAST_TYPICAL, reordered]) {
      const raw = JSON.stringify(rows)
      expect(savedRows(raw), raw).toBeNull()
      const source = reportSource(catalog, '', () => ({
        wallet,
        rows: savedRows(raw),
      }))
      expect(source.kind === 'own' && source.rows, raw).toBeNull()
    }
    expect(isTypicalRows(reordered)).toBe(true)
    const own = reordered.map((r) =>
      r.what === 'Groceries' ? { ...r, monthly: 600 } : r,
    )
    expect(savedRows(JSON.stringify(own))).toEqual(own)
    expect(isTypicalRows(own)).toBe(false)
  })
})
