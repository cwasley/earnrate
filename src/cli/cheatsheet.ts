import { parseArgs } from 'node:util'
import { CLI_NAME } from '../brand.ts'
import { walletProblems } from '../data/integrity.ts'
import { loadCatalog, walletPath } from '../data/load.ts'
import { cheatSheet, type CheatSheet } from '../engine/cheat-sheet.ts'
import { isValuationProfile, withValuationProfile } from '../engine/profiles.ts'
import {
  displayPath,
  readWallet,
  RUNTIME_ERROR,
  USAGE_ERROR,
  type Io,
} from './run.ts'

export const CHEATSHEET_HELP = `Usage: ${CLI_NAME} cheatsheet [options]

The card in your wallet to use for each everyday kind of purchase this
quarter, with your caps, picks and activations as they are now.

Options:
  --valuation <profile>  flat or points-heavy, instead of your wallet's values.
  --date <YYYY-MM-DD>    The day to check. Default: today.
  --json                 Print the cheat sheet as JSON.
  -h, --help             Show this help.
`

const pct = (n: number) => `${String(Number(n.toFixed(2)))}%`

export function formatCheatSheet(sheet: CheatSheet): string {
  const labelWidth = Math.max(...sheet.rows.map((r) => r.label.length))
  const cardWidth = Math.max(
    ...sheet.rows.map((r) => (r.cardName ?? 'none of your cards').length),
  )
  const lines = [`Your cheat sheet for ${sheet.quarter}`, '']
  for (const row of sheet.rows) {
    lines.push(
      `  ${row.label.padEnd(labelWidth)}  ${(row.cardName ?? 'none of your cards').padEnd(cardWidth)}  ${row.effectiveReturnPct === null ? '' : pct(row.effectiveReturnPct).padStart(5)}`.trimEnd(),
    )
    if (row.note) lines.push(`  ${' '.repeat(labelWidth)}  ! ${row.note}`)
  }
  if (sheet.notes.length > 0) lines.push('', ...sheet.notes)
  return `${lines.join('\n')}\n`
}

export async function runCheatSheet(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        valuation: { type: 'string' },
        date: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    io.stderr(
      `${e instanceof Error ? e.message : String(e)}\n${CHEATSHEET_HELP}`,
    )
    return USAGE_ERROR
  }
  const { values } = parsed
  if (values.help) {
    io.stdout(CHEATSHEET_HELP)
    return 0
  }
  if (values.valuation !== undefined && !isValuationProfile(values.valuation)) {
    io.stderr(
      `Unknown valuation "${values.valuation}". Use flat or points-heavy.\n`,
    )
    return USAGE_ERROR
  }
  if (values.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
    io.stderr(`"${values.date}" isn't a date. Use YYYY-MM-DD.\n`)
    return USAGE_ERROR
  }
  const file = walletPath(io.env)
  const loaded = await readWallet(file, io)
  if (!loaded) return RUNTIME_ERROR
  const catalog = await loadCatalog()
  const problems = walletProblems(loaded, catalog)
  if (problems.length > 0) {
    io.stderr(
      `Your wallet at ${displayPath(file)} has problems:\n${problems.map((p) => `  - ${p}\n`).join('')}`,
    )
    return RUNTIME_ERROR
  }
  const wallet =
    values.valuation !== undefined && isValuationProfile(values.valuation)
      ? withValuationProfile(loaded, values.valuation)
      : loaded
  const sheet = cheatSheet(catalog, wallet, values.date ?? io.today)
  io.stdout(
    values.json
      ? `${JSON.stringify(sheet, null, 2)}\n`
      : formatCheatSheet(sheet),
  )
  return 0
}
