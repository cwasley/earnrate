import { rm } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { CLI_NAME, MISSED_ENV_VAR } from '../brand.ts'
import { loadCatalog } from '../data/load.ts'
import { categoryPhrase, shortDate } from '../engine/text.ts'
import { missedPath, readMissed } from '../merchants/missed.ts'
import { displayPath, USAGE_ERROR, type Io } from './run.ts'

const MISSED_HELP = `Usage: ${CLI_NAME} missed [--clear]

Stores earnrate didn't recognize when you asked about them here (the command
line or the local MCP server), most asked about first. They're kept only on
this computer. To suggest one for earnrate's data, open an issue at
https://github.com/cwasley/earnrate/issues.

Set ${MISSED_ENV_VAR}=off to stop keeping the list, or to a path to keep it
somewhere else.

Options:
  --clear      Delete the list.
  -h, --help   Show this help.
`

export async function runMissed(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        clear: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n${MISSED_HELP}`)
    return USAGE_ERROR
  }
  if (parsed.values.help) {
    io.stdout(MISSED_HELP)
    return 0
  }
  const file = missedPath(io.env)
  if (file === null) {
    io.stdout(`The list is off (${MISSED_ENV_VAR}=off).\n`)
    return 0
  }
  if (parsed.values.clear) {
    await rm(file, { force: true })
    io.stdout(`Deleted ${displayPath(file)}.\n`)
    return 0
  }
  const missed = await readMissed(file)
  if (missed.length === 0) {
    io.stdout('No unrecognized stores yet.\n')
    return 0
  }
  const catalog = await loadCatalog()
  const lines = missed
    .sort((a, b) => b.count - a.count || b.last_seen.localeCompare(a.last_seen))
    .map((m) => {
      const kinds = m.categories.map((c) => categoryPhrase(catalog, c))
      return `- ${m.name}: ${String(m.count)} ${m.count === 1 ? 'time' : 'times'}, last ${shortDate(m.last_seen)}${kinds.length === 0 ? '' : ` (taken as ${kinds.join(', ')})`}`
    })
  io.stdout(
    `${lines.join('\n')}\n\nKept in ${displayPath(file)}. Suggest additions at https://github.com/cwasley/earnrate/issues.\n`,
  )
  return 0
}
