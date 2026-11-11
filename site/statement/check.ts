// What the statement check does with a file, apart from showing it: refuse
// what it mustn't open, read the columns the CLI's parsers read, and run
// the CLI's own analysis on the visitor's cards. Everything stays in memory.
import {
  analyzeStatement,
  resolveLine,
  type CardLine,
  type StatementAnalysis,
} from '../../src/import/analyze.ts'
import { AMEX_COLUMNS } from '../../src/import/amex.ts'
import { CHASE_COLUMNS } from '../../src/import/chase.ts'
import { parseCsv } from '../../src/import/csv.ts'
import {
  parseStatement,
  type Issuer,
  type StatementLine,
} from '../../src/import/statement.ts'
import { HALF_CENT } from '../../src/engine/compare.ts'
import { daysBetween } from '../../src/engine/periods.ts'
import { roundCents, shortDate } from '../../src/engine/text.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import {
  WalletSchema,
  type Wallet,
  type WalletCard,
} from '../../src/schema/wallet.ts'

// Far more than a year of activity; a bigger file isn't an activity download.
export const MAX_BYTES = 5_000_000

export const PDF_REFUSED =
  "That's a PDF, so earnrate didn't open it. A PDF statement can carry your full card number (Chase's print it on the payment slip), and earnrate never handles one. Download your card's activity as a CSV file instead."

export const OTHER_REFUSED =
  "earnrate reads only CSV activity files from American Express and Chase, so it didn't open this one. Download your card's activity again and choose CSV."

export const TOO_BIG_REFUSED =
  "That file is far bigger than an activity download, so earnrate didn't open it."

export const UNKNOWN_FORMAT =
  "This CSV isn't an American Express or Chase activity download: its columns aren't the ones those files have, so none of it was used."

// Decided from the name and type alone, before anything in the file is read.
export function refusal(file: {
  name: string
  type: string
  size: number
}): string | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf')
    return PDF_REFUSED
  if (!name.endsWith('.csv') && file.type !== 'text/csv') return OTHER_REFUSED
  if (file.size > MAX_BYTES) return TOO_BIG_REFUSED
  return null
}

export type ReadFile = {
  issuer: Issuer
  lines: StatementLine[] // purchases and refunds, as the CLI reads them
  rows: number // every row after the header
  read: string[] // the columns read, in the file's own order and names
  ignored: string[] // the file's other columns, never read
}

const READ_COLUMNS: Record<Issuer, string[]> = {
  amex: AMEX_COLUMNS,
  chase: CHASE_COLUMNS,
}

export function readStatement(text: string): ReadFile | string {
  let statement
  try {
    statement = parseStatement(text)
  } catch {
    return UNKNOWN_FORMAT
  }
  const [header = [], ...rows] = parseCsv(text)
  const wanted = READ_COLUMNS[statement.issuer]
  const named = header.map((h) => h.trim()).filter((h) => h !== '')
  return {
    issuer: statement.issuer,
    lines: statement.lines,
    rows: rows.length,
    read: named.filter((h) => wanted.includes(h)),
    ignored: named.filter((h) => !wanted.includes(h)),
  }
}

// What each parser leaves out besides the columns it doesn't read.
export const LEFT_OUT: Record<Issuer, string> = {
  amex: 'payments to the card, fees and adjustments, and any row without a date, description or amount',
  chase:
    'payments, fees and adjustments (such as statement credits and redemptions), and any row without a date, description or amount',
}

const held = (id: string): WalletCard => ({ id, cap_usage: {}, activated: [] })

// The saved wallet as the app would read it, or null when there's none or
// it can't be read; its cards that earnrate no longer knows are dropped.
export function savedCards(
  catalog: Catalog,
  raw: Partial<Wallet> | null,
): Wallet | null {
  if (raw === null) return null
  const parsed = WalletSchema.safeParse(raw)
  if (!parsed.success) return null
  const known = new Set(catalog.cards.map((c) => c.id))
  const cards = parsed.data.cards.filter((c) => known.has(c.id))
  return cards.length === 0 ? null : { ...parsed.data, cards }
}

// The cards the check compares: the saved wallet, or the cards tapped on
// the page, plus each file's card. Nothing here is saved.
export function checkWallet(
  saved: Wallet | null,
  picked: string[],
  fileCards: string[],
): Wallet {
  const base: Wallet = saved ?? {
    valuations: {},
    memberships: [],
    cards: picked.map(held),
  }
  const have = new Set(base.cards.map((c) => c.id))
  const more = [...new Set(fileCards)].filter((id) => !have.has(id))
  return { ...base, cards: [...base.cards, ...more.map(held)] }
}

export type UnknownStore = {
  name: string
  count: number
  spend: number
  category: string | null // what it was counted as, from the statement
  issuerCategory: string | null
}

export type Check = {
  analysis: StatementAnalysis
  unknown: UnknownStore[]
}

// The wallet as of before the file's first purchase: its cards, picks,
// activations, memberships and point values, without the cap totals,
// welcome-bonus progress, spend-bonus totals and credits used that a saved
// wallet holds for today, which may already include these purchases. The
// CLI's import keeps them, since --apply books on top of them.
export function cleanSlate(wallet: Wallet): Wallet {
  return {
    ...wallet,
    cards: wallet.cards.map(
      ({
        bonus: _bonus,
        milestone_usage: _milestones,
        credit_usage: _credits,
        ...card
      }) => ({ ...card, cap_usage: {} }),
    ),
  }
}

export function runCheck(
  catalog: Catalog,
  wallet: Wallet,
  entries: CardLine[],
  today: string,
): Check {
  const analysis = analyzeStatement(catalog, cleanSlate(wallet), entries, today)
  const unknown = new Map<string, UnknownStore>()
  for (const { line } of entries) {
    if (line.amount <= 0) continue
    const { name, merchant, known } = resolveLine(catalog, line)
    if (known.source !== 'none') continue
    const store = unknown.get(name) ?? {
      name,
      count: 0,
      spend: 0,
      category: merchant.source === 'caller' ? merchant.category : null,
      issuerCategory: line.issuerCategory,
    }
    store.count++
    store.spend = roundCents(store.spend + line.amount)
    unknown.set(name, store)
  }
  return {
    analysis,
    unknown: [...unknown.values()].sort((a, b) => b.spend - a.spend),
  }
}

// Files covering fewer days than this say too little about a year.
export const PACE_MIN_DAYS = 28

// The difference over a year at the files' pace, or null when they cover
// too few days or there's no difference.
export function yearlyPace(analysis: StatementAnalysis): number | null {
  if (analysis.from === '' || analysis.to === '') return null
  const days = daysBetween(analysis.from, analysis.to) + 1
  const gain = analysis.best - analysis.earned
  if (days < PACE_MIN_DAYS || gain <= HALF_CENT) return null
  return roundCents((gain * 365) / days)
}

// The gain chart needs enough purchases to say something, and more than one
// card to switch to (one bar would only repeat the difference).
export const GAIN_CHART_MIN_PURCHASES = 10

export type CardGain = {
  cardId: string
  gain: number
  stores: number
  purchases: number
}

// Where the difference comes from, by the card that would have earned more.
export function gainByCard(analysis: StatementAnalysis): CardGain[] | null {
  const byCard = new Map<
    string,
    { gain: number; stores: Set<string>; purchases: number }
  >()
  for (const m of analysis.missed) {
    const entry = byCard.get(m.bestCardId) ?? {
      gain: 0,
      stores: new Set<string>(),
      purchases: 0,
    }
    entry.gain += m.best - m.earned
    entry.stores.add(m.merchant)
    entry.purchases += m.count
    byCard.set(m.bestCardId, entry)
  }
  const gains = [...byCard]
    .map(([cardId, g]) => ({
      cardId,
      gain: roundCents(g.gain),
      stores: g.stores.size,
      purchases: g.purchases,
    }))
    .sort((a, b) => b.gain - a.gain)
  return analysis.purchases >= GAIN_CHART_MIN_PURCHASES && gains.length >= 2
    ? gains
    : null
}

// "Oct 2 – Nov 1, 2026", or with both years when they differ.
export function dateRange(from: string, to: string): string {
  const start = shortDate(from)
  const end = shortDate(to)
  if (from === to) return end
  return from.slice(0, 4) === to.slice(0, 4)
    ? `${start.replace(/, \d{4}$/, '')} – ${end}`
    : `${start} – ${end}`
}
