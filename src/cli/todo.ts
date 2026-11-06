import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { CLI_NAME } from '../brand.ts'
import { loadCatalog, walletPath } from '../data/load.ts'
import { checklist, checklistCalendar } from '../engine/checklist.ts'
import { cardText } from '../format/card-text.ts'
import { dateProblem } from './args.ts'
import {
  displayPath,
  readWallet,
  RUNTIME_ERROR,
  USAGE_ERROR,
  type Io,
} from './run.ts'

const TODO_HELP = `Usage: ${CLI_NAME} todo [--ics <file>] [--date <YYYY-MM-DD>]

What your saved cards need this period, soonest first: bonuses to activate,
categories to pick, spending caps running low, welcome bonuses to finish,
spend bonuses you're close to, statement credits to enroll in or use, first-year
rates ending, and rotating categories the issuer hasn't posted yet.

Options:
  --ics <file>          Also write the dated items as a calendar file to import
                        into your calendar app, with reminders two days before.
  --date <YYYY-MM-DD>   The day to check. Default: today.
  -h, --help            Show this help.
`

export async function runTodo(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        ics: { type: 'string' },
        date: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n${TODO_HELP}`)
    return USAGE_ERROR
  }
  const { values } = parsed
  if (values.help) {
    io.stdout(TODO_HELP)
    return 0
  }
  const problem = dateProblem(values.date)
  if (problem !== null) {
    io.stderr(`${problem}\n`)
    return USAGE_ERROR
  }
  const catalog = await loadCatalog()
  const wallet = await readWallet(walletPath(io.env), io)
  if (wallet === null) return RUNTIME_ERROR
  const today = values.date ?? io.today
  const items = checklist(
    catalog,
    wallet,
    today,
    undefined,
    cardText(catalog).shortName,
  )
  io.stdout(
    items.length === 0
      ? 'Nothing to do: every bonus is activated, every pick is made, and no cap or welcome bonus needs attention.\n'
      : `${items.map((i) => `- ${i.text}`).join('\n')}\n`,
  )
  if (values.ics !== undefined) {
    const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`
    await writeFile(values.ics, checklistCalendar(items, stamp))
    io.stdout(
      `Wrote ${displayPath(values.ics)}; open it to add the dates to your calendar.\n`,
    )
  }
  return 0
}
