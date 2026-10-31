import { parseArgs } from 'node:util'
import { CLI_NAME } from '../brand.ts'
import { loadCatalog, walletPath } from '../data/load.ts'
import {
  catalogCheatSheet,
  cheatSheet,
  type CheatSheet,
} from '../engine/cheat-sheet.ts'
import { ALL_PERSONAL_CARDS } from '../engine/explore.ts'
import {
  isValuationProfile,
  VALUATION_PROFILES,
  withValuationProfile,
} from '../engine/profiles.ts'
import {
  cardsToUse,
  NO_WALLET_HINT,
  RUNTIME_ERROR,
  USAGE_ERROR,
  type Io,
} from './run.ts'

export const CHEATSHEET_HELP = `Usage: ${CLI_NAME} cheatsheet [options]

The card to use for each everyday kind of purchase this quarter: from your
wallet (with your caps, picks and activations as they are now), from cards you
name with --cards, or else from every card earnrate knows.

Options:
  --cards <ids>          Use these cards instead of your wallet, comma separated.
  --member <name>        A membership you have, like amazon-prime. Repeatable.
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
  const lines = [
    sheet.scope === 'wallet'
      ? `Your cheat sheet for ${sheet.quarter}`
      : `The best card for each kind of purchase, ${sheet.quarter}`,
    '',
  ]
  for (const row of sheet.rows) {
    lines.push(
      `  ${row.label.padEnd(labelWidth)}  ${(row.cardName ?? 'none of your cards').padEnd(cardWidth)}  ${row.effectiveReturnPct === null ? '' : pct(row.effectiveReturnPct).padStart(5)}`.trimEnd(),
    )
    if (row.note)
      lines.push(
        `  ${' '.repeat(labelWidth)}  ${sheet.scope === 'wallet' ? '! ' : ''}${row.note}`,
      )
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
        cards: { type: 'string' },
        member: { type: 'string', multiple: true },
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
  const loaded = await cardsToUse(walletPath(io.env), io, {
    cards: values.cards === undefined ? null : values.cards.split(','),
    members: values.member ?? [],
  })
  if (loaded === null) return RUNTIME_ERROR
  const catalog = await loadCatalog()
  const date = values.date ?? io.today
  if (loaded === 'none') {
    const sheet = catalogCheatSheet(catalog, date, {
      filters: ALL_PERSONAL_CARDS,
      memberships: values.member ?? [],
      valuations:
        values.valuation !== undefined && isValuationProfile(values.valuation)
          ? VALUATION_PROFILES[values.valuation]
          : {},
    })
    io.stdout(
      values.json
        ? `${JSON.stringify(sheet, null, 2)}\n`
        : `${formatCheatSheet(sheet)}\n${NO_WALLET_HINT}\n`,
    )
    return 0
  }
  const wallet =
    values.valuation !== undefined && isValuationProfile(values.valuation)
      ? withValuationProfile(loaded, values.valuation)
      : loaded
  const sheet = cheatSheet(catalog, wallet, date)
  io.stdout(
    values.json
      ? `${JSON.stringify(sheet, null, 2)}\n`
      : formatCheatSheet(sheet),
  )
  return 0
}
