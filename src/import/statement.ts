import { isAmexCsv, parseAmexCsv } from './amex.ts'
import { isChaseCsv, parseChaseCsv } from './chase.ts'
import { parseCsv } from './csv.ts'

export type StatementLine = {
  date: string // YYYY-MM-DD
  description: string
  amount: number // dollars; negative for refunds and credits
  issuerCategory: string | null // as the statement prints it
  category: string | null // the issuer's category in earnrate's terms
}

export type Issuer = 'amex' | 'chase'

export function parseStatement(text: string): {
  issuer: Issuer
  lines: StatementLine[]
} {
  const [header = [], ...rows] = parseCsv(text)
  if (isAmexCsv(header))
    return { issuer: 'amex', lines: parseAmexCsv(rows, header) }
  if (isChaseCsv(header))
    return { issuer: 'chase', lines: parseChaseCsv(rows, header) }
  throw new Error(
    'This isn’t a statement format earnrate knows. It reads Amex and Chase activity CSVs.',
  )
}

// Payment-method prefixes and point-of-sale tags that hide the merchant name:
// "AplPay TACO BELL 728LOS ANGELES CA", "TST* SLIPPERY", "BT*WAYMO", and
// Chase's trailing phone number and state ("DD *DOORDASH X 855-431-0459 CA").
export function cleanDescriptor(description: string): string {
  return description
    .replace(/&amp;/g, '&')
    .replace(/^(AplPay|AmzOne|GglPay|GOOGLE \*)\s*/i, '')
    .replace(/^(SQ|TST|BT|EB|SP|PP|PAYPAL|DD|IC|SMK)\s?\*\s?/i, '')
    .replace(/^SP\s+(?=\S)/, '')
    .replace(/\s+\d{3}-\d{3}-\d{4}(\s+[A-Z]{2})?$/, '')
    .trim()
}
