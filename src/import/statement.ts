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

// A name whose apostrophe the statement dropped: "TRADER JOE S", "KOHL S".
const SPLIT_POSSESSIVE = /\b([A-Z]{2,}) S\b/gi
// From the first word that starts with "#" or has a digit in it: store
// numbers and the location after them ("#552 LOS ANGELES CA").
const STORE_NUMBER_ON = /\s+(#|\S*\d).*$/
// A web address's ending glued to the name: "NETFLIX.COM".
const WEB_SUFFIX = /\b([A-Z0-9&-]{2,})\.(COM|NET|ORG|CO|IO|TV|US)\b/gi

// The names to look a statement line up by, in order: the cleaned
// description and the part before an asterisk ("NAME-CHEAP.COM* LV0I6X")
// as they are, then each with a dropped apostrophe restored, its store
// number and location cut, and a web ending removed. Each is looked up as a
// whole merchant name or alias (or one followed by more words), never as a
// fragment, so a name that only contains a chain's name doesn't match it.
export function descriptorNames(description: string): string[] {
  const cleaned = cleanDescriptor(description)
  const head = cleaned.split('*')[0]?.trim() ?? ''
  const bases = [cleaned, head].filter((b) => b !== '')
  const variants = bases.flatMap((base) => {
    const joined = base.replace(SPLIT_POSSESSIVE, '$1S')
    const cut = joined.replace(STORE_NUMBER_ON, '')
    return [joined, cut, cut.replace(WEB_SUFFIX, '$1')]
  })
  return [...new Set([...bases, ...variants])].filter((n) => n !== '')
}
