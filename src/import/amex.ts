import { isoDate } from './csv.ts'
import type { StatementLine } from './statement.ts'

// Only these columns are read. Everything else in the export (addresses,
// reference numbers, extended details) is dropped as the file is parsed.
const DATE = 'Date'
const DESCRIPTION = 'Description'
const AMOUNT = 'Amount'
const CATEGORY = 'Category'

export function isAmexCsv(header: string[]): boolean {
  return [DATE, DESCRIPTION, AMOUNT].every((c) => header.includes(c))
}

// Card payments, and the card's own fees, aren't purchases.
const PAYMENT = /\b(AUTOPAY|ONLINE) PAYMENT\b|PAYMENT - THANK YOU/i
const FEES = /^Fees & Adjustments/i

export function parseAmexCsv(
  rows: string[][],
  header: string[],
): StatementLine[] {
  const col = (name: string) => header.indexOf(name)
  const lines: StatementLine[] = []
  for (const row of rows) {
    const date = isoDate(row[col(DATE)] ?? '')
    const description = (row[col(DESCRIPTION)] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    const amount = Number(row[col(AMOUNT)])
    if (date === null || description === '' || !Number.isFinite(amount))
      continue
    if (PAYMENT.test(description)) continue
    const category =
      col(CATEGORY) === -1 ? '' : (row[col(CATEGORY)] ?? '').trim()
    if (FEES.test(category)) continue
    const issuerCategory = category === '' ? null : category
    lines.push({
      date,
      description,
      amount,
      issuerCategory,
      category: mapAmexCategory(issuerCategory),
    })
  }
  return lines
}

// Amex's statement categories, mapped to earnrate's. Order matters: the
// first match wins.
const CATEGORY_MAP: [RegExp, string][] = [
  [/Groceries|Supermarket/i, 'grocery.supermarket'],
  [/^Restaurant/i, 'dining'],
  [/Fuel|Gas Station/i, 'gas'],
  [/Airline/i, 'travel.flights'],
  [/Lodging|Hotel/i, 'travel.hotels'],
  [/Car Rental/i, 'travel.car_rental'],
  [/Cruise/i, 'travel.cruise'],
  [/Travel Agenc/i, 'travel'],
  [/Taxi|Coach|Rail|Transit|Parking|Toll/i, 'transit'],
  [/Pharmac|Drug/i, 'drugstore'],
  [/Electronics/i, 'electronics'],
  [/Department Store/i, 'department_store'],
  [/Wholesale|Warehouse/i, 'warehouse_club'],
  [/Furnish|Furniture/i, 'furniture'],
  [/Clothing|Apparel/i, 'clothing'],
  [/Hardware|Home Improvement/i, 'home_improvement'],
  [/Sporting/i, 'sporting_goods'],
  [/Internet Purchase/i, 'online_retail'],
  [/Communication|Telephone|Cable/i, 'tv_internet'],
  [/^Entertainment/i, 'entertainment'],
]

export function mapAmexCategory(issuerCategory: string | null): string | null {
  if (issuerCategory === null) return null
  for (const [pattern, category] of CATEGORY_MAP) {
    if (pattern.test(issuerCategory)) return category
  }
  return 'other'
}
