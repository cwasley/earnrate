import { merchantFamily } from '../merchants/resolve.ts'
import type { Card, Credit } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { WalletCard } from '../schema/wallet.ts'
import { categoryMatches } from './evaluate.ts'
import { periodEnd, periodKey } from './periods.ts'
import { creditName } from './rule-text.ts'
import { roundCents, type CreditWords } from './text.ts'
import type { MerchantResolution } from './types.ts'

// Node-free: earnrate.dev ranks with it in the browser.

export type CreditState = CreditWords & {
  credit: Credit
  key: string | null // the period, like 2026-Q4; null for a cardmember year without an anniversary
  used: number // dollars of credit received this period
}

// Only a store itself has a credit: a search for a kind of purchase
// ("clothing") never does.
// A credit naming a merchant also covers its brands (Hilton's covers Hampton).
export function creditCovers(
  catalog: Catalog,
  credit: Credit,
  merchant: Pick<MerchantResolution, 'merchantId' | 'category' | 'source'>,
): boolean {
  if (merchant.source === 'category' || merchant.source === 'none') return false
  const named = credit.match.merchants
  if (named)
    return merchantFamily(catalog, merchant.merchantId).some((id) =>
      named.includes(id),
    )
  return (credit.match.categories ?? []).some((c) =>
    categoryMatches(c, merchant.category),
  )
}

// A credit that needs enrolling counts only once the wallet says it's done.
export const isEnrolled = (credit: Credit, held: WalletCard) =>
  credit.enroll !== true || (held.enrolled ?? []).includes(credit.id)

export function creditState(
  catalog: Catalog,
  credit: Credit,
  held: WalletCard,
  date: string,
): CreditState {
  const anniversary = held.anniversary ?? null
  const period = periodKey(credit.period, date, anniversary)
  const usage = held.credit_usage?.[credit.id]
  const used =
    period !== null && usage !== undefined && usage.period === period
      ? usage.used
      : 0
  return {
    credit,
    key: period,
    name: creditName(catalog, credit),
    amount: credit.amount,
    period: credit.period,
    enrolled: isEnrolled(credit, held),
    used,
    left:
      period === null ? null : roundCents(Math.max(0, credit.amount - used)),
    until:
      period === null ? null : periodEnd(credit.period, period, anniversary),
  }
}

export const creditStates = (
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  date: string,
) => card.credits.map((c) => creditState(catalog, c, held, date))

export const counts = (s: CreditState) =>
  s.enrolled && s.left !== null && s.left > 0

// The card's credit at this merchant, if any: one that counts first, then
// the one with the most left.
export function creditAt(
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  merchant: Pick<MerchantResolution, 'merchantId' | 'category' | 'source'>,
  date: string,
): CreditState | null {
  const here = card.credits
    .filter((c) => creditCovers(catalog, c, merchant))
    .map((c) => creditState(catalog, c, held, date))
    .sort(
      (a, b) =>
        Number(counts(b)) - Number(counts(a)) || (b.left ?? 0) - (a.left ?? 0),
    )
  return here[0] ?? null
}

// Dollars back on a purchase: null without an amount, 0 when the credit
// doesn't count (not enrolled, or used up).
export function creditDollars(
  s: CreditState,
  amount: number | null,
): number | null {
  if (amount === null) return null
  if (!counts(s) || amount <= 0) return 0
  return roundCents(Math.min(amount, s.left ?? 0))
}

const PER_YEAR: Record<Credit['period'], number> = {
  month: 12,
  quarter: 4,
  half_year: 2,
  calendar_year: 1,
  cardmember_year: 1,
}

export const creditPerYear = (c: Pick<Credit, 'amount' | 'period'>) =>
  c.amount * PER_YEAR[c.period]
