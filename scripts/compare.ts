// Card-vs-card pages for earnrate.dev: which pairs get one, and each page's
// facts, all from the card data and the engine.
import { EPSILON } from '../src/engine/compare.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  idealHolding,
  matchesFilters,
  type CardFilters,
  type Exploration,
  type ExploreEntry,
  type ExploreQuery,
} from '../src/engine/explore.ts'
import { inEffect } from '../src/engine/periods.ts'
import { TRANSFER_VALUES } from '../src/engine/fee-worth.ts'
import {
  simulateSingles,
  typicalSpendLines,
  type Simulation,
} from '../src/engine/simulate.ts'
import { categoryPhrase, categoryReadsOn } from '../src/engine/text.ts'
import { cardValuation, type Valuation } from '../src/engine/valuation.ts'
import { findMerchant } from '../src/merchants/resolve.ts'
import type { Card } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { RETIRED_COMPARISONS } from './compare-retired.ts'

// Comparisons people search for that the sibling rule below doesn't make:
// cards from different issuers that people weigh against each other, and
// every comparison that had search visits before (Search Console, Nov 1–12
// 2026). Either order; a pair whose card is closed or gone is skipped.
export const MATCHUPS: [string, string][] = [
  ['capital-one-venture-x', 'chase-sapphire-reserve'],
  ['amex-platinum', 'chase-sapphire-reserve'],
  ['amex-gold', 'chase-sapphire-preferred'],
  ['capital-one-venture', 'chase-sapphire-preferred'],
  ['amex-platinum', 'capital-one-venture-x'],
  ['citi-double-cash', 'wells-fargo-active-cash'],
  ['chase-freedom-unlimited', 'citi-double-cash'],
  ['amex-blue-cash-preferred', 'capital-one-savor'],
  ['chase-freedom-flex', 'discover-it-cash-back'],
  ['bank-of-america-customized-cash-rewards', 'citi-custom-cash'],
  ['amex-gold', 'capital-one-savor'],
  ['chase-sapphire-preferred', 'citi-strata-premier'],
  ['capital-one-venture-x', 'citi-strata-elite'],
  ['amex-business-gold', 'chase-ink-business-preferred'],
  ['apple-card', 'citi-double-cash'],
  ['citi-double-cash', 'robinhood-gold-card'],
  ['capital-one-savor', 'wells-fargo-autograph'],
  // Searched for.
  ['bank-of-america-customized-cash-rewards', 'chase-prime-visa'],
  ['bank-of-america-customized-cash-rewards', 'sams-club-mastercard'],
  ['bank-of-america-customized-cash-rewards', 'capital-one-savor'],
  ['amex-blue-cash-everyday', 'bank-of-america-customized-cash-rewards'],
  ['capital-one-savor', 'usbank-cash-plus'],
  ['amex-business-gold', 'amex-business-platinum'],
  ['navy-federal-cash-rewards', 'navy-federal-cash-rewards-plus'],
  ['capital-one-quicksilver', 'capital-one-savor'],
  ['chase-freedom-flex', 'chase-freedom-unlimited'],
  ['chase-ink-business-cash', 'chase-ink-business-unlimited'],
  [
    'bank-of-america-customized-cash-rewards',
    'bank-of-america-unlimited-cash-rewards',
  ],
  ['chase-freedom-flex', 'chase-freedom-rise'],
  ['citi-aadvantage-mileup', 'citi-aadvantage-platinum-select'],
]

export type ComparePair = {
  slug: string // "<a>-vs-<b>", ids in alphabetical order
  a: string
  b: string
  siblings: boolean // one issuer's two cards that earn the same rewards
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

// A comparison names its two cards, so one that needs a membership is
// compared like any other.
const named = (r: Exploration) => [...r.ranked, ...r.membersOnly]

const fee = (c: Card) => c.annual_fee ?? 0

// A card named for a partner rather than its issuer ("PayPal Cashback
// Mastercard", from Synchrony). Two of one issuer's partner cards whose
// names start differently are for different partners, not siblings.
function differentPartners(catalog: Catalog, x: Card, y: Card): boolean {
  const issuer = catalog.issuers.find((i) => i.id === x.issuer)
  const words = [issuer?.name ?? x.issuer, ...(issuer?.search ?? [])].map((w) =>
    w.toLowerCase(),
  )
  const namesIssuer = (c: Card) =>
    words.some((w) => c.name.toLowerCase().includes(w))
  const first = (c: Card) => c.name.split(' ')[0]?.toLowerCase()
  return !namesIssuer(x) && !namesIssuer(y) && first(x) !== first(y)
}

// The card from the same issuer, earning the same rewards, whose annual fee
// is closest; a tie goes to the pricier card, then the first id.
function sibling(catalog: Catalog, card: Card, open: Card[]): Card | undefined {
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
    )
    .filter((o) => !differentPartners(catalog, card, o))[0]
}

// Each card with its closest sibling, and the matchups above. Cards closed
// to applicants and store cards aren't compared.
export function comparePairs(catalog: Catalog): ComparePair[] {
  const open = catalog.cards
    .filter(comparable)
    .sort((x, y) => x.id.localeCompare(y.id))
  const pairs = new Map<string, ComparePair>()
  const add = (a: Card, b: Card): ComparePair => {
    const [x, y] = a.id < b.id ? [a, b] : [b, a]
    const slug = compareSlug(x.id, y.id)
    const pair = pairs.get(slug) ?? { slug, a: x.id, b: y.id, siblings: false }
    pairs.set(slug, pair)
    return pair
  }
  for (const card of open) {
    const other = sibling(catalog, card, open)
    if (other) add(card, other).siblings = true
  }
  for (const [x, y] of MATCHUPS) {
    const a = open.find((c) => c.id === x)
    const b = open.find((c) => c.id === y)
    if (a && b && a.business === b.business) add(a, b)
  }
  return [...pairs.values()].sort((x, y) => x.slug.localeCompare(y.slug))
}

// `_redirects` lines: either order of a pair's cards reaches its page, and a
// comparison no longer built goes to its first card's page that still
// exists (or the list of comparisons).
export function comparisonRedirects(
  catalog: Catalog,
  pairs: ComparePair[],
): string[] {
  const built = new Set(pairs.map((p) => p.slug))
  const ids = new Set(catalog.cards.map((c) => c.id))
  const retired = RETIRED_COMPARISONS.filter((s) => !built.has(s)).flatMap(
    (slug) => {
      const [a = '', b = ''] = slug.split('-vs-')
      const to = ids.has(a)
        ? `/cards/${a}`
        : ids.has(b)
          ? `/cards/${b}`
          : '/compare/'
      return [`/compare/${slug} ${to}`, `/compare/${b}-vs-${a} ${to}`]
    },
  )
  return [
    ...pairs.map((p) => `/compare/${p.b}-vs-${p.a} /compare/${p.slug}`),
    ...retired,
  ]
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
  const typicalYears = (valuations: Record<string, number>) => {
    const found = new Map<string, Simulation>()
    for (const business of [false, true]) {
      const options = {
        filters: filtersFor(business),
        memberships: [],
        valuations,
        start: today,
      }
      const cards = catalog.cards.filter((c) =>
        matchesFilters(c, options.filters),
      )
      for (const s of simulateSingles(catalog, cards, lines, options)) {
        const id = s.cards[0]?.cardId
        if (id) found.set(id, s)
      }
    }
    return found
  }
  const singles = typicalYears({})
  const spend = lines.reduce((sum, l) => sum + l.monthly * 12, 0)
  const transferred = typicalYears(TRANSFER_VALUES)

  const cell = (r: Exploration, id: string): CompareCell => ({
    entry: named(r).find((e) => e.cardId === id) ?? null,
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
