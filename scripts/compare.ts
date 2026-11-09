// Card-vs-card pages for earnrate.dev: which pairs get one, and each page's
// facts, all from the card data and the engine.
import { EPSILON } from '../src/engine/compare.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  idealHolding,
  type CardFilters,
  type Exploration,
  type ExploreEntry,
  type ExploreQuery,
} from '../src/engine/explore.ts'
import { inEffect } from '../src/engine/periods.ts'
import { TRANSFER_VALUES } from '../src/engine/fee-worth.ts'
import {
  simulateCatalog,
  typicalSpendLines,
  type Simulation,
} from '../src/engine/simulate.ts'
import { categoryPhrase, categoryReadsOn } from '../src/engine/text.ts'
import { cardValuation, type Valuation } from '../src/engine/valuation.ts'
import { findMerchant } from '../src/merchants/resolve.ts'
import type { Card, Rule } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'

// The everyday categories the pair rule compares. Travel counts a bonus on
// travel in general, flights or hotels.
const PAIR_CATEGORIES: { label: string; categories: string[] }[] = [
  { label: 'groceries', categories: ['grocery.supermarket'] },
  { label: 'dining', categories: ['dining'] },
  { label: 'gas', categories: ['gas'] },
  {
    label: 'travel',
    categories: ['travel', 'travel.flights', 'travel.hotels'],
  },
]

export type ComparePair = {
  slug: string // "<a>-vs-<b>", ids in alphabetical order
  a: string
  b: string
  rivals: string[] // the everyday categories both earn a bonus in
  siblings: boolean
}

export const compareSlug = (x: string, y: string) =>
  x < y ? `${x}-vs-${y}` : `${y}-vs-${x}`

export const comparable = (card: Card) =>
  card.only_at === undefined && card.applications_closed === undefined

const filtersFor = (business: boolean): CardFilters => ({
  ...ALL_PERSONAL_CARDS,
  business,
})

const query = (
  today: string,
  q: { merchant?: string; category?: string },
): ExploreQuery => ({
  merchant: q.merchant ?? null,
  category: q.category ?? null,
  amount: null,
  channel: null,
  date: today,
})

function namedCap(card: Card, rule: Rule) {
  return typeof rule.cap === 'string'
    ? card.caps.find((c) => c.id === rule.cap)
    : undefined
}

// A rule that holds every quarter for everyone with the card: not rotating,
// not dated, not tied to a membership and confirmed against the terms.
const lasting = (card: Card, rule: Rule) =>
  rule.valid_from === undefined &&
  rule.valid_to === undefined &&
  rule.unverified === undefined &&
  rule.requires?.membership === undefined &&
  namedCap(card, rule)?.rotating !== true

// Each card's lasting bonuses among PAIR_CATEGORIES, by label.
export function lastingBonuses(
  catalog: Catalog,
  today: string,
): Map<string, Set<string>> {
  const steady: Catalog = {
    ...catalog,
    cards: catalog.cards.map((c) => ({
      ...c,
      rules: c.rules.filter((r) => lasting(c, r)),
    })),
  }
  const found = new Map<string, Set<string>>()
  for (const business of [false, true])
    for (const group of PAIR_CATEGORIES)
      for (const category of group.categories) {
        const r = exploreCards(steady, query(today, { category }), {
          filters: filtersFor(business),
          memberships: [],
          valuations: {},
        })
        for (const e of r.ranked) {
          const card = steady.cards.find((c) => c.id === e.cardId)
          if (!card) continue
          if (e.effectiveReturnPct <= card.base_rate * e.centsPerUnit + EPSILON)
            continue
          const set = found.get(e.cardId) ?? new Set<string>()
          set.add(group.label)
          found.set(e.cardId, set)
        }
      }
  return found
}

const FEE_GAP = 250
const fee = (c: Card) => c.annual_fee ?? 0
const isCash = (c: Card) => c.currency === 'cash'

// The card from the same issuer, earning the same rewards, whose annual fee
// is closest; a tie goes to the pricier card, then the first id.
function sibling(card: Card, open: Card[]): Card | undefined {
  return open
    .filter(
      (o) =>
        o.id !== card.id &&
        o.issuer === card.issuer &&
        o.business === card.business &&
        o.currency === card.currency,
    )
    .sort(
      (x, y) =>
        Math.abs(fee(x) - fee(card)) - Math.abs(fee(y) - fee(card)) ||
        fee(y) - fee(x) ||
        x.id.localeCompare(y.id),
    )[0]
}

export function comparePairs(catalog: Catalog, today: string): ComparePair[] {
  const open = catalog.cards
    .filter(comparable)
    .sort((x, y) => x.id.localeCompare(y.id))
  const bonuses = lastingBonuses(catalog, today)
  const pairs = new Map<string, ComparePair>()
  const add = (a: Card, b: Card): ComparePair => {
    const [x, y] = a.id < b.id ? [a, b] : [b, a]
    const slug = compareSlug(x.id, y.id)
    const pair = pairs.get(slug) ?? {
      slug,
      a: x.id,
      b: y.id,
      rivals: [],
      siblings: false,
    }
    pairs.set(slug, pair)
    return pair
  }
  open.forEach((a, i) => {
    for (const b of open.slice(i + 1)) {
      if (a.issuer === b.issuer || a.business !== b.business) continue
      if (isCash(a) !== isCash(b) || fee(a) > 0 !== fee(b) > 0) continue
      if (Math.abs(fee(a) - fee(b)) > FEE_GAP) continue
      const theirs = bonuses.get(b.id) ?? new Set()
      const shared = PAIR_CATEGORIES.map((g) => g.label).filter(
        (l) => bonuses.get(a.id)?.has(l) && theirs.has(l),
      )
      if (shared.length >= 2) add(a, b).rivals = shared
    }
  })
  for (const card of open) {
    const other = sibling(card, open)
    if (other) add(card, other).siblings = true
  }
  return [...pairs.values()].sort((x, y) => x.slug.localeCompare(y.slug))
}

export type CompareCell = {
  entry: ExploreEntry | null
  excluded: string | null // why the card can't be used there
}

export type CompareRow = {
  label: string // "Groceries"
  where: string // "at supermarkets", for sentences
  a: CompareCell
  b: CompareCell
  winner: 'a' | 'b' | null
  // 2 for the everyday rows every comparison has, 1 for another category,
  // 0 for a single store: what "who each card suits" leads with.
  weight: number
}

export type Comparison = {
  pair: ComparePair
  a: Card
  b: Card
  rows: CompareRow[]
  // Each card used alone for a year of typical spending, best picks made.
  typical: { a: Simulation; b: Simulation; spend: number }
  // What one point is counted at, in cents.
  value: { a: Valuation; b: Valuation }
  // The typical year again with Amex and Chase points at their transfer
  // value, when either card earns them.
  transfer: { a: Simulation; b: Simulation; cents: number } | null
}

type RowQuery = {
  key: string
  label: string
  where: string
  q: { merchant?: string; category?: string }
}

const MAX_EXTRA_ROWS = 8

function fixedRows(catalog: Catalog): RowQuery[] {
  const cat = (id: string, label: string): RowQuery => ({
    key: `c:${id}`,
    label,
    where: `${categoryReadsOn(catalog, id) ? 'on' : 'at'} ${categoryPhrase(catalog, id)}`,
    q: { category: id },
  })
  const store = (id: string): RowQuery | null => {
    const m = findMerchant(catalog, id)
    return m
      ? {
          key: `m:${id}`,
          label: m.name,
          where: `at ${m.name}`,
          q: { merchant: m.name },
        }
      : null
  }
  return [
    cat('grocery.supermarket', 'Groceries'),
    cat('dining', 'Dining'),
    cat('gas', 'Gas'),
    cat('travel', 'Travel'),
    store('amazon'),
    store('costco'),
  ].filter((r): r is RowQuery => r !== null)
}

// Rows for other categories, then stores (one per rule), where either card
// earns more than its base rate today, highest rate first.
function bonusRows(
  catalog: Catalog,
  cards: Card[],
  today: string,
  taken: Set<string>,
): RowQuery[] {
  const found = new Map<string, { row: RowQuery; rate: number }>()
  for (const card of cards)
    for (const rule of card.rules) {
      if (rule.rate <= card.base_rate || !inEffect(rule, today)) continue
      const rows: RowQuery[] = []
      for (const id of rule.match.categories ?? []) {
        const name = catalog.categories.find((c) => c.id === id)?.name
        if (name)
          rows.push({
            key: `c:${id}`,
            label: name,
            where: `${categoryReadsOn(catalog, id) ? 'on' : 'at'} ${categoryPhrase(catalog, id)}`,
            q: { category: id },
          })
      }
      const first = (
        rule.match.categories?.length ? [] : (rule.match.merchants ?? [])
      )
        .map((id) => findMerchant(catalog, id))
        .find((m) => m !== undefined && m.kind !== 'booking')
      if (first)
        rows.push({
          key: `m:${first.id}`,
          label: first.name,
          where: `at ${first.name}`,
          q: { merchant: first.name },
        })
      for (const row of rows) {
        if (taken.has(row.key)) continue
        const seen = found.get(row.key)
        if (!seen || seen.rate < rule.rate)
          found.set(row.key, { row, rate: rule.rate })
      }
    }
  return [...found.values()]
    .sort(
      (x, y) =>
        Number(x.row.key.startsWith('m:')) -
          Number(y.row.key.startsWith('m:')) ||
        y.rate - x.rate ||
        x.row.label.localeCompare(y.row.label),
    )
    .slice(0, MAX_EXTRA_ROWS)
    .map((f) => f.row)
}

// Explorations are shared across pages: the same rows recur on most of them.
export function comparer(catalog: Catalog, today: string) {
  const explored = new Map<string, Exploration>()
  const explore = (row: RowQuery, business: boolean) => {
    const key = `${business ? 'b' : 'p'}|${row.key}`
    let r = explored.get(key)
    if (!r) {
      r = exploreCards(catalog, query(today, row.q), {
        filters: filtersFor(business),
        memberships: [],
        valuations: {},
      })
      explored.set(key, r)
    }
    return r
  }
  const lines = typicalSpendLines(catalog)
  const singles = new Map<string, Simulation>()
  for (const business of [false, true])
    for (const s of simulateCatalog(catalog, lines, {
      filters: filtersFor(business),
      memberships: [],
      valuations: {},
      start: today,
    }).singles) {
      const id = s.cards[0]?.cardId
      if (id) singles.set(id, s)
    }
  const spend = lines.reduce((sum, l) => sum + l.monthly * 12, 0)
  const transferred = new Map<string, Simulation>()
  for (const business of [false, true])
    for (const s of simulateCatalog(catalog, lines, {
      filters: filtersFor(business),
      memberships: [],
      valuations: TRANSFER_VALUES,
      start: today,
    }).singles) {
      const id = s.cards[0]?.cardId
      if (id) transferred.set(id, s)
    }

  const cell = (r: Exploration, id: string): CompareCell => ({
    entry: r.ranked.find((e) => e.cardId === id) ?? null,
    excluded: r.excluded.find((e) => e.cardId === id)?.reason ?? null,
  })

  return function compare(pair: ComparePair): Comparison {
    const a = catalog.cards.find((c) => c.id === pair.a)
    const b = catalog.cards.find((c) => c.id === pair.b)
    if (!a || !b) throw new Error(`compare: unknown card in ${pair.slug}`)
    const fixed = fixedRows(catalog)
    const other: RowQuery = {
      key: 'c:other',
      label: 'Everything else',
      where: 'on everything else',
      q: { category: 'other' },
    }
    const taken = new Set([...fixed, other].map((r) => r.key))
    const queries = [
      ...fixed,
      ...bonusRows(catalog, [a, b], today, taken),
      other,
    ]
    const rows = queries.map((row): CompareRow => {
      const r = explore(row, a.business)
      const ca = cell(r, a.id)
      const cb = cell(r, b.id)
      const ra = ca.entry?.effectiveReturnPct ?? -1
      const rb = cb.entry?.effectiveReturnPct ?? -1
      return {
        label: row.label,
        where: row.where,
        a: ca,
        b: cb,
        winner: ra > rb + EPSILON ? 'a' : rb > ra + EPSILON ? 'b' : null,
        weight: fixed.includes(row) ? 2 : row.key.startsWith('c:') ? 1 : 0,
      }
    })
    const sa = singles.get(a.id)
    const sb = singles.get(b.id)
    if (!sa || !sb) throw new Error(`compare: no typical year for ${pair.slug}`)
    const worth = (card: Card) =>
      cardValuation(
        catalog,
        { valuations: {}, memberships: [], cards: [idealHolding(card, today)] },
        card,
      )
    const ta = transferred.get(a.id)
    const tb = transferred.get(b.id)
    const cents = TRANSFER_VALUES[a.currency] ?? TRANSFER_VALUES[b.currency]
    return {
      pair,
      a,
      b,
      rows,
      typical: { a: sa, b: sb, spend },
      value: { a: worth(a), b: worth(b) },
      transfer:
        cents !== undefined && ta && tb ? { a: ta, b: tb, cents } : null,
    }
  }
}
