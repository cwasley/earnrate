import type { Cap, Card, PaymentMethod, Rule } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { merchantFamily } from '../merchants/resolve.ts'
import { EPSILON } from './compare.ts'
import {
  introCovers,
  introWindows,
  withIntro,
  type IntroWindow,
} from './intro.ts'
import { inEffect, periodKey } from './periods.ts'
import type { Channel, MerchantResolution, Purchase } from './types.ts'

export type PurchaseContext = {
  category: string
  merchantIds: string[] // the merchant and, for a brand, its parent
  mcc: number | null
  channel: Channel | null
  country: string
  date: string
  amount: number | null
  memberships: Set<string>
  payment: PaymentMethod | null
}

// PayPal checkout happens online, so paying through it says the channel.
const paymentChannel = (
  channel: Channel | null,
  payment: PaymentMethod | null,
): Channel | null => channel ?? (payment === 'paypal' ? 'online' : null)

export function purchaseContext(
  catalog: Catalog,
  wallet: Wallet,
  merchant: MerchantResolution,
  category: string,
  purchase: Pick<Purchase, 'amount' | 'date' | 'country' | 'payment'>,
): PurchaseContext {
  const payment = purchase.payment ?? null
  return {
    category,
    merchantIds: merchantFamily(catalog, merchant.merchantId),
    mcc:
      category === merchant.category && merchant.likelyMcc !== null
        ? merchant.likelyMcc
        : singleMcc(catalog, category),
    channel: paymentChannel(merchant.channel, payment),
    country: purchase.country,
    date: purchase.date,
    amount: purchase.amount,
    memberships: new Set(wallet.memberships),
    payment,
  }
}

// A category with one typical MCC (travel agencies are 4722) implies it, the
// same assumption explanations state.
export function singleMcc(catalog: Catalog, category: string): number | null {
  const mccs = catalog.categories.find((c) => c.id === category)?.mccs ?? []
  return mccs.length === 1 ? (mccs[0] ?? null) : null
}

// A store card works only at its own stores; any other card wherever the
// merchant takes its network, which counts as yes when unknown.
export function usableAt(card: Card, merchant: MerchantResolution): boolean {
  if (card.only_at)
    return (
      merchant.merchantId !== null && card.only_at.includes(merchant.merchantId)
    )
  return (
    card.network === 'store' ||
    merchant.accepts === null ||
    merchant.accepts.includes(card.network)
  )
}

export function categoryMatches(
  ruleCategory: string,
  category: string,
): boolean {
  return category === ruleCategory || category.startsWith(`${ruleCategory}.`)
}

export type CapState = {
  key: string // shared cap id, or the rule id for an inline cap
  cap: Cap
  period: string | null // null when it can't be computed (no anniversary)
  remaining: number // dollars left at the bonus rate this period
}

export type Earning = {
  rule: Rule | null // null for the base rate
  nominalRate: number // with any intro rate
  standardRate: number // without it
  intro: IntroWindow[] // the intro rates that raise nominalRate
  rate: number // after the cap, blended across it when the amount is known
  cap: CapState | null
  // What spending past the cap earns: the cap's own rate, or the card's best
  // uncapped rate for this purchase if that's higher (Freedom Flex's 3%
  // dining once its quarterly 5% is used up).
  afterCap: number | null
}

export type CardEvaluation = {
  best: Earning
  // The highest-rate matching rule ignoring caps: spend is booked against its cap.
  nominal: Earning
  needsActivation: Rule[] // would beat `best` if activated
  staleChoice: string | null // the chosen-category period on file, when it isn't current
}

export type PickedCoverage = {
  categories: string[]
  merchants: string[]
  online: { exclude: string[] }[] // picked "any online purchase" options
}

export function pickedCategories(
  card: Card,
  held: WalletCard,
  date: string,
): { picked: Map<string, PickedCoverage>; staleChoice: string | null } {
  const picked = new Map<string, PickedCoverage>()
  const chosen = held.chosen
  let staleChoice: string | null = null
  for (const choice of card.choices) {
    let picks = chosen?.picks[choice.id]
    if (
      picks &&
      chosen &&
      choice.period !== 'until_changed' &&
      chosen.period !== periodKey(choice.period, date, null)
    ) {
      staleChoice = chosen.period
      picks = undefined
    }
    picks ??= choice.default
    if (!picks) continue
    const options = picks.flatMap((p) => choice.options[p] ?? [])
    picked.set(choice.id, {
      categories: options.flatMap((o) => o.categories),
      merchants: options.flatMap((o) => o.merchants),
      online: options.flatMap((o) => (o.online ? [o.online] : [])),
    })
  }
  return { picked, staleChoice }
}

type Applicability = 'applies' | 'needs-activation' | 'no'

// Activating a rotating quarter (Freedom Flex) turns on all its categories:
// rules on the same rotating cap with the same dates share one activation.
export function activationGroup(card: Card, ruleId: string): string[] {
  const rule = card.rules.find((r) => r.id === ruleId)
  const cap =
    typeof rule?.cap === 'string'
      ? card.caps.find((c) => c.id === rule.cap)
      : undefined
  if (!rule || !cap?.rotating) return [ruleId]
  return card.rules
    .filter(
      (r) =>
        r.requires?.activation === true &&
        r.cap === rule.cap &&
        r.valid_from === rule.valid_from &&
        r.valid_to === rule.valid_to,
    )
    .map((r) => r.id)
}

export function isActivated(
  card: Card,
  held: WalletCard,
  ruleId: string,
): boolean {
  return activationGroup(card, ruleId).some((id) => held.activated.includes(id))
}

function applicability(
  card: Card,
  rule: Rule,
  ctx: PurchaseContext,
  held: WalletCard,
  picked: Map<string, PickedCoverage>,
): Applicability {
  const { match, exclude } = rule
  const inCategory = (cats: string[]) =>
    cats.some((c) => categoryMatches(c, ctx.category))
  const named = (ids: string[] | undefined) =>
    ids?.some((id) => ctx.merchantIds.includes(id)) ?? false

  if (match.categories?.length && !inCategory(match.categories)) return 'no'
  if (match.merchants?.length && !named(match.merchants)) return 'no'
  if (match.mccs?.length && !(ctx.mcc !== null && match.mccs.includes(ctx.mcc)))
    return 'no'
  if (match.choice !== undefined) {
    const covered = picked.get(match.choice)
    const merchantPicked = named(covered?.merchants)
    const onlinePicked =
      ctx.channel === 'online' &&
      (covered?.online.some((o) => !inCategory(o.exclude)) ?? false)
    if (
      !merchantPicked &&
      !onlinePicked &&
      !inCategory(covered?.categories ?? [])
    )
      return 'no'
  }

  if (exclude?.categories && inCategory(exclude.categories)) return 'no'
  if (named(exclude?.merchants)) return 'no'
  if (exclude?.mccs && ctx.mcc !== null && exclude.mccs.includes(ctx.mcc))
    return 'no'
  if (
    exclude?.payment &&
    ctx.payment !== null &&
    exclude.payment.includes(ctx.payment)
  )
    return 'no'

  if (rule.channel !== 'any' && rule.channel !== ctx.channel) return 'no'
  if (rule.geography === 'us_only' && ctx.country !== 'US') return 'no'
  if (rule.geography === 'foreign_only' && ctx.country === 'US') return 'no'
  if (!inEffect(rule, ctx.date)) return 'no'
  const membership = rule.requires?.membership
  if (membership !== undefined && !ctx.memberships.has(membership)) return 'no'
  const payment = rule.requires?.payment
  if (payment !== undefined && ctx.payment !== payment) return 'no'
  if (rule.requires?.activation && !isActivated(card, held, rule.id))
    return 'needs-activation'
  return 'applies'
}

// A cap's key in the wallet's cap_usage: the shared cap's id, or the rule's
// id for a cap written on the rule.
export function capByKey(card: Card, key: string): Cap | undefined {
  const shared = card.caps.find((c) => c.id === key)
  if (shared) return shared
  const inline = card.rules.find((r) => r.id === key)?.cap
  return typeof inline === 'object' ? inline : undefined
}

// How much of a cap has been spent in the period `date` falls in.
export function capUsed(
  cap: Cap,
  key: string,
  held: WalletCard,
  date: string,
): { period: string | null; spent: number } {
  const period = periodKey(cap.period, date, held.anniversary ?? null)
  const usage = held.cap_usage[key]
  return {
    period,
    spent: period !== null && usage?.period === period ? usage.spent : 0,
  }
}

function capState(
  rule: Rule,
  card: Card,
  held: WalletCard,
  date: string,
): CapState | null {
  if (rule.cap === undefined) return null
  const key = typeof rule.cap === 'string' ? rule.cap : rule.id
  const cap = capByKey(card, key)
  if (cap === undefined) return null
  const { period, spent } = capUsed(cap, key, held, date)
  return { key, cap, period, remaining: Math.max(0, cap.amount - spent) }
}

function rateAfterCap(
  rate: number,
  cap: CapState | null,
  afterCap: number,
  amount: number | null,
): number {
  if (!cap) return rate
  if (amount !== null && amount > 0) {
    const inCap = Math.min(amount, cap.remaining)
    return (inCap * rate + (amount - inCap) * afterCap) / amount
  }
  return cap.remaining > 0 ? rate : afterCap
}

// On equal rates an uncapped rule wins, so spend that can earn the same
// without a cap doesn't use one up. Otherwise the earlier rule stays.
function beats(a: Earning, aRate: number, b: Earning, bRate: number): boolean {
  if (aRate !== bRate) return aRate > bRate
  return b.rule !== null && b.cap !== null && a.cap === null
}

export function evaluateCard(
  card: Card,
  held: WalletCard,
  ctx: PurchaseContext,
): CardEvaluation {
  const { picked, staleChoice } = pickedCategories(card, held, ctx.date)
  const windows = introWindows(card, held, ctx.date)
  const introFor = (ruleId: string | null) =>
    windows.filter((w) => introCovers(w.intro, ruleId))
  const rateOf = (rule: Rule) => withIntro(rule.rate, rule.id, windows)
  const baseRate = withIntro(card.base_rate, null, windows)
  const base: Earning = {
    rule: null,
    nominalRate: baseRate,
    standardRate: card.base_rate,
    intro: introFor(null),
    rate: baseRate,
    cap: null,
    afterCap: null,
  }
  let best = base
  let nominal = base
  const blocked: Rule[] = []
  const applying: Rule[] = []

  for (const rule of card.rules) {
    const status = applicability(card, rule, ctx, held, picked)
    if (status === 'no') continue
    if (status === 'needs-activation') blocked.push(rule)
    else applying.push(rule)
  }
  const uncapped = Math.max(
    baseRate,
    ...applying.filter((r) => r.cap === undefined).map(rateOf),
  )

  for (const rule of applying) {
    const cap = capState(rule, card, held, ctx.date)
    const rate = rateOf(rule)
    const afterCap = cap
      ? Math.max(withIntro(cap.cap.then_rate, rule.id, windows, true), uncapped)
      : null
    const earning: Earning = {
      rule,
      nominalRate: rate,
      standardRate: rule.rate,
      intro: introFor(rule.id),
      rate: rateAfterCap(rate, cap, afterCap ?? rate, ctx.amount),
      cap,
      afterCap,
    }
    if (beats(earning, earning.rate, best, best.rate)) best = earning
    if (beats(earning, earning.nominalRate, nominal, nominal.nominalRate))
      nominal = earning
  }

  return {
    best,
    nominal,
    needsActivation: blocked.filter((r) => rateOf(r) > best.rate),
    staleChoice,
  }
}

// The way of paying (one a rule on the card requires) that would earn the
// most on this purchase, when that beats `rate`. Only while the purchase
// doesn't say how it's paid.
export function paymentUpgrade(
  card: Card,
  held: WalletCard,
  ctx: PurchaseContext,
  rate: number,
): { payment: PaymentMethod; rate: number; nominalRate: number } | null {
  if (ctx.payment !== null) return null
  let best: {
    payment: PaymentMethod
    rate: number
    nominalRate: number
  } | null = null
  const methods = new Set(
    card.rules.flatMap((r) =>
      r.requires?.payment === undefined ? [] : [r.requires.payment],
    ),
  )
  for (const payment of methods) {
    const paid = evaluateCard(card, held, {
      ...ctx,
      payment,
      channel: paymentChannel(ctx.channel, payment),
    }).best
    if (paid.rate > (best?.rate ?? rate) + EPSILON)
      best = { payment, rate: paid.rate, nominalRate: paid.nominalRate }
  }
  return best
}
