import type { Catalog } from '../data/load.ts'
import { resolveMerchant } from '../merchants/resolve.ts'
import type { Card } from '../schema/card.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { evaluateCard, purchaseContext } from './evaluate.ts'
import { periodKey, type Period } from './periods.ts'
import {
  categoryPhrase,
  currencyLabel,
  dollars,
  earnText,
  num,
  recommend,
} from './recommend.ts'
import { rotationGap } from './rotation.ts'
import { membershipsUsed } from './setup.ts'
import type {
  Channel,
  ExcludedCard,
  MerchantResolution,
  Purchase,
  RankedCard,
} from './types.ts'
import { cardValuation } from './valuation.ts'

const EPSILON = 1e-9

export type CardFilters = {
  kind: 'any' | 'cash' | 'points'
  business: boolean // business cards instead of personal ones
  noAnnualFee: boolean
  issuer: string | null
  includeClosed: boolean // cards the issuer no longer takes applications for
}

export const ALL_PERSONAL_CARDS: CardFilters = {
  kind: 'any',
  business: false,
  noAnnualFee: false,
  issuer: null,
  includeClosed: false,
}

export function matchesFilters(card: Card, filters: CardFilters): boolean {
  if (card.business !== filters.business) return false
  if (!filters.includeClosed && card.applications_closed !== undefined)
    return false
  if (filters.noAnnualFee && card.annual_fee !== 0) return false
  if (filters.issuer !== null && card.issuer !== filters.issuer) return false
  const isCash = card.currency === 'cash'
  if (filters.kind === 'cash' && !isCash) return false
  if (filters.kind === 'points' && isCash) return false
  return true
}

export type Picks = Record<string, string[]> // choice id → option ids

// The period a card's picks are keyed by in a wallet.
export function choicePeriod(card: Card): Period {
  for (const c of card.choices)
    if (c.period !== 'until_changed') return c.period
  return 'quarter'
}

// A card as its holder would set it up for the best result: the given picks,
// every activation done, and no cap used yet. The anniversary is `date`, so a
// cardmember-year cap starts fresh.
export function idealHolding(
  card: Card,
  date: string,
  picks: Picks = {},
): WalletCard {
  const period = choicePeriod(card)
  return {
    id: card.id,
    anniversary: date.slice(5),
    cap_usage: {},
    activated: card.rules
      .filter((r) => r.requires?.activation === true)
      .map((r) => r.id),
    ...(Object.keys(picks).length > 0
      ? { chosen: { period: periodKey(period, date, null) ?? '', picks } }
      : {}),
  }
}

export type ExploreEntry = RankedCard & {
  issuer: string
  network: Card['network']
  annualFee: number | null
  firstYearFee: number | null
  picks: Picks
  conditions: string[] // what earning this rate takes: a pick, activation, a cap
  evidence: { quote: string; url: string } | null
  // Higher returns with a membership this card's rules ask for, best first.
  withMembership: { membership: string; effectiveReturnPct: number }[]
}

export type Exploration = {
  merchant: MerchantResolution
  ranked: ExploreEntry[]
  excluded: ExcludedCard[]
  assumptions: string[]
  warnings: string[]
}

export type ExploreQuery = {
  merchant: string | null
  category: string | null // used when merchant is null
  amount: number | null
  channel: Channel | null
  date: string
}

export type ExploreOptions = {
  filters: CardFilters
  memberships: string[] // the ones the person has; none assumed otherwise
  valuations: Wallet['valuations']
}

const PICK_PERIODS: Record<Card['choices'][number]['period'], string> = {
  month: 'set each month',
  quarter: 'picked each quarter',
  calendar_year: 'picked each year',
  until_changed: 'until you change it',
}

const CAP_PERIODS: Record<string, string> = {
  month: 'a month',
  quarter: 'a quarter',
  calendar_year: 'a calendar year',
  cardmember_year: 'a cardmember year',
}

const plainWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// A category from everyday words: an alias ("groceries") first, then the
// name, then the id, so "grocery" means supermarkets rather than the parent.
export function findCategory(catalog: Catalog, text: string): string | null {
  const wanted = plainWords(text)
  if (wanted === '') return null
  const by = (key: (c: Catalog['categories'][number]) => string[]) =>
    catalog.categories.find((c) => key(c).map(plainWords).includes(wanted))?.id
  return (
    by((c) => c.aliases) ?? by((c) => [c.name]) ?? by((c) => [c.id]) ?? null
  )
}

export function categoryResolution(
  catalog: Catalog,
  category: string,
  channel: Channel | null,
): MerchantResolution {
  const found = catalog.categories.find((c) => c.id === category)
  if (!found) throw new Error(`unknown category '${category}'`)
  return {
    input: found.name,
    merchantId: null,
    resolvedName: found.name,
    category,
    likelyMcc: null,
    accepts: null,
    ambiguity: null,
    channel,
    confidence: 'high',
    source: 'caller',
    bookedVia: [],
    inference: null,
  }
}

function walletOf(
  held: WalletCard,
  options: Pick<ExploreOptions, 'memberships' | 'valuations'>,
): Wallet {
  return {
    valuations: options.valuations,
    memberships: options.memberships,
    cards: [held],
  }
}

// One option per choice is enough to cover a single purchase, so each choice
// is tried option by option, keeping a pick only when it raises the rate.
function bestPicksForPurchase(
  catalog: Catalog,
  card: Card,
  merchant: MerchantResolution,
  purchase: Purchase,
  options: ExploreOptions,
): Picks {
  const picks: Picks = {}
  const rateWith = (p: Picks) => {
    const held = idealHolding(card, purchase.date, p)
    const ctx = purchaseContext(
      catalog,
      walletOf(held, options),
      merchant,
      merchant.category,
      purchase,
    )
    return evaluateCard(card, held, ctx).best.rate
  }
  for (const choice of card.choices) {
    let best = rateWith(picks)
    for (const option of Object.keys(choice.options)) {
      const trial = { ...picks, [choice.id]: [option] }
      const rate = rateWith(trial)
      if (rate > best + EPSILON) {
        best = rate
        picks[choice.id] = [option]
      }
    }
  }
  return picks
}

function conditionsFor(
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  wallet: Wallet,
  merchant: MerchantResolution,
  purchase: Purchase,
): string[] {
  const ctx = purchaseContext(
    catalog,
    wallet,
    merchant,
    merchant.category,
    purchase,
  )
  const { best } = evaluateCard(card, held, ctx)
  const rule = best.rule
  if (!rule) return []
  const conditions: string[] = []
  const choiceId = rule.match.choice
  const choice = card.choices.find((c) => c.id === choiceId)
  const picked =
    choiceId === undefined ? undefined : held.chosen?.picks[choiceId]
  if (choice && picked) {
    conditions.push(
      `Needs "${picked.join('", "')}" as its ${choice.id} pick (${PICK_PERIODS[choice.period]}).`,
    )
  }
  if (rule.requires?.activation === true) {
    conditions.push(`Needs activating with the issuer ("${rule.id}").`)
  }
  if (rule.requires?.membership !== undefined) {
    conditions.push(`Needs ${rule.requires.membership}.`)
  }
  const cap = best.cap?.cap
  if (cap) {
    const currency = cardValuation(catalog, wallet, card).currency
    conditions.push(
      `Up to ${dollars(cap.amount)} ${CAP_PERIODS[cap.period] ?? ''} at this rate, then ${earnText(catalog, cap.then_rate, currency)}.`,
    )
  }
  return conditions
}

function membershipUpgrades(
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  merchant: MerchantResolution,
  purchase: Purchase,
  options: ExploreOptions,
  current: number,
): ExploreEntry['withMembership'] {
  const upgrades: ExploreEntry['withMembership'] = []
  for (const membership of membershipsUsed(card)) {
    if (options.memberships.includes(membership)) continue
    const wallet = walletOf(held, {
      ...options,
      memberships: [...options.memberships, membership],
    })
    const ctx = purchaseContext(
      catalog,
      wallet,
      merchant,
      merchant.category,
      purchase,
    )
    const pct =
      evaluateCard(card, held, ctx).best.rate *
      cardValuation(catalog, wallet, card).centsPerUnit
    if (pct > current + EPSILON)
      upgrades.push({ membership, effectiveReturnPct: pct })
  }
  return upgrades.sort((a, b) => b.effectiveReturnPct - a.effectiveReturnPct)
}

function compareExplored(a: ExploreEntry, b: ExploreEntry): number {
  const byReturn = b.effectiveReturnPct - a.effectiveReturnPct
  if (Math.abs(byReturn) > EPSILON) return byReturn
  const byFee = (a.annualFee ?? Infinity) - (b.annualFee ?? Infinity)
  if (byFee !== 0) return byFee
  const byConditions = a.conditions.length - b.conditions.length
  if (byConditions !== 0) return byConditions
  return a.cardId.localeCompare(b.cardId)
}

// Ranks every card in the catalog that passes the filters for one purchase,
// each set up at its best: the pick that covers it, activated, cap unused.
export function exploreCards(
  catalog: Catalog,
  query: ExploreQuery,
  options: ExploreOptions,
): Exploration {
  const merchant =
    query.merchant !== null
      ? resolveMerchant(catalog, query.merchant, query.channel)
      : categoryResolution(catalog, query.category ?? 'other', query.channel)
  const purchase: Purchase = {
    merchant: merchant.input,
    amount: query.amount,
    channel: query.channel,
    date: query.date,
    country: 'US',
  }
  const ranked: ExploreEntry[] = []
  const excluded: ExcludedCard[] = []

  for (const card of catalog.cards) {
    if (!matchesFilters(card, options.filters)) continue
    const picks = bestPicksForPurchase(
      catalog,
      card,
      merchant,
      purchase,
      options,
    )
    const held = idealHolding(card, query.date, picks)
    const wallet = walletOf(held, options)
    const rec = recommend(catalog, wallet, purchase, merchant)
    const top = rec.ranked[0]
    if (!top) {
      excluded.push(...rec.excluded)
      continue
    }
    const gap = rotationGap(card, query.date)
    const evidenceRule = top.matchedRule ?? 'base_rate'
    const evidence = card.evidence.find((e) => e.rule === evidenceRule)
    ranked.push({
      ...top,
      warnings:
        gap === null
          ? top.warnings
          : [
              ...top.warnings,
              `Its rotating categories for ${gap} aren't in earnrate's data yet, so it's ranked without them.`,
            ],
      issuer: card.issuer,
      network: card.network,
      annualFee: card.annual_fee ?? null,
      firstYearFee: card.first_year_fee ?? null,
      picks,
      conditions: conditionsFor(
        catalog,
        card,
        held,
        wallet,
        merchant,
        purchase,
      ),
      evidence: evidence ? { quote: evidence.quote, url: evidence.url } : null,
      withMembership: membershipUpgrades(
        catalog,
        card,
        held,
        merchant,
        purchase,
        options,
        top.effectiveReturnPct,
      ),
    })
  }
  ranked.sort(compareExplored)

  return {
    merchant,
    ranked,
    excluded,
    assumptions: exploreAssumptions(catalog, merchant, ranked, options),
    warnings: exploreWarnings(catalog, merchant),
  }
}

function exploreAssumptions(
  catalog: Catalog,
  merchant: MerchantResolution,
  ranked: ExploreEntry[],
  options: ExploreOptions,
): string[] {
  const assumptions: string[] = []
  if (merchant.source === 'caller') {
    assumptions.push(
      `Ranks purchases that code as ${categoryPhrase(catalog, merchant.category)}.`,
    )
  } else if (merchant.source !== 'none') {
    const code =
      merchant.likelyMcc === null ? '' : ` (MCC ${String(merchant.likelyMcc)})`
    assumptions.push(
      `Assumes ${merchant.resolvedName} codes as ${categoryPhrase(catalog, merchant.category)}${code}.`,
    )
  }
  assumptions.push(
    'Assumes each card is set up for this purchase: the right category pick, any activation done, and none of its cap used yet. A card you hold may differ.',
  )
  assumptions.push(
    options.memberships.length === 0
      ? 'Assumes no memberships (like Amazon Prime). Rates that need one are listed separately.'
      : `Assumes these memberships: ${options.memberships.join(', ')}.`,
  )
  const values = new Map<string, number>()
  for (const e of ranked.slice(0, 10)) {
    if (e.currency !== 'cash') values.set(e.currency, e.centsPerUnit)
  }
  if (values.size > 0) {
    const list = [...values].map(
      ([id, cents]) => `${currencyLabel(catalog, id)} at ${num(cents)}¢`,
    )
    assumptions.push(`Values points at: ${list.join(', ')}.`)
  }
  return assumptions
}

function exploreWarnings(
  catalog: Catalog,
  merchant: MerchantResolution,
): string[] {
  const warnings: string[] = []
  if (merchant.source === 'none') {
    warnings.push(
      `Couldn't identify "${merchant.input}", so only base rates apply. Try a category instead.`,
    )
  }
  if (merchant.ambiguity) {
    const alternatives = merchant.ambiguity.mayCodeAs.map((c) =>
      categoryPhrase(catalog, c),
    )
    warnings.push(
      `${merchant.resolvedName} may code as ${alternatives.join(' or ')} instead: ${merchant.ambiguity.note}`,
    )
  }
  return warnings
}
