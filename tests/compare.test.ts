import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { ALL_PERSONAL_CARDS, exploreCards } from '../src/engine/explore.ts'
import { simulateCatalog, typicalSpendLines } from '../src/engine/simulate.ts'
import {
  comparable,
  comparePairs,
  comparer,
  compareSlug,
  lastingBonuses,
} from '../scripts/compare.ts'

const TODAY = '2026-11-03'
const catalog = await loadCatalog()
const pairs = comparePairs(catalog, TODAY)
const card = (id: string) => {
  const found = catalog.cards.find((c) => c.id === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}

test('the pair rule picks roughly 100 to 250 pairs, each once', () => {
  expect(pairs.length).toBeGreaterThanOrEqual(100)
  expect(pairs.length).toBeLessThanOrEqual(250)
  expect(new Set(pairs.map((p) => p.slug)).size).toBe(pairs.length)
})

test('comparison slugs put the card ids in alphabetical order', () => {
  for (const p of pairs) {
    expect(p.a < p.b, p.slug).toBe(true)
    expect(p.slug).toBe(`${p.a}-vs-${p.b}`)
    expect(compareSlug(p.b, p.a)).toBe(p.slug)
  }
  expect(comparePairs(catalog, TODAY)).toEqual(pairs)
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

test('every pair is either rivals from two issuers or siblings from one', () => {
  const bonuses = lastingBonuses(catalog, TODAY)
  for (const p of pairs) {
    const [a, b] = [card(p.a), card(p.b)]
    if (p.siblings) {
      expect(a.issuer, p.slug).toBe(b.issuer)
      expect(a.currency, p.slug).toBe(b.currency)
    }
    if (p.rivals.length > 0) {
      expect(a.issuer, p.slug).not.toBe(b.issuer)
      expect(p.rivals.length).toBeGreaterThanOrEqual(2)
      for (const label of p.rivals) {
        expect(bonuses.get(a.id)?.has(label), `${p.slug} ${label}`).toBe(true)
        expect(bonuses.get(b.id)?.has(label), `${p.slug} ${label}`).toBe(true)
      }
      expect(a.currency === 'cash').toBe(b.currency === 'cash')
      expect(
        Math.abs((a.annual_fee ?? 0) - (b.annual_fee ?? 0)),
      ).toBeLessThanOrEqual(250)
    }
    expect(p.siblings || p.rivals.length > 0, p.slug).toBe(true)
  }
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
