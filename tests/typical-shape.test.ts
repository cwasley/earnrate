import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { ALL_PERSONAL_CARDS } from '../src/engine/explore.ts'
import {
  resolveSpendLines,
  simulateSingles,
  spendLineFor,
  typicalSpendLines,
  type ResolvedLine,
} from '../src/engine/simulate.ts'
import {
  family,
  lineGaps,
  SHAPE_MISSES,
  COVERAGE_MISSES,
  type LineGap,
} from '../scripts/typical-shape.ts'

const catalog = await loadCatalog()
const TODAY = '2026-11-11'
const year = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 10 + i, 15))
  return d.toISOString().slice(0, 10)
})

const alone = (cardId: string, lines: ResolvedLine[]) => {
  const card = catalog.cards.find((c) => c.id === cardId)
  if (!card) throw new Error(cardId)
  const [sim] = simulateSingles(catalog, [card], lines, {
    filters: ALL_PERSONAL_CARDS,
    memberships: [],
    valuations: {},
    start: TODAY,
  })
  if (!sim) throw new Error(cardId)
  return sim
}

// Parts of a kind of spending the typical month has a line for, but that no
// line names: a rule paying only on one of them is out of the month on
// purpose. Splitting a line to reach one changes the amounts, which is the
// maintainer's call.
const UNREACHED: Record<string, string> = {
  'grocery.online': 'groceries are spent at supermarkets',
  'dining.fast_food': 'restaurants are restaurants in general',
  'travel.car_rental': 'other travel is travel in general',
  'travel.cruise': 'other travel is travel in general',
  'gas.superstore': 'gas is bought at gas stations',
  'gas.grocery_store': 'gas is bought at gas stations',
}

// A gap is fine when the rule needs something a household isn't assumed to
// do (a store, a membership, Apple Pay) or pays only on parts listed above.
function unexpected(g: LineGap): boolean {
  if (g.miss === 'unexplained') return true
  if (!SHAPE_MISSES.has(g.miss) && !COVERAGE_MISSES.has(g.miss)) return false
  const own = g.kinds.filter((k) => family(k) === family(g.lineCategory))
  return own.length === 0 || !own.every((k) => k in UNREACHED)
}

describe('the typical month reaches the rules for its kinds of spending', () => {
  test('every bonus rule for a kind of spending in the month is reached, or is out of it for a listed reason', () => {
    const gaps = lineGaps(catalog, typicalSpendLines(catalog), year)
    expect(gaps.filter(unexpected)).toEqual([])
  })

  test('a typical line at the parent of the categories a card pays on fails the guard', () => {
    const travel = resolveSpendLines(catalog, [
      { merchant: null, category: 'travel', monthly: 150 },
    ])
    const reserve = catalog.cards.filter(
      (c) => c.id === 'chase-sapphire-reserve',
    )
    const gaps = lineGaps(catalog, travel, year, reserve).filter(unexpected)
    expect(gaps.map((g) => [g.variant, g.miss])).toContainEqual([
      'flights-hotels-direct',
      'sub-category',
    ])
  })

  test('streaming spent as a category, not at a service on every list, fails the guard', () => {
    const streaming = resolveSpendLines(catalog, [
      { merchant: null, category: 'streaming', monthly: 40 },
    ])
    const preferred = catalog.cards.filter(
      (c) => c.id === 'amex-blue-cash-preferred',
    )
    const gaps = lineGaps(catalog, streaming, year, preferred).filter(
      unexpected,
    )
    expect(gaps.map((g) => [g.variant, g.miss])).toContainEqual([
      'us-streaming',
      'store-list',
    ])
  })

  test('Amazon spending is online, so online-retail rates reach it', () => {
    const [amazon] = typicalSpendLines(catalog).filter(
      (l) => l.label === 'Amazon',
    )
    expect(amazon?.merchant.channel).toBe('online')
    const everyday = alone('amex-blue-cash-everyday', amazon ? [amazon] : [])
    expect(everyday.lines[0]?.returnPct).toBe(3)
  })

  test('a row for online shopping is online too, and a store with stores of its own is not', () => {
    const [online, costco] = resolveSpendLines(catalog, [
      spendLineFor(catalog, 'Online shopping', 100),
      spendLineFor(catalog, 'Costco', 100),
    ])
    expect(online?.merchant.category).toBe('online_retail')
    expect(online?.merchant.channel).toBe('online')
    expect(costco?.merchant.channel).toBe('in_store')
  })
})
