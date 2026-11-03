import { categoryResolution, resolvePlace } from '../merchants/resolve.ts'
import type { Cap, Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { evaluateCard, purchaseContext } from './evaluate.ts'
import {
  membershipName,
  membershipNeeded,
  paidMemberships,
} from './memberships.ts'
import { choicePeriod, periodKey } from './periods.ts'
import { FOREIGN_ASSUMPTION, isForeign, recommend } from './recommend.ts'
import { rotationGap } from './rotation.ts'
import { membershipsUsed } from './setup.ts'
import { optionName } from './rule-text.ts'
import {
  CAP_PERIODS,
  categoryPhrase,
  choiceName,
  codesAs,
  earnText,
  listed,
  money,
  PICK_PERIODS,
  pointValuesText,
} from './text.ts'
import type {
  Channel,
  ExcludedCard,
  MerchantResolution,
  Purchase,
  RankedCard,
} from './types.ts'
import { cardValuation } from './valuation.ts'
import { EPSILON } from './compare.ts'

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

// A card as its holder would set it up for the best result: the given picks,
// every activation done, and no cap used yet. The anniversary is `date`, so a
// cardmember-year cap starts fresh.
export function idealHolding(
  card: Card,
  date: string,
  picks: Picks = {},
): WalletCard {
  const period = choicePeriod(card) ?? 'calendar_year'
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
  requirements: Requirements
  conditions: string[] // the requirements in words
  evidence: { quote: string; url: string } | null
  // Higher returns with a membership this card's rules ask for, best first.
  withMembership: { membership: string; effectiveReturnPct: number }[]
}

// What earning the ranked rate takes.
export type Requirements = {
  pick: {
    choice: string
    options: string[]
    period: Card['choices'][number]['period']
  } | null
  activation: string | null // the rule id to activate
  membership: string | null
  cap: {
    amount: number
    period: Cap['period']
    thenRate: number
    currency: string
  } | null
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
  country?: string // where the purchase is made; default US
}

export type ExploreOptions = {
  filters: CardFilters
  memberships: string[] // the ones the person has; none assumed otherwise
  valuations: Wallet['valuations']
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

function requirementsFor(
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  wallet: Wallet,
  merchant: MerchantResolution,
  purchase: Purchase,
): Requirements {
  const ctx = purchaseContext(
    catalog,
    wallet,
    merchant,
    merchant.category,
    purchase,
  )
  const { best } = evaluateCard(card, held, ctx)
  const rule = best.rule
  const none = { pick: null, activation: null, membership: null, cap: null }
  if (!rule) return none
  const choiceId = rule.match.choice
  const choice = card.choices.find((c) => c.id === choiceId)
  const picked =
    choiceId === undefined ? undefined : held.chosen?.picks[choiceId]
  const cap = best.cap?.cap
  return {
    pick:
      choice && picked
        ? { choice: choice.id, options: picked, period: choice.period }
        : null,
    activation: rule.requires?.activation === true ? rule.id : null,
    membership: rule.requires?.membership ?? null,
    cap: cap
      ? {
          amount: cap.amount,
          period: cap.period,
          thenRate: best.afterCap ?? cap.then_rate,
          currency: cardValuation(catalog, wallet, card).currency,
        }
      : null,
  }
}

function conditionsText(
  catalog: Catalog,
  card: Card,
  r: Requirements,
): string[] {
  const conditions: string[] = []
  if (r.pick) {
    conditions.push(
      `Needs ${r.pick.options.map((o) => optionName(catalog, card, r.pick?.choice ?? '', o)).join(' or ')} as its ${choiceName(r.pick.choice)} pick (${r.pick.period === 'until_changed' ? '' : 'picked '}${PICK_PERIODS[r.pick.period]}).`,
    )
  }
  if (r.activation !== null)
    conditions.push('Needs its bonus activated with the issuer (free).')
  if (r.membership !== null)
    conditions.push(`With your ${membershipName(catalog, r.membership)}.`)
  if (r.cap) {
    conditions.push(
      `Up to ${money(r.cap.amount)} ${CAP_PERIODS[r.cap.period]} at this rate, then ${earnText(catalog, r.cap.thenRate, r.cap.currency)}.`,
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
    const fee = isForeign(purchase) ? (card.foreign_transaction_fee ?? 0) : 0
    const pct =
      evaluateCard(card, held, ctx).best.rate *
        cardValuation(catalog, wallet, card).centsPerUnit -
      fee
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
  resolved?: MerchantResolution,
): Exploration {
  const merchant =
    resolved ??
    (query.merchant !== null
      ? resolvePlace(catalog, query.merchant, query.channel)
      : categoryResolution(catalog, query.category ?? 'other', query.channel))
  const purchase: Purchase = {
    merchant: merchant.input,
    amount: query.amount,
    channel: query.channel,
    date: query.date,
    country: query.country ?? 'US',
  }
  const ranked: ExploreEntry[] = []
  const excluded: ExcludedCard[] = []
  // A Costco purchase means a Costco member: no membership to point out.
  const paid = paidMemberships(catalog, {
    memberships: options.memberships,
    merchantIds: [merchant.merchantId],
  })

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
    const requirements = requirementsFor(
      catalog,
      card,
      held,
      wallet,
      merchant,
      purchase,
    )
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
      requirements,
      conditions: [
        ...conditionsText(catalog, card, requirements),
        ...membershipNeeded(catalog, card, paid),
      ],
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
    assumptions: exploreAssumptions(
      catalog,
      merchant,
      ranked,
      options,
      purchase,
    ),
    warnings: exploreWarnings(catalog, merchant),
  }
}

function exploreAssumptions(
  catalog: Catalog,
  merchant: MerchantResolution,
  ranked: ExploreEntry[],
  options: ExploreOptions,
  purchase: Purchase,
): string[] {
  const assumptions: string[] = []
  if (merchant.source === 'category') {
    assumptions.push(
      `Ranks purchases that code as ${categoryPhrase(catalog, merchant.category)}.`,
    )
  } else if (merchant.source !== 'none') {
    assumptions.push(codesAs(catalog, merchant))
  }
  assumptions.push(
    'Assumes each card is set up for this purchase: the right category pick, any activation done, and none of its cap used yet. A card you hold may differ.',
  )
  assumptions.push(
    options.memberships.length === 0
      ? 'Assumes no memberships (like Amazon Prime). Rates that need one are listed separately.'
      : `Assumes these memberships: ${listed(options.memberships.map((m) => membershipName(catalog, m)))}.`,
  )
  const values = pointValuesText(catalog, ranked.slice(0, 10))
  if (values !== null) assumptions.push(values)
  if (isForeign(purchase)) assumptions.push(FOREIGN_ASSUMPTION)
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
