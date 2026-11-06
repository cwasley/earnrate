import type { Card } from '../schema/card.ts'

export type Period =
  'month' | 'quarter' | 'half_year' | 'calendar_year' | 'cardmember_year'

// Keys match the wallet's PeriodKey format: "2026", "2026-Q4" or "2026-H2"
// (July to December). A cardmember year is keyed by the calendar year it
// started in. Returns null when a cardmember year is asked for without an
// anniversary (MM-DD).
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
    case 'half_year':
      return `${String(year)}-H${month <= 6 ? '1' : '2'}`
    case 'cardmember_year':
      if (anniversary === null) return null
      return String(date.slice(5) >= anniversary ? year : year - 1)
  }
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
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

const utcDay = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)

// The last day of the period a key from periodKey names. A calendar year and
// a cardmember year share the key shape ("2026"), so the kind is needed: a
// cardmember year ends the day before the next anniversary. null for a
// cardmember year without an anniversary, or a key that doesn't fit the kind.
export function periodEnd(
  period: Period,
  key: string,
  anniversary: string | null,
): string | null {
  switch (period) {
    case 'month': {
      const m = /^(\d{4})-(\d{2})$/.exec(key)
      return m ? utcDay(Number(m[1]), Number(m[2]) + 1, 0) : null
    }
    case 'quarter': {
      const q = /^(\d{4})-Q([1-4])$/.exec(key)
      return q ? utcDay(Number(q[1]), Number(q[2]) * 3 + 1, 0) : null
    }
    case 'half_year': {
      const h = /^(\d{4})-H([12])$/.exec(key)
      return h ? utcDay(Number(h[1]), Number(h[2]) * 6 + 1, 0) : null
    }
    case 'calendar_year':
      return /^\d{4}$/.test(key) ? `${key}-12-31` : null
    case 'cardmember_year': {
      const a =
        anniversary === null ? null : /^(\d{2})-(\d{2})$/.exec(anniversary)
      if (!a || !/^\d{4}$/.test(key)) return null
      // Date.UTC rolls over; a parsed "2027-02-29" would be invalid.
      return utcDay(Number(key) + 1, Number(a[1]), Number(a[2]) - 1)
    }
  }
}

// The last day of the period `date` falls in.
export function currentPeriodEnd(
  period: Period,
  date: string,
  anniversary: string | null,
): string | null {
  const key = periodKey(period, date, anniversary)
  return key === null ? null : periodEnd(period, key, anniversary)
}
