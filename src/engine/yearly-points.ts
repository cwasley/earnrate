// Points a card gives every cardmember year with no enrolling and no
// spending total: counted in every yearly figure, never in a purchase's.
// Node-free: earnrate.dev runs it in the browser.
import type { Card, YearlyPoints } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import { currencyName, listed, money, num, pct, wholeDollars } from './text.ts'

// The year's points from one entry, given what the card took and earned
// that year: `spend` in dollars, `points` in its own currency.
export function yearlyPointsAmount(
  y: YearlyPoints,
  year: { spend: number; points: number },
): number {
  if (y.points !== undefined) return y.points
  const percent = (y.percent ?? 0) / 100
  return Math.round(percent * (y.of === 'points' ? year.points : year.spend))
}

// "10,000 Capital One miles every year", "Chase Ultimate Rewards equal to
// 10% of the year's purchases, every year"
export function yearlyPointsText(y: YearlyPoints, currency: string): string {
  if (y.points !== undefined)
    return `${y.points.toLocaleString('en-US')} ${currency} every year`
  const percent = pct(y.percent ?? 0)
  return y.of === 'points'
    ? `${percent} more ${currency} on what the year's purchases earned, every year`
    : `${currency} equal to ${percent} of the year's purchases, every year`
}

// What it's worth at `cents` a point: "about $100", or for a percentage,
// "about $1 for each $1,000 spent" or "about 10% more on what it earns".
export function yearlyPointsWorth(y: YearlyPoints, cents: number): string {
  if (y.points !== undefined)
    return `about ${wholeDollars((y.points * cents) / 100)}`
  if (y.of === 'points') return `${pct(y.percent ?? 0)} more on what it earns`
  const per1000 = ((y.percent ?? 0) / 100) * 1000 * (cents / 100)
  return `about ${Number.isInteger(per1000) ? wholeDollars(per1000) : money(per1000)} for each $1,000 spent`
}

// "10,000 Capital One miles every year (about $100 at 1¢ a point)"
export const yearlyPointsLine = (
  y: YearlyPoints,
  currency: string,
  cents: number,
) =>
  `${yearlyPointsText(y, currency)} (${yearlyPointsWorth(y, cents)} at ${num(cents)}¢ a point)`

// What the yearly figures count for a card, for what an answer assumes:
// "its 10,000 Capital One miles every year"; null without any.
export function yearlyPointsCounted(
  catalog: Catalog,
  card: Card,
  owner = 'its',
): string | null {
  if (card.yearly_points.length === 0) return null
  const currency = currencyName(catalog, card.currency)
  return `${owner} ${listed(card.yearly_points.map((y) => yearlyPointsText(y, currency)))}`
}
