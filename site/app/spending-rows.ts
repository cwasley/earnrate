import { TYPICAL_MONTHLY_SPEND } from '../../src/engine/simulate.ts'
import { walletSaved } from './wallet-events.ts'

export type Row = { what: string; monthly: number }

const KEY = 'earnrate:spending'

// Every set of rows Find a card has started with, the current one included.
// The tab used to save them on every visit, so rows equal to one of these
// were never the person's own: they load as the current typical amounts.
export const PAST_TYPICAL: Row[][] = [
  [
    { what: 'Groceries', monthly: 500 },
    { what: 'Dining', monthly: 250 },
    { what: 'Gas', monthly: 150 },
    { what: 'Amazon', monthly: 100 },
    { what: 'Streaming', monthly: 40 },
    { what: 'Travel', monthly: 150 },
    { what: 'Everything else', monthly: 800 },
  ],
  [
    { what: 'Groceries', monthly: 500 },
    { what: 'Dining', monthly: 250 },
    { what: 'Gas', monthly: 150 },
    { what: 'Amazon', monthly: 100 },
    { what: 'Streaming', monthly: 40 },
    { what: 'Flights', monthly: 60 },
    { what: 'Hotels', monthly: 60 },
    { what: 'Other travel', monthly: 30 },
    { what: 'Everything else', monthly: 800 },
  ],
  [
    { what: 'Groceries', monthly: 500 },
    { what: 'Dining', monthly: 250 },
    { what: 'Gas', monthly: 150 },
    { what: 'Amazon', monthly: 100 },
    { what: 'Streaming (Netflix)', monthly: 40 },
    { what: 'Flights', monthly: 60 },
    { what: 'Hotels', monthly: 60 },
    { what: 'Other travel', monthly: 30 },
    { what: 'Everything else', monthly: 800 },
  ],
  [
    { what: 'Groceries', monthly: 500 },
    { what: 'Dining', monthly: 250 },
    { what: 'Gas', monthly: 150 },
    { what: 'Amazon', monthly: 100 },
    { what: 'Streaming (Netflix)', monthly: 40 },
    { what: 'Flights', monthly: 60 },
    { what: 'Hotels', monthly: 60 },
    { what: 'Other travel', monthly: 30 },
    { what: 'Cell phone', monthly: 115 },
    { what: 'TV and internet service', monthly: 95 },
    { what: 'Transit', monthly: 25 },
    { what: 'Drugstores', monthly: 40 },
    { what: 'Everything else', monthly: 525 },
  ],
]

// The same rows in any order: removing a row and adding it back puts it last.
export function sameRows(a: Row[], b: Row[]): boolean {
  if (a.length !== b.length) return false
  const key = (r: Row) => `${r.what}\u0000${String(r.monthly)}`
  const left = a.map(key).sort()
  const right = b.map(key).sort()
  return left.every((k, i) => k === right[i])
}

export const isTypicalRows = (rows: Row[]) =>
  sameRows(rows, TYPICAL_MONTHLY_SPEND)

const isRows = (value: unknown): value is Row[] =>
  Array.isArray(value) &&
  value.every(
    (r: unknown) =>
      typeof r === 'object' &&
      r !== null &&
      typeof (r as Row).what === 'string' &&
      typeof (r as Row).monthly === 'number',
  )

// The person's own rows, or the current typical ones.
export function loadSpendingRows(): Row[] {
  let saved: unknown = null
  try {
    const raw = localStorage.getItem(KEY)
    saved = raw === null ? null : JSON.parse(raw)
  } catch {
    saved = null
  }
  if (!isRows(saved) || PAST_TYPICAL.some((p) => sameRows(saved, p)))
    return TYPICAL_MONTHLY_SPEND.map((t) => ({ ...t }))
  return saved
}

// Called only when the person changes a row. Rows back at the typical
// amounts aren't kept, so a later change to those amounts reaches them.
export function saveSpendingRows(rows: Row[]): void {
  try {
    if (isTypicalRows(rows)) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(rows))
  } catch {
    // Storage is a convenience; without it the rows last until reload.
  }
  walletSaved()
}
