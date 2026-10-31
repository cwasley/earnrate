import type { Catalog } from '../schema/catalog.ts'
import { singleMcc } from './evaluate.ts'
import type { MerchantResolution } from './types.ts'

export const num = (n: number) => String(Number(n.toFixed(2)))
export const pct = (n: number) => `${num(n)}%`
export const roundCents = (n: number) => Math.round(n * 100) / 100

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
