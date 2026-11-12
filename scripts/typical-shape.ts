// Whether each line of the typical month can reach the card rules meant for
// that kind of spending, and why not when it can't. Used by
// scripts/typical-audit.ts and the guard in tests/typical-shape.test.ts.
import {
  categoryMatches,
  evaluateCard,
  purchaseContext,
  usableAt,
} from '../src/engine/evaluate.ts'
import { idealHolding, type Picks } from '../src/engine/explore.ts'
import { inEffect } from '../src/engine/periods.ts'
import type { ResolvedLine } from '../src/engine/simulate.ts'
import { findMerchant, merchantFamily } from '../src/merchants/resolve.ts'
import type { Card, Choice, Rule } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'

export type Miss =
  // Shape: the line's kind of spending is the rule's, but the line can't reach it.
  | 'sub-category' // the rule pays on a part of the line's category
  | 'channel' // the rule needs online or in-store, and the line says neither
  | 'store-list' // an issuer's list of stores standing for the line's kind, none of them the line's
  // Coverage: the month has no spending of that kind.
  | 'sibling' // another part of the same kind (online grocery beside supermarkets)
  | 'other-kind'
  // By design: the rule needs something a typical household isn't assumed to do.
  | 'merchant' // named stores, brands or a card's travel site
  | 'mcc'
  | 'membership'
  | 'payment' // Apple Pay, PayPal checkout
  | 'amount' // a minimum purchase
  | 'abroad' // only on purchases outside the U.S.
  | 'dates' // not in effect in the year simulated (rotating quarters, ended offers)
  | 'excluded' // the rule names this kind of spending as not earning
  | 'store-card'
  | 'unexplained' // none of the above: the audit's checks disagree with the engine

export const SHAPE_MISSES: ReadonlySet<Miss> = new Set([
  'sub-category',
  'channel',
  'store-list',
])

// Streaming bonuses are lists of 18 to 33 services; a brand's own stores
// (Delta, Hilton) are a handful of ids.
export const ISSUER_LIST = 10
export const COVERAGE_MISSES: ReadonlySet<Miss> = new Set([
  'sibling',
  'other-kind',
])

export const family = (category: string) => category.split('.')[0] ?? category

const under = (parent: string, id: string) => id.startsWith(`${parent}.`)

// A rule as one way of earning it: a rule on a card choice is one variant
// per option, picked; any other rule is itself.
export type Variant = {
  card: Card
  rule: Rule
  id: string // "rule" or "rule[option]"
  option: string | null
  picks: Picks
  kinds: string[] // the category ids it's written for, or ['any']
}

type Option = Choice['options'][string]

const merchantCategories = (catalog: Catalog, ids: string[]) =>
  ids.flatMap((m) => findMerchant(catalog, m)?.category ?? [])

// Kinds in a match combine with AND, so a rule's categories narrow the rest.
function kindsOf(
  catalog: Catalog,
  rule: Rule,
  option: Option | null,
): string[] {
  if (rule.match.any) return ['any']
  const own = rule.match.categories ?? []
  if (own.length > 0 && option?.categories.length)
    return option.categories.filter((c) =>
      own.some((r) => categoryMatches(r, c) || categoryMatches(c, r)),
    )
  if (own.length > 0) return own
  const kinds = new Set<string>()
  if (option) {
    for (const c of option.categories) kinds.add(c)
    for (const c of merchantCategories(catalog, option.merchants)) kinds.add(c)
    if (option.online) kinds.add('online_retail')
  }
  for (const c of merchantCategories(catalog, rule.match.merchants ?? []))
    kinds.add(c)
  for (const mcc of rule.match.mccs ?? [])
    for (const c of catalog.categories)
      if (c.mccs.includes(mcc)) kinds.add(c.id)
  return [...kinds]
}

export function variants(catalog: Catalog, card: Card): Variant[] {
  return card.rules.flatMap((rule): Variant[] => {
    const choice = card.choices.find((c) => c.id === rule.match.choice)
    if (!choice)
      return [
        {
          card,
          rule,
          id: rule.id,
          option: null,
          picks: {},
          kinds: kindsOf(catalog, rule, null),
        },
      ]
    // A rule with categories of its own pays only on options among them.
    const within = (option: Option) =>
      !rule.match.categories?.length ||
      option.categories.some((c) =>
        rule.match.categories?.some(
          (r) => categoryMatches(r, c) || categoryMatches(c, r),
        ),
      )
    return Object.entries(choice.options)
      .filter(([, option]) => within(option))
      .map(([id, option]) => ({
        card,
        rule,
        id: `${rule.id}[${id}]`,
        option: id,
        picks: { [choice.id]: [id] },
        kinds: kindsOf(catalog, rule, option),
      }))
  })
}

// Whether a variant is plainly written for the kind of spending a line is.
// "Everything else" is the kind only of rules on every purchase.
export function meantFor(v: Variant, line: ResolvedLine): boolean {
  const category = line.merchant.category
  if (v.kinds.includes('any')) return category === 'other'
  return v.kinds.some((k) => family(k) === family(category))
}

function categoryMiss(rule: string[], line: string): Miss | null {
  if (rule.some((c) => categoryMatches(c, line))) return null
  if (rule.some((c) => under(line, c))) return 'sub-category'
  if (rule.some((c) => family(c) === family(line))) return 'sibling'
  return 'other-kind'
}

// Why the variant doesn't apply to the line on `date`, or null when it
// does. Every activation is assumed done, as the simulation does.
export function whyNot(
  catalog: Catalog,
  v: Variant,
  line: ResolvedLine,
  date: string,
  memberships: string[] = [],
): Miss | null {
  const { card, rule } = v
  const merchant = line.merchant
  if (!usableAt(card, merchant)) return 'store-card'
  const holding = idealHolding(card, date, v.picks)
  const ctx = purchaseContext(
    catalog,
    { valuations: {}, memberships, cards: [holding] },
    merchant,
    merchant.category,
    { amount: null, date, country: 'US' },
  )
  const ids = merchantFamily(catalog, merchant.merchantId)
  const { match, exclude } = rule
  const option =
    v.option === null
      ? null
      : (card.choices.find((c) => c.id === match.choice)?.options[v.option] ??
        null)

  if (match.categories?.length) {
    const miss = categoryMiss(match.categories, merchant.category)
    if (miss) return miss
  }
  if (match.merchants?.length && !match.merchants.some((m) => ids.includes(m)))
    return match.merchants.length >= ISSUER_LIST ? 'store-list' : 'merchant'
  if (match.mccs?.length && !(ctx.mcc !== null && match.mccs.includes(ctx.mcc)))
    return 'mcc'
  if (option) {
    const covered =
      option.categories.some((c) => categoryMatches(c, merchant.category)) ||
      option.merchants.some((m) => ids.includes(m)) ||
      (option.online !== null &&
        ctx.channel === 'online' &&
        !option.online.exclude.some((c) =>
          categoryMatches(c, merchant.category),
        ))
    if (!covered) {
      if (option.online !== null) {
        const excluded = option.online.exclude.some((c) =>
          categoryMatches(c, merchant.category),
        )
        return excluded ? 'excluded' : 'channel'
      }
      if (option.categories.length > 0)
        return categoryMiss(option.categories, merchant.category)
      return option.merchants.length >= ISSUER_LIST ? 'store-list' : 'merchant'
    }
  }
  if (exclude?.categories?.some((c) => categoryMatches(c, merchant.category)))
    return 'excluded'
  if (exclude?.merchants?.some((m) => ids.includes(m))) return 'excluded'
  if (exclude?.mccs && ctx.mcc !== null && exclude.mccs.includes(ctx.mcc))
    return 'excluded'
  if (rule.geography === 'foreign_only') return 'abroad'
  if (rule.requires?.payment !== undefined) return 'payment'
  if (rule.channel !== 'any' && rule.channel !== ctx.channel) return 'channel'
  if (!inEffect(rule, date)) return 'dates'
  if (rule.min_amount !== undefined) return 'amount'
  if (
    rule.requires?.membership !== undefined &&
    !ctx.memberships.has(rule.requires.membership)
  )
    return 'membership'

  // The engine has the last word: the rule alone on a card that earns
  // nothing else applies or it doesn't.
  const alone: Card = {
    ...card,
    base_rate: 0,
    rules: [{ ...rule, rate: Math.max(rule.rate, 1e-6) }],
    intro_rates: [],
  }
  const held = idealHolding(alone, date, v.picks)
  return evaluateCard(alone, held, ctx).best.rule?.id === rule.id
    ? null
    : 'unexplained'
}

// Over the months of the year: null when the variant applies in any of
// them. One that never applies only for its dates says 'dates'.
export function whyNotThisYear(
  catalog: Catalog,
  v: Variant,
  line: ResolvedLine,
  dates: string[],
  memberships: string[] = [],
): Miss | null {
  let first: Miss | null = null
  for (const date of dates) {
    const miss = whyNot(catalog, v, line, date, memberships)
    if (miss === null) return null
    if (first === null || first === 'dates') first = miss
  }
  return first
}

export const membershipsFor = (card: Card) =>
  card.requires_membership ? [card.requires_membership] : []

export type LineGap = {
  line: string
  lineCategory: string
  cardId: string
  variant: string
  rate: number
  kinds: string[]
  miss: Miss
}

// Each card's bonus variants that no line of the month reaches all year,
// against every line they're meant for, with why. A card that needs a
// membership is taken as a member.
export function lineGaps(
  catalog: Catalog,
  lines: ResolvedLine[],
  dates: string[],
  cards: Card[] = catalog.cards,
): LineGap[] {
  const gaps: LineGap[] = []
  for (const card of cards)
    for (const v of variants(catalog, card)) {
      if (v.rule.rate <= card.base_rate) continue
      const why = (line: ResolvedLine) =>
        whyNotThisYear(catalog, v, line, dates, membershipsFor(card))
      const misses = lines.map((line) => ({ line, miss: why(line) }))
      if (misses.some((m) => m.miss === null)) continue
      for (const { line, miss } of misses) {
        if (miss === null || !meantFor(v, line)) continue
        gaps.push({
          line: line.label,
          lineCategory: line.merchant.category,
          cardId: card.id,
          variant: v.id,
          rate: v.rule.rate,
          kinds: v.kinds,
          miss,
        })
      }
    }
  return gaps
}
