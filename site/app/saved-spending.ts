import { catalog } from 'virtual:catalog'
import type { Spending } from '../../src/engine/renewal.ts'
import {
  resolveSpendLines,
  spendLineFor,
  typicalSpendLines,
} from '../../src/engine/simulate.ts'
import { isTypicalRows, loadSpendingRows } from './spending-rows.ts'

// Get a card's spending rows, and whether they're still its typical
// amounts. An emptied tab says nothing about spending; typical amounts do
// better.
export function savedSpending(): Spending {
  const rows = loadSpendingRows()
  const typical = isTypicalRows(rows)
  const lines = resolveSpendLines(
    catalog,
    rows.map((r) => spendLineFor(catalog, r.what, r.monthly)),
  ).filter((l) => l.merchant.source !== 'none')
  return lines.length === 0
    ? { lines: typicalSpendLines(catalog), typical: true }
    : { lines, typical }
}
