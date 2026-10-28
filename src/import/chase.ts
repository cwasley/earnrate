import { isoDate } from './csv.ts'
import type { StatementLine } from './statement.ts'

// Chase's activity download: Transaction Date, Post Date, Description,
// Category, Type, Amount, Memo. Only date, description, category, type and
// amount are read.
const DATE = 'Transaction Date'
const DESCRIPTION = 'Description'
const CATEGORY = 'Category'
const TYPE = 'Type'
const AMOUNT = 'Amount'

export function isChaseCsv(header: string[]): boolean {
  return [DATE, DESCRIPTION, TYPE, AMOUNT].every((c) => header.includes(c))
}

export function parseChaseCsv(
  rows: string[][],
  header: string[],
): StatementLine[] {
  const col = (name: string) => header.indexOf(name)
  const lines: StatementLine[] = []
  for (const row of rows) {
    // Payments, fees and adjustments (statement credits, redemptions) aren't
    // purchases or merchant refunds.
    const type = (row[col(TYPE)] ?? '').trim()
    if (type !== 'Sale' && type !== 'Return') continue
    const date = isoDate(row[col(DATE)] ?? '')
    const description = (row[col(DESCRIPTION)] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    // Chase signs purchases negative; earnrate's lines are the other way.
    const amount = -Number(row[col(AMOUNT)])
    if (date === null || description === '' || !Number.isFinite(amount))
      continue
    const category =
      col(CATEGORY) === -1 ? '' : (row[col(CATEGORY)] ?? '').trim()
    const issuerCategory = category === '' ? null : category
    lines.push({
      date,
      description,
      amount,
      issuerCategory,
      category: mapChaseCategory(issuerCategory),
    })
  }
  return lines
}

// Chase's categories are broad, so only the ones that pin down an earning
// category are mapped. "Shopping" or "Entertainment" says nothing a card's
// rules can use.
const CATEGORY_MAP: Record<string, string> = {
  'Food & Drink': 'dining',
  Groceries: 'grocery.supermarket',
  Gas: 'gas',
  Travel: 'travel',
}

export function mapChaseCategory(issuerCategory: string | null): string | null {
  if (issuerCategory === null) return null
  return CATEGORY_MAP[issuerCategory] ?? 'other'
}
