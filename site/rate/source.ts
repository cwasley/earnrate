// Where /rate's report comes from. A shared link is read from the address
// alone, or from what a short link saved: with either, nothing of the
// visitor's own is read, so their saved wallet is never shown, mixed in or
// changed.
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { PAST_TYPICAL, sameRows } from '../app/spending-rows.ts'
import { REPORT_RETENTION_MONTHS } from '../report-policy.ts'
import { decodeReport, reportPart, type ReportLink } from './link.ts'

export type Row = { what: string; monthly: number }

export type Saved = { wallet: Wallet | null; rows: Row[] | null }

export type Source =
  | { kind: 'loading' } // a short link, being read
  | { kind: 'shared'; link: ReportLink; stored: boolean }
  | { kind: 'bad'; message: string }
  | { kind: 'own'; wallet: Wallet; rows: Row[] | null }
  | { kind: 'pick'; rows: Row[] | null }

// `readSaved` is called only when there's no shared link.
export function reportSource(
  catalog: Catalog,
  fragment: string,
  readSaved: () => Saved,
): Source {
  if (reportPart(fragment) !== null) {
    const decoded = decodeReport(catalog, fragment)
    return decoded.ok
      ? { kind: 'shared', link: decoded.link, stored: false }
      : { kind: 'bad', message: decoded.message }
  }
  const { wallet, rows } = readSaved()
  const held = wallet?.cards.filter((c) =>
    catalog.cards.some((x) => x.id === c.id),
  )
  return wallet && held && held.length > 0
    ? { kind: 'own', wallet: { ...wallet, cards: held }, rows }
    : { kind: 'pick', rows }
}

export const GONE = `This link has been deleted, or it went ${String(REPORT_RETENTION_MONTHS)} months without being opened or updated, so there's no report to show.`
export const UNREACHABLE =
  "This link's report couldn't be loaded. Check your connection, then reload the page."

// A short link's report, from what the server returned for its id.
export function storedSource(
  catalog: Catalog,
  loaded:
    { kind: 'found'; report: string } | { kind: 'gone' } | { kind: 'offline' },
): Source {
  if (loaded.kind === 'gone') return { kind: 'bad', message: GONE }
  if (loaded.kind === 'offline') return { kind: 'bad', message: UNREACHABLE }
  const decoded = decodeReport(catalog, `w=${loaded.report}`)
  return decoded.ok
    ? { kind: 'shared', link: decoded.link, stored: true }
    : { kind: 'bad', message: decoded.message }
}

// The spending rows Best setups saved, read only. Rows equal to a set Best
// setups started with, in any order, were never the person's own: null, as
// Best setups loads them as the typical amounts.
export function savedRows(raw: string | null): Row[] | null {
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const rows = parsed.filter(
      (r): r is Row =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as Row).what === 'string' &&
        typeof (r as Row).monthly === 'number' &&
        Number.isFinite((r as Row).monthly),
    )
    return PAST_TYPICAL.some((p) => sameRows(rows, p)) ? null : rows
  } catch {
    return null
  }
}
