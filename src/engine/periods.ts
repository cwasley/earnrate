import type { Card } from '../schema/card.ts'

export type Period = 'month' | 'quarter' | 'calendar_year' | 'cardmember_year'

// Keys match the wallet's PeriodKey format: "2026" or "2026-Q4". A cardmember
// year is keyed by the calendar year it started in. Returns null when a
// cardmember year is asked for without an anniversary (MM-DD).
export function periodKey(
  period: Period,
  date: string,
  anniversary: string | null,
): string | null {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  switch (period) {
    case 'month':
      return date.slice(0, 7)
    case 'calendar_year':
      return String(year)
    case 'quarter':
      return `${String(year)}-Q${String(Math.floor((month - 1) / 3) + 1)}`
    case 'cardmember_year':
      if (anniversary === null) return null
      return String(date.slice(5) >= anniversary ? year : year - 1)
  }
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

// The user's local calendar date, not UTC: a purchase at 9pm in Los Angeles
// belongs to that day.
export function localToday(now = new Date()): string {
  return [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

// The period a card's picks are filed under in a wallet. Picks that carry
// over (until_changed) are never compared, so they file under the calendar
// year. null when the card's picks reset on different schedules.
export function choicePeriod(card: Card): Period | null {
  const periods = [
    ...new Set(
      card.choices.map((c) => c.period).filter((p) => p !== 'until_changed'),
    ),
  ]
  return periods.length > 1 ? null : (periods[0] ?? 'calendar_year')
}

// Whether a dated rule or offer is in effect on `date`; an open end has no
// limit on that side.
export const inEffect = (
  window: { valid_from?: string | undefined; valid_to?: string | undefined },
  date: string,
) =>
  (window.valid_from === undefined || window.valid_from <= date) &&
  (window.valid_to === undefined || window.valid_to >= date)

// The last day of a period key ("2026-Q4", "2026-10", "2026").
export function periodEnd(period: string): string | null {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period)
  if (quarter) {
    const end = ['03-31', '06-30', '09-30', '12-31'][Number(quarter[2]) - 1]
    return `${quarter[1] ?? ''}-${end ?? ''}`
  }
  const month = /^(\d{4})-(\d{2})$/.exec(period)
  if (month) {
    const last = new Date(Date.UTC(Number(month[1]), Number(month[2]), 0))
    return last.toISOString().slice(0, 10)
  }
  return /^\d{4}$/.test(period) ? `${period}-12-31` : null
}
