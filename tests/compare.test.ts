import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { ALL_PERSONAL_CARDS, exploreCards } from '../src/engine/explore.ts'
import { simulateCatalog, typicalSpendLines } from '../src/engine/simulate.ts'
import {
  comparable,
  comparePairs,
  comparer,
  compareSlug,
  comparisonRedirects,
  MATCHUPS,
} from '../scripts/compare.ts'
import { RETIRED_COMPARISONS } from '../scripts/compare-retired.ts'

const TODAY = '2026-11-03'
const catalog = await loadCatalog()
const pairs = comparePairs(catalog)
const card = (id: string) => {
  const found = catalog.cards.find((c) => c.id === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}

test('the pair rule picks roughly 40 to 100 pairs, each once', () => {
  expect(pairs.length).toBeGreaterThanOrEqual(40)
  expect(pairs.length).toBeLessThanOrEqual(100)
  expect(new Set(pairs.map((p) => p.slug)).size).toBe(pairs.length)
})

test('comparison slugs put the card ids in alphabetical order', () => {
  for (const p of pairs) {
    expect(p.a < p.b, p.slug).toBe(true)
    expect(p.slug).toBe(`${p.a}-vs-${p.b}`)
    expect(compareSlug(p.b, p.a)).toBe(p.slug)
  }
  expect(comparePairs(catalog)).toEqual(pairs)
})

test('no pair mixes business and personal cards, or includes closed or store cards', () => {
  for (const p of pairs) {
    const [a, b] = [card(p.a), card(p.b)]
    expect(a.business, p.slug).toBe(b.business)
    expect(comparable(a) && comparable(b), p.slug).toBe(true)
    expect(a.applications_closed).toBeUndefined()
    expect(b.only_at).toBeUndefined()
  }
  for (const c of catalog.cards.filter((k) => !comparable(k)))
    expect(
      pairs.some((p) => p.a === c.id || p.b === c.id),
      c.id,
    ).toBe(false)
})

test('every pair is siblings from one issuer or a listed matchup', () => {
  const listed = new Set(MATCHUPS.map(([x, y]) => compareSlug(x, y)))
  for (const p of pairs) {
    const [a, b] = [card(p.a), card(p.b)]
    if (p.siblings) {
      expect(a.issuer, p.slug).toBe(b.issuer)
      expect(a.currency, p.slug).toBe(b.currency)
    }
    expect(p.siblings || listed.has(p.slug), p.slug).toBe(true)
  }
  // Every listed matchup of two open cards is built.
  for (const [x, y] of MATCHUPS) {
    const open = [x, y].map((id) => catalog.cards.find((c) => c.id === id))
    if (open.every((c) => c && comparable(c)))
      expect(
        pairs.some((p) => p.slug === compareSlug(x, y)),
        `${x} ${y}`,
      ).toBe(true)
  }
})

test("one issuer's cards for different partners aren't siblings", () => {
  for (const slug of [
    'paypal-cashback-mastercard-vs-sams-club-mastercard',
    'paypal-cashback-mastercard-vs-venmo-credit-card',
    'paypal-cashback-mastercard-vs-verizon-visa-card',
  ])
    expect(
      pairs.some((p) => p.slug === slug),
      slug,
    ).toBe(false)
  for (const slug of [
    'bilt-blue-vs-bilt-obsidian',
    'chase-freedom-flex-vs-chase-prime-visa',
    'citi-costco-anywhere-visa-vs-citi-double-cash',
  ])
    expect(pairs.find((p) => p.slug === slug)?.siblings, slug).toBe(true)
})

test('a comparison no longer built redirects to one of its cards, in either order', () => {
  const lines = comparisonRedirects(catalog, pairs)
  const to = new Map(
    lines.map((l) => {
      const [from = '', target = ''] = l.split(' ')
      return [from, target]
    }),
  )
  const ids = new Set(catalog.cards.map((c) => c.id))
  const built = new Set(pairs.map((p) => p.slug))
  expect(RETIRED_COMPARISONS.length).toBeGreaterThan(100)
  for (const slug of RETIRED_COMPARISONS) {
    if (built.has(slug)) continue
    const [a = '', b = ''] = slug.split('-vs-')
    const target = to.get(`/compare/${slug}`)
    expect(target, slug).toMatch(/^\/cards\/|^\/compare\/$/)
    if (target?.startsWith('/cards/'))
      expect([a, b]).toContain(target.slice('/cards/'.length))
    if (target?.startsWith('/cards/'))
      expect(ids.has(target.slice('/cards/'.length))).toBe(true)
    expect(to.get(`/compare/${b}-vs-${a}`), slug).toBe(target)
  }
  for (const p of pairs)
    expect(to.get(`/compare/${p.b}-vs-${p.a}`)).toBe(`/compare/${p.slug}`)
})

test("a comparison's numbers are the engine's", () => {
  const pair =
    pairs.find((p) => p.slug === 'amex-gold-vs-chase-sapphire-preferred') ??
    pairs.find((p) => !card(p.a).business)
  if (!pair) throw new Error('no personal pair')
  const c = comparer(catalog, TODAY)(pair)

  const sim = simulateCatalog(catalog, typicalSpendLines(catalog), {
    filters: ALL_PERSONAL_CARDS,
    memberships: [],
    valuations: {},
    start: TODAY,
  })
  const single = (id: string) =>
    sim.singles.find((s) => s.cards[0]?.cardId === id)
  expect(c.typical.a.net).toBe(single(pair.a)?.net)
  expect(c.typical.b.net).toBe(single(pair.b)?.net)

  const groceries = exploreCards(
    catalog,
    {
      merchant: null,
      category: 'grocery.supermarket',
      amount: null,
      channel: null,
      date: TODAY,
    },
    { filters: ALL_PERSONAL_CARDS, memberships: [], valuations: {} },
  )
  const row = c.rows.find((r) => r.label === 'Groceries')
  const rate = (id: string) =>
    groceries.ranked.find((e) => e.cardId === id)?.effectiveReturnPct
  expect(row?.a.entry?.effectiveReturnPct).toBe(rate(pair.a))
  expect(row?.b.entry?.effectiveReturnPct).toBe(rate(pair.b))
  const [ra, rb] = [rate(pair.a) ?? -1, rate(pair.b) ?? -1]
  expect(row?.winner).toBe(ra > rb ? 'a' : rb > ra ? 'b' : null)

  expect(c.rows.at(-1)?.label).toBe('Everything else')
  for (const r of c.rows)
    for (const cell of [r.a, r.b])
      expect(cell.entry !== null || cell.excluded !== null, r.label).toBe(true)
})
