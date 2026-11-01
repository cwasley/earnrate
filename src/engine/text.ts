import type { Catalog } from '../schema/catalog.ts'
import { singleMcc } from './evaluate.ts'
import type { MerchantResolution } from './types.ts'

export const num = (n: number) => String(Number(n.toFixed(2)))
export const pct = (n: number) => `${num(n)}%`
export const roundCents = (n: number) => Math.round(n * 100) / 100

// An id in words: "gas-ev-charging" reads "gas ev charging".
export const words = (id: string) => id.replace(/[-_.]/g, ' ')

// "Dec 31, 2026" from YYYY-MM-DD, the same in every time zone.
export const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

// Whole dollars stay whole ($2,800); anything else shows cents ($0.40).
export const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`

export function feeText(fees: {
  annualFee: number | null
  firstYearFee: number | null
}): string {
  const { annualFee, firstYearFee } = fees
  if (annualFee === null) return 'annual fee not on file'
  if (annualFee === 0) return 'no annual fee'
  if (firstYearFee !== null && firstYearFee !== annualFee)
    return `${money(annualFee)} annual fee (${firstYearFee === 0 ? 'waived' : money(firstYearFee)} the first year)`
  return `${money(annualFee)} annual fee`
}

export function currencyName(catalog: Catalog, id: string): string {
  return catalog.currencies.find((c) => c.id === id)?.name ?? id
}

export function currencyLabel(catalog: Catalog, id: string): string {
  const name = currencyName(catalog, id)
  return /^[A-Z]{2,4}$/.test(id) ? `${name} (${id})` : name
}

// Mid-sentence form: "Supermarkets" becomes "supermarkets", but "TV and
// internet service" and "EV charging" keep their acronyms.
export function categoryPhrase(catalog: Catalog, id: string): string {
  const name = catalog.categories.find((c) => c.id === id)?.name ?? id
  return /^[A-Z]{2}/.test(name)
    ? name
    : name.charAt(0).toLowerCase() + name.slice(1)
}

export function earnText(
  catalog: Catalog,
  rate: number,
  currency: string,
): string {
  return currency === 'cash'
    ? `${num(rate)}% cash back`
    : `${num(rate)}x ${currencyName(catalog, currency)}`
}

export function codesAs(
  catalog: Catalog,
  merchant: MerchantResolution,
): string {
  const mcc = merchant.likelyMcc ?? singleMcc(catalog, merchant.category)
  const code = mcc === null ? '' : ` (MCC ${String(mcc)})`
  return `Assumes ${merchant.resolvedName} codes as ${categoryPhrase(catalog, merchant.category)}${code}.`
}

// "Values points at: Membership Rewards (MR) at 1¢." for the currencies an
// answer ranks, or null when every card shown earns cash.
export function pointValuesText(
  catalog: Catalog,
  shown: { currency: string; centsPerUnit: number }[],
): string | null {
  const values = new Map<string, number>()
  for (const e of shown)
    if (e.currency !== 'cash') values.set(e.currency, e.centsPerUnit)
  if (values.size === 0) return null
  const list = [...values].map(
    ([id, cents]) => `${currencyLabel(catalog, id)} at ${num(cents)}¢`,
  )
  return `Values points at: ${list.join(', ')}.`
}

export const NETWORK_NAMES: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  store: 'store card',
}
