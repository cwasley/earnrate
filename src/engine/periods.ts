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
