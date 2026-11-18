// A month picked as two menus, the month by name and the year, for the
// card history's months. Desktop Safari shows <input type="month"> as a
// plain text box that drops what's typed into it, so the site doesn't use it.

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// How many years back the year menu goes, before a saved month's own year.
export const YEARS_BACK = 30

export type MonthParts = { month: number; year: number } // 0 when not picked

export const partsOf = (value: string): MonthParts =>
  /^\d{4}-\d{2}$/.test(value)
    ? { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) }
    : { month: 0, year: 0 }

// This year first, then each year back; a saved month's year is kept even
// when it's older.
export function yearsFor(value: string, today: string): number[] {
  const now = Number(today.slice(0, 4))
  const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => now - i)
  const saved = partsOf(value).year
  return saved > 0 && !years.includes(saved) ? [...years, saved] : years
}

// The month to save: YYYY-MM once both are picked and it isn't in the
// future, otherwise '' (nothing saved).
export function monthOf({ month, year }: MonthParts, today: string): string {
  if (month === 0 || year === 0) return ''
  const value = `${String(year)}-${String(month).padStart(2, '0')}`
  return value > today.slice(0, 7) ? '' : value
}

// A month or year the other menu's pick would put in the future.
export const futureMonth = (month: number, year: number, today: string) =>
  year > 0 &&
  month > 0 &&
  `${String(year)}-${String(month).padStart(2, '0')}` > today.slice(0, 7)
