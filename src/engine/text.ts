import type { Cap, Choice } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import { singleMcc } from './evaluate.ts'
import type { MerchantResolution } from './types.ts'

export const num = (n: number) => String(Number(n.toFixed(2)))
export const pct = (n: number) => `${num(n)}%`
export const roundCents = (n: number) => Math.round(n * 100) / 100
// Ids for a message: "amex-gold, citi-double-cash".
export const idList = (ids: string[]) => ids.join(', ')
export const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

// "usbank.com" from "https://www.usbank.com/credit-cards/...".
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// An id in words: "gas-ev-charging" reads "gas ev charging".
export const words = (id: string) => id.replace(/[-_.]/g, ' ')

const dateWords = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    ...options,
    timeZone: 'UTC',
  })

// From YYYY-MM-DD, the same in every time zone: "Dec 31, 2026",
// "December 31, 2026", "December 2026".
export const shortDate = (date: string) =>
  dateWords(date, { month: 'short', day: 'numeric', year: 'numeric' })
export const longDate = (date: string) =>
  dateWords(date, { month: 'long', day: 'numeric', year: 'numeric' })
export const monthYear = (date: string) =>
  dateWords(date, { month: 'long', year: 'numeric' })

// Always cents ($4.00), for what one purchase earns. A loss reads −$4.00.
export const dollarsAndCents = (n: number) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Rounded to whole dollars ($2,800), for fees, caps and yearly totals.
export const wholeDollars = (n: number) => money(Math.round(n))

// Whole dollars stay whole ($2,800); anything else shows cents ($0.40). A
// loss reads −$618.
export const money = (n: number) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`

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
    ? `${pct(rate)} cash back`
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

// A name with its own "and" ("drugstores and pharmacies") would run into the
// list's: those lists use commas only, with those names last.
export const listed = (parts: string[], joiner = 'and') => {
  const anded = parts.filter((p) => p.includes(' and '))
  if (anded.length > 0)
    return [...parts.filter((p) => !p.includes(' and ')), ...anded].join(', ')
  return parts.length <= 2
    ? parts.join(` ${joiner} `)
    : `${parts.slice(0, -1).join(', ')} ${joiner} ${parts.at(-1) ?? ''}`
}

const NUMBERS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
}

// "five-percent" reads "5%"; other ids read as words.
export function choiceName(id: string): string {
  return words(
    id.replace(
      /\b(one|two|three|four|five|six)-percent\b/g,
      (_, n: string) => `${NUMBERS[n] ?? n}%`,
    ),
  )
}

// Period words in one place: a cap of $1,500 "a quarter", a "quarterly" cap,
// a category picked "each quarter".
export const CAP_PERIODS: Record<Cap['period'], string> = {
  month: 'a month',
  quarter: 'a quarter',
  calendar_year: 'a calendar year',
  cardmember_year: 'a cardmember year',
}

export const CAP_ADJECTIVES: Record<Cap['period'], string> = {
  month: 'monthly',
  quarter: 'quarterly',
  calendar_year: 'calendar-year',
  cardmember_year: 'cardmember-year',
}

export const PICK_PERIODS: Record<Choice['period'], string> = {
  month: 'each month',
  quarter: 'each quarter',
  calendar_year: 'each year',
  until_changed: 'until you change it',
}
