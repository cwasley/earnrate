// The report a saved wallet makes, as /rate reads it and as its owner's
// short link carries it: the wallet's cards with their saved picks and
// credit answers, memberships and point values, and Best setups' amounts
// when the owner puts spending in the link. Picks the wallet doesn't set are
// left for whoever opens the link to assume, as /rate does.
import type { Picks } from '../../src/engine/explore.ts'
import {
  resolveSpendLines,
  spendLineFor,
  type ResolvedLine,
} from '../../src/engine/simulate.ts'
import { currencyValuation } from '../../src/engine/valuation.ts'
import type { ReportInput } from '../../src/engine/wallet-report.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { isTypicalRows, type Row } from '../app/spending-rows.ts'
import { heldMarks } from './answers.ts'
import { encodeReport } from './link.ts'

type Card = Catalog['cards'][number]

// Picks that still name the card's options.
function validPicks(card: Card, picks: Picks | undefined): Picks {
  if (!picks) return {}
  return Object.fromEntries(
    card.choices.flatMap((c) => {
      const chosen = (picks[c.id] ?? [])
        .filter((o) => o in c.options)
        .slice(0, c.pick)
      return chosen.length > 0 ? [[c.id, chosen]] : []
    }),
  )
}

// A saved wallet as a report reads it: the cards earnrate lists, their
// picks and credit answers, memberships and the point values it sets.
export function walletReportInput(
  catalog: Catalog,
  wallet: Wallet,
): ReportInput {
  return {
    cards: wallet.cards.flatMap((h) => {
      const card = catalog.cards.find((c) => c.id === h.id)
      if (!card) return []
      const m = heldMarks(card, h)
      return [
        {
          id: h.id,
          picks: validPicks(card, h.chosen?.picks),
          ...(m.used.length > 0 ? { used: m.used } : {}),
          ...(m.skipped.length > 0 ? { skipped: m.skipped } : {}),
        },
      ]
    }),
    memberships: wallet.memberships.filter((m) =>
      catalog.memberships.some((x) => x.id === m),
    ),
    valuations: Object.fromEntries(
      Object.keys(wallet.valuations)
        .filter((id) => catalog.currencies.some((c) => c.id === id))
        .map((id) => [id, currencyValuation(catalog, wallet, id).centsPerUnit]),
    ),
  }
}

// The person's rows as a report counts them: the lines earnrate knows, at
// the amounts given, as Best setups counts them. A link rounds them to $5
// (`encodeReport`). Null for typical spending, or none of their own.
export function spendingLines(
  catalog: Catalog,
  rows: Row[] | null,
): ResolvedLine[] | null {
  if (rows === null || isTypicalRows(rows)) return null
  const lines = resolveSpendLines(
    catalog,
    rows.map((r) => spendLineFor(catalog, r.what, r.monthly)),
  ).filter((l) => l.merchant.source !== 'none' && l.monthly > 0)
  return lines.length === 0 ? null : lines
}

export type OwnParts = { input: ReportInput; lines: ResolvedLine[] | null }

// Null when the wallet holds no card earnrate lists.
export function ownParts(
  catalog: Catalog,
  wallet: Wallet | null,
  rows: Row[] | null,
  spending: boolean,
): OwnParts | null {
  if (!wallet) return null
  const input = walletReportInput(catalog, wallet)
  if (input.cards.length === 0) return null
  return { input, lines: spending ? spendingLines(catalog, rows) : null }
}

// The link's report string, without the "w=".
export function ownReport(
  catalog: Catalog,
  wallet: Wallet | null,
  rows: Row[] | null,
  spending: boolean,
): string | null {
  const parts = ownParts(catalog, wallet, rows, spending)
  return parts && encodeReport(catalog, parts).slice(2)
}
