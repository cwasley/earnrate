import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { CLI_NAME } from '../brand.ts'
import { walletProblems } from '../data/integrity.ts'
import { loadCatalog, walletPath, type Catalog } from '../data/load.ts'
import { writeBonusSpent, writeCapBooking } from '../data/wallet-write.ts'
import { isValuationProfile, withValuationProfile } from '../engine/profiles.ts'
import { cardValuation } from '../engine/valuation.ts'
import {
  analyzeStatement,
  type CardLine,
  type RecordKind,
  type StatementAnalysis,
} from '../import/analyze.ts'
import { parseStatement } from '../import/statement.ts'
import type { Wallet } from '../schema/wallet.ts'
import {
  displayPath,
  readWallet,
  RUNTIME_ERROR,
  USAGE_ERROR,
  type Io,
} from './run.ts'

export const IMPORT_HELP = `Usage: ${CLI_NAME} import <statement.csv> --card <card-id> [--apply]
       ${CLI_NAME} import <statement.csv>:<card-id> [<statement.csv>:<card-id> ...]

Reads card statements (Amex and Chase activity CSVs) and reports:
  - what the same purchases would have earned on earnrate's picks
  - where the issuer coded a merchant differently than earnrate assumes
  - the cap usage it would record for the current period

Name several statements, each with its card, to see one report across them.

Nothing is written unless you pass --apply, and then only cap totals plus a
fingerprint of each recorded purchase, so importing twice never counts twice.
The statements themselves are never stored.

Options:
  --card <id>            The card a statement is for, as in your wallet.
  --apply                Record cap usage for the current period.
  --valuation <profile>  flat or points-heavy, instead of your wallet's values.
  -h, --help             Show this help.
`

const ISSUER_NAMES = { amex: 'an Amex', chase: 'a Chase' }

const LedgerSchema = z.strictObject({
  version: z.literal(1),
  // sha256 of card, date, amount and description. Not reversible.
  recorded: z.array(z.string()),
})

// Caps and welcome bonuses are recorded separately, so a purchase imported
// for its cap still counts toward a bonus added to the wallet later.
const fingerprint = ({ cardId, line }: CardLine, kind: RecordKind = 'cap') =>
  createHash('sha256')
    .update(
      `${kind === 'bonus' ? 'bonus|' : ''}${cardId}|${line.date}|${String(line.amount)}|${line.description}`,
    )
    .digest('hex')

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// "statement.csv:chase-sapphire-preferred" names the card inline.
function splitTarget(arg: string): { file: string; cardId: string | null } {
  const m = /^(.+):([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(arg)
  return m?.[1] && m[2]
    ? { file: m[1], cardId: m[2] }
    : { file: arg, cardId: null }
}

function valuationNote(
  catalog: Catalog,
  wallet: Wallet,
  cardIds: string[],
  profile: string | undefined,
): string {
  const values = new Map<string, number>()
  for (const id of cardIds) {
    const card = catalog.cards.find((c) => c.id === id)
    if (!card) continue
    const v = cardValuation(catalog, wallet, card)
    if (v.currency !== 'cash') values.set(v.currency, v.centsPerUnit)
  }
  if (values.size === 0) return 'Cash back counted as cash.'
  const parts = [...values].map(
    ([id, cents]) =>
      `${String(cents)}¢ for ${catalog.currencies.find((c) => c.id === id)?.name ?? id}`,
  )
  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`
      : (parts[0] ?? '')
  return `Points valued at ${list}${profile ? ` (the ${profile} profile)` : ', as in your wallet'}.`
}

function formatAnalysis(
  a: StatementAnalysis,
  labelOf: (cardId: string) => string,
  valuation: string,
  categoryName: (id: string) => string,
): string {
  const several = a.byCard.length > 1
  const names = a.byCard.map((t) => labelOf(t.cardId))
  const out = [
    several
      ? `${String(a.byCard.length)} statements (${names.join(', ')}) · ${a.from} to ${a.to}`
      : `${names[0] ?? ''} statement · ${a.from} to ${a.to}`,
    `${String(a.purchases)} purchases, ${usd(a.spend)}${a.refunds > 0 ? ` (refunds and credits: ${usd(a.refunds)})` : ''}`,
    '',
  ]
  if (several) {
    out.push(`Earned on the cards you used: about ${usd(a.earned)}`)
    const width = Math.max(...names.map((n) => n.length))
    for (const t of a.byCard) {
      out.push(
        `  ${labelOf(t.cardId).padEnd(width)}  ${String(t.purchases).padStart(4)} × ${usd(t.spend).padStart(11)}  ${usd(t.earned)}`,
      )
    }
  } else {
    out.push(`Earned on ${names[0] ?? ''}: about ${usd(a.earned)}`)
  }
  out.push(
    `With earnrate's picks: about ${usd(a.best)} (+${usd(a.best - a.earned)})`,
    valuation,
  )
  if (a.missed.length > 0) {
    out.push('', 'Where another card would have earned more:')
    const shown = a.missed.slice(0, 10)
    const name = (m: (typeof shown)[number]) =>
      `${m.merchant}${m.categoryFromStatement ? '*' : ''}`
    const width = Math.min(28, Math.max(...shown.map((m) => name(m).length)))
    const cardWidth = Math.max(
      ...shown.map((m) => labelOf(m.usedCardId).length),
    )
    for (const m of shown) {
      const used = several ? `${labelOf(m.usedCardId).padEnd(cardWidth)}  ` : ''
      out.push(
        `  ${name(m).slice(0, width).padEnd(width)}  ${used}${String(m.count).padStart(3)} × ${usd(m.spend).padStart(10)}  ${usd(m.earned)} → ${m.bestCard} ${usd(m.best)}  (+${usd(m.best - m.earned)})`,
      )
    }
    if (a.missed.length > 10)
      out.push(`  …and ${String(a.missed.length - 10)} more merchants`)
    if (shown.some((m) => m.categoryFromStatement))
      out.push(
        "  * earnrate doesn't know this merchant, so it used the statement's category. Another issuer may code it differently.",
      )
  }
  if (a.coding.length > 0) {
    out.push(
      '',
      'Where the issuer coded a merchant differently than earnrate assumes:',
    )
    for (const c of a.coding) {
      out.push(
        `  ${c.merchant}: earnrate assumes ${categoryName(c.earnrateCategory)}; the statement says ${c.issuerCategory} (${String(c.count)}×)`,
      )
    }
  }
  out.push('')
  if (a.bookings.length > 0) {
    const last = new Map<string, number>()
    for (const { cardId, booking } of a.bookings)
      last.set(
        several ? `${labelOf(cardId)} ${booking.capKey}` : booking.capKey,
        booking.after,
      )
    out.push(
      `Cap usage for the current period: ${[...last].map(([k, v]) => `${k} ${usd(v)}`).join(', ')}.`,
    )
  } else if (a.alreadyImported > 0) {
    out.push(
      `Caps: nothing new to record. ${String(a.alreadyImported)} purchase(s) were recorded by an earlier import.`,
    )
  } else if (a.outsideCurrentPeriod > 0) {
    out.push(
      'Caps: nothing to record. These capped purchases are from an earlier period, and your caps track the current one.',
    )
  } else {
    out.push('Caps: nothing new to record.')
  }
  for (const b of a.bonuses) {
    out.push(
      `Welcome bonus on ${labelOf(b.cardId)}: ${usd(b.before)} → ${usd(b.after)} of ${usd(b.spend)}${b.deadline ? ` by ${b.deadline}` : ''}.`,
    )
  }
  return `${out.join('\n')}\n`
}

export async function runImport(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        card: { type: 'string' },
        apply: { type: 'boolean' },
        valuation: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n${IMPORT_HELP}`)
    return USAGE_ERROR
  }
  const { values, positionals } = parsed
  if (values.help) {
    io.stdout(IMPORT_HELP)
    return 0
  }
  const targets = positionals.map(splitTarget).map((t) => ({
    file: t.file,
    cardId: t.cardId ?? values.card ?? null,
  }))
  if (targets.length === 0 || targets.some((t) => t.cardId === null)) {
    io.stderr(
      `Name a statement file and its card, with --card or as file.csv:card-id.\n${IMPORT_HELP}`,
    )
    return USAGE_ERROR
  }
  if (values.valuation !== undefined && !isValuationProfile(values.valuation)) {
    io.stderr(
      `Unknown valuation "${values.valuation}". Use flat or points-heavy.\n`,
    )
    return USAGE_ERROR
  }

  const walletFile = walletPath(io.env)
  const loaded = await readWallet(walletFile, io)
  if (!loaded) return RUNTIME_ERROR
  const catalog = await loadCatalog()
  const problems = walletProblems(loaded, catalog)
  if (problems.length > 0) {
    io.stderr(
      `Your wallet at ${displayPath(walletFile)} has problems:\n${problems.map((p) => `  - ${p}\n`).join('')}`,
    )
    return RUNTIME_ERROR
  }

  const entries: CardLine[] = []
  for (const { file, cardId } of targets) {
    const card = catalog.cards.find((c) => c.id === cardId)
    if (!card || !loaded.cards.some((c) => c.id === card.id)) {
      io.stderr(
        `"${cardId ?? ''}" isn't in your wallet. Cards: ${loaded.cards.map((c) => c.id).join(', ')}.\n`,
      )
      return USAGE_ERROR
    }
    let statement
    try {
      statement = parseStatement(await readFile(file, 'utf8'))
    } catch (e) {
      io.stderr(
        `Couldn't read ${displayPath(path.resolve(file))}: ${e instanceof Error ? e.message : String(e)}\n`,
      )
      return RUNTIME_ERROR
    }
    if (statement.issuer !== card.issuer) {
      io.stderr(
        `${displayPath(path.resolve(file))} looks like ${ISSUER_NAMES[statement.issuer]} statement, but you named ${card.name}.\n`,
      )
      return USAGE_ERROR
    }
    for (const line of statement.lines) entries.push({ cardId: card.id, line })
  }

  const ledgerFile = path.join(path.dirname(walletFile), 'imported.json')
  let recorded = new Set<string>()
  try {
    recorded = new Set(
      LedgerSchema.parse(JSON.parse(await readFile(ledgerFile, 'utf8')))
        .recorded,
    )
  } catch (e) {
    if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) {
      io.stderr(
        `Couldn't read ${displayPath(ledgerFile)}; not importing so nothing gets counted twice.\n`,
      )
      return RUNTIME_ERROR
    }
  }

  const wallet =
    values.valuation && isValuationProfile(values.valuation)
      ? withValuationProfile(loaded, values.valuation)
      : loaded
  const analysis = analyzeStatement(
    catalog,
    wallet,
    entries,
    io.today,
    (e, kind) => recorded.has(fingerprint(e, kind)),
  )
  const labelOf = (id: string) =>
    loaded.cards.find((c) => c.id === id)?.checkout_label ??
    catalog.cards.find((c) => c.id === id)?.name ??
    id
  const categoryName = (id: string) =>
    id === 'other'
      ? 'no bonus category'
      : (catalog.categories.find((c) => c.id === id)?.name ?? id).toLowerCase()
  const valuation = valuationNote(
    catalog,
    wallet,
    [
      ...analysis.byCard.map((t) => t.cardId),
      ...analysis.missed.slice(0, 10).map((m) => m.bestCardId),
    ],
    values.valuation,
  )
  io.stdout(formatAnalysis(analysis, labelOf, valuation, categoryName))

  const bonusEntries = analysis.bonuses.flatMap((b) => b.entries)
  const toRecord = [
    ...(analysis.bookings.length > 0
      ? [`${String(analysis.bookings.length)} purchase(s) against your caps`]
      : []),
    ...(bonusEntries.length > 0
      ? [`${String(bonusEntries.length)} toward welcome bonuses`]
      : []),
  ]
  if (!values.apply || toRecord.length === 0) {
    io.stdout(
      values.apply || toRecord.length === 0
        ? 'Nothing was written.\n'
        : `Nothing was written. Run again with --apply to record ${toRecord.join(' and ')}.\n`,
    )
    return 0
  }
  for (const { booking } of analysis.bookings) {
    await writeCapBooking(walletFile, booking)
  }
  for (const b of analysis.bonuses) {
    await writeBonusSpent(walletFile, b.cardId, b.after)
  }
  for (const entry of analysis.bookings) recorded.add(fingerprint(entry))
  for (const entry of bonusEntries) recorded.add(fingerprint(entry, 'bonus'))
  await mkdir(path.dirname(ledgerFile), { recursive: true })
  const tmp = `${ledgerFile}.${String(process.pid)}.tmp`
  await writeFile(
    tmp,
    `${JSON.stringify({ version: 1, recorded: [...recorded] }, null, 2)}\n`,
  )
  await rename(tmp, ledgerFile)
  io.stdout(
    `Recorded ${toRecord.join(' and ')} in ${displayPath(walletFile)}.\n`,
  )
  return 0
}
