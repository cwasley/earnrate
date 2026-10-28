import type { Catalog } from '../data/load.ts'
import type { Cap, Card, Rule } from '../schema/card.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { periodKey } from './periods.ts'
import type { Channel, MerchantResolution, Purchase } from './types.ts'

export type PurchaseContext = {
  category: string
  merchantId: string | null
  mcc: number | null
  channel: Channel | null
  country: string
  date: string
  amount: number | null
  memberships: Set<string>
}

export function purchaseContext(
  catalog: Catalog,
  wallet: Wallet,
  merchant: MerchantResolution,
  category: string,
  purchase: Pick<Purchase, 'amount' | 'date' | 'country'>,
): PurchaseContext {
  return {
    category,
    merchantId: merchant.merchantId,
    mcc:
      category === merchant.category && merchant.likelyMcc !== null
        ? merchant.likelyMcc
        : singleMcc(catalog, category),
    channel: merchant.channel,
    country: purchase.country,
    date: purchase.date,
    amount: purchase.amount,
    memberships: new Set(wallet.memberships),
  }
}

// A category with one typical MCC (travel agencies are 4722) implies it, the
// same assumption explanations state.
function singleMcc(catalog: Catalog, category: string): number | null {
  const mccs = catalog.categories.find((c) => c.id === category)?.mccs ?? []
  return mccs.length === 1 ? (mccs[0] ?? null) : null
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
  nominalRate: number
  rate: number // after the cap, blended across it when the amount is known
  cap: CapState | null
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

function applicability(
  rule: Rule,
  ctx: PurchaseContext,
  held: WalletCard,
  picked: Map<string, PickedCoverage>,
): Applicability {
  const { match, exclude } = rule
  const inCategory = (cats: string[]) =>
    cats.some((c) => categoryMatches(c, ctx.category))

  if (match.categories?.length && !inCategory(match.categories)) return 'no'
  if (
    match.merchants?.length &&
    !(ctx.merchantId !== null && match.merchants.includes(ctx.merchantId))
  ) {
    return 'no'
  }
  if (match.mccs?.length && !(ctx.mcc !== null && match.mccs.includes(ctx.mcc)))
    return 'no'
  if (match.choice !== undefined) {
    const covered = picked.get(match.choice)
    const merchantPicked =
      ctx.merchantId !== null &&
      (covered?.merchants.includes(ctx.merchantId) ?? false)
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
  if (
    exclude?.merchants &&
    ctx.merchantId !== null &&
    exclude.merchants.includes(ctx.merchantId)
  ) {
    return 'no'
  }
  if (exclude?.mccs && ctx.mcc !== null && exclude.mccs.includes(ctx.mcc))
    return 'no'

  if (rule.channel !== 'any' && rule.channel !== ctx.channel) return 'no'
  if (rule.geography === 'us_only' && ctx.country !== 'US') return 'no'
  if (rule.valid_from !== undefined && ctx.date < rule.valid_from) return 'no'
  if (rule.valid_to !== undefined && ctx.date > rule.valid_to) return 'no'
  const membership = rule.requires?.membership
  if (membership !== undefined && !ctx.memberships.has(membership)) return 'no'
  if (rule.requires?.activation && !held.activated.includes(rule.id))
    return 'needs-activation'
  return 'applies'
}

function capState(
  rule: Rule,
  card: Card,
  held: WalletCard,
  date: string,
): CapState | null {
  if (rule.cap === undefined) return null
  const capId = typeof rule.cap === 'string' ? rule.cap : null
  const cap = capId === null ? rule.cap : card.caps.find((c) => c.id === capId)
  if (cap === undefined || typeof cap === 'string') return null
  const key = capId ?? rule.id
  const period = periodKey(cap.period, date, held.anniversary ?? null)
  const usage = held.cap_usage[key]
  const used = period !== null && usage?.period === period ? usage.spent : 0
  return { key, cap, period, remaining: Math.max(0, cap.amount - used) }
}

export function rateAfterCap(
  rate: number,
  cap: CapState | null,
  amount: number | null,
): number {
  if (!cap) return rate
  if (amount !== null && amount > 0) {
    const inCap = Math.min(amount, cap.remaining)
    return (inCap * rate + (amount - inCap) * cap.cap.then_rate) / amount
  }
  return cap.remaining > 0 ? rate : cap.cap.then_rate
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
  const base: Earning = {
    rule: null,
    nominalRate: card.base_rate,
    rate: card.base_rate,
    cap: null,
  }
  let best = base
  let nominal = base
  const blocked: Rule[] = []

  for (const rule of card.rules) {
    const status = applicability(rule, ctx, held, picked)
    if (status === 'no') continue
    if (status === 'needs-activation') {
      blocked.push(rule)
      continue
    }
    const cap = capState(rule, card, held, ctx.date)
    const earning: Earning = {
      rule,
      nominalRate: rule.rate,
      rate: rateAfterCap(rule.rate, cap, ctx.amount),
      cap,
    }
    if (beats(earning, earning.rate, best, best.rate)) best = earning
    if (beats(earning, earning.nominalRate, nominal, nominal.nominalRate))
      nominal = earning
  }

  return {
    best,
    nominal,
    needsActivation: blocked.filter((r) => r.rate > best.rate),
    staleChoice,
  }
}
