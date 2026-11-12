// Whether a report string (a /rate#w= link's contents without the "w=")
// names only things earnrate lists, checked against codes alone so the
// Worker that stores short links carries no card data. It refuses what
// /rate's own reader (decodeReport in site/rate/link.ts) refuses;
// tests/site-reports.test.ts holds the two to the same answers.
import {
  MAX_CARDS,
  MAX_LINES,
  REPORT_MAX_LENGTH,
  spendOk,
} from './report-policy.ts'

// Built from the card data by scripts/build-report-codes.ts. A card's `p`
// lists each of its choices: how many may be picked and its options' codes;
// `c` its statement credits' and free nights' codes. A code two ids share
// in one kind is left out, as the page reads it as neither.
export type ReportCodes = {
  cards: Record<string, { p?: { n: number; o: string[] }[]; c?: string[] }>
  memberships: string[]
  currencies: string[]
  categories: string[]
  merchants: string[]
}

const CODE = /^[0-9a-z]{4}$/
const MARK = /^([pux])([0-9a-z]{4})$/
const VALUE = /^([0-9a-z]{4}):(\d{1,3}(?:\.\d{1,4})?)$/
const LINE = /^(\d{1,7})([com])([a-z0-9-]+)(?:\.([0-9a-z]{4}))?$/

const list = (s: string) => (s === '' ? [] : s.split(','))

const unique = (items: string[]) => new Set(items).size === items.length

export function checkReport(text: string, codes: ReportCodes): boolean {
  if (text.length > REPORT_MAX_LENGTH) return false
  const sections = text.split('/')
  const [version, cardPart = '', memberPart = '', valuePart = '', spendPart] =
    sections
  if (version !== '1' || sections.length > 5) return false
  const memberships = new Set(codes.memberships)
  const currencies = new Set(codes.currencies)
  const categories = new Set(codes.categories)
  const merchants = new Set(codes.merchants)

  const cards = list(cardPart)
  if (cards.length === 0 || cards.length > MAX_CARDS) return false
  const cardCodes: string[] = []
  for (const token of cards) {
    const [code = '', ...segments] = token.split('.')
    if (!CODE.test(code) || !Object.hasOwn(codes.cards, code)) return false
    const card = codes.cards[code] ?? {}
    cardCodes.push(code)
    const credits: string[] = []
    const picked = (card.p ?? []).map(() => [] as string[])
    for (const segment of segments) {
      const m = MARK.exec(segment)
      if (!m) return false
      const [, kind = '', mark = ''] = m
      if (kind !== 'p') {
        if (!(card.c ?? []).includes(mark) || credits.includes(mark))
          return false
        credits.push(mark)
        continue
      }
      const at = (card.p ?? []).findIndex((choice) => choice.o.includes(mark))
      const choice = card.p?.[at]
      const chosen = picked[at]
      if (!choice || !chosen) return false
      if (chosen.includes(mark) || chosen.length >= choice.n) return false
      chosen.push(mark)
    }
  }
  if (!unique(cardCodes)) return false

  const members = list(memberPart)
  if (!members.every((c) => memberships.has(c)) || !unique(members))
    return false

  const valued: string[] = []
  for (const token of list(valuePart)) {
    const m = VALUE.exec(token)
    if (!m) return false
    const cents = Number(m[2])
    if (!currencies.has(m[1] ?? '') || !(cents > 0 && cents <= 100))
      return false
    valued.push(m[1] ?? '')
  }
  if (!unique(valued)) return false

  if (spendPart === undefined) return true
  const lines = list(spendPart)
  if (lines.length === 0 || lines.length > MAX_LINES) return false
  return lines.every((token) => {
    const m = LINE.exec(token)
    if (!m) return false
    const [, amount = '', kind, ref = '', as] = m
    if (!spendOk(Number(amount))) return false
    if (kind !== 'm') return as === undefined && categories.has(ref)
    return merchants.has(ref) && (as === undefined || categories.has(as))
  })
}
