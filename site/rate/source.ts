// Where /rate's report comes from. A shared link is read from the address
// alone: with one, nothing of the visitor's own is read, so their saved
// wallet is never shown, mixed in or changed.
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { decodeReport, reportPart, type ReportLink } from './link.ts'

export type Row = { what: string; monthly: number }

export type Saved = { wallet: Wallet | null; rows: Row[] | null }

export type Source =
  | { kind: 'shared'; link: ReportLink }
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
      ? { kind: 'shared', link: decoded.link }
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

// The spending rows Find a card saved, read only.
export function savedRows(raw: string | null): Row[] | null {
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter(
      (r): r is Row =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as Row).what === 'string' &&
        typeof (r as Row).monthly === 'number' &&
        Number.isFinite((r as Row).monthly),
    )
  } catch {
    return null
  }
}
