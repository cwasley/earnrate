import { parseArgs } from 'node:util'
import { CLI_NAME } from '../brand.ts'
import { loadCatalog, loadWallet, walletPath } from '../data/load.ts'
import {
  addCard,
  removeCard,
  setMemberships,
  updateCard,
  type CardInput,
  type SetupResult,
} from '../data/wallet-setup.ts'
import { knownMemberships, searchCards } from '../engine/setup.ts'
import type { Wallet } from '../schema/wallet.ts'
import { formatCardInfo, formatNotes } from './cards.ts'
import { displayPath, RUNTIME_ERROR, USAGE_ERROR, type Io } from './run.ts'

const CARD_OPTIONS = `Options:
  --label <text>             How the card appears at checkout, e.g. "Amex Gold".
  --pick <choice>=<options>  Bonus categories you picked for this period, e.g.
                             --pick five-percent=fast-food,movie-theaters.
                             Repeat for each choice.
  --anniversary <MM-DD>      Account anniversary, for caps that reset on it.
  --activated <rules>        Rules you've activated with the issuer, comma
                             separated. Replaces the current list.
  -h, --help                 Show this help.`

export const WALLET_HELP = {
  cards: `Usage: ${CLI_NAME} cards [search words]

Finds cards in earnrate's catalog by name or issuer, with the id to add them
by and anything they need set up. With no words, lists every card.

Examples:
  ${CLI_NAME} cards sapphire
  ${CLI_NAME} cards bofa
`,
  add: `Usage: ${CLI_NAME} add <card-id> [options]

Adds a card you hold to your wallet, creating the wallet if needed. Find the
id with \`${CLI_NAME} cards\`.

${CARD_OPTIONS}
`,
  update: `Usage: ${CLI_NAME} update <card-id> [options]

Changes a card in your wallet: picks for this period, label, anniversary or
activations. Picks for the current period are merged with ones already set.

${CARD_OPTIONS}
`,
  remove: `Usage: ${CLI_NAME} remove <card-id>

Removes a card from your wallet, with its tracked cap usage.
`,
  memberships: `Usage: ${CLI_NAME} memberships [<membership>...] [--none]

With no arguments, shows your memberships and the ones earnrate knows. With
names, replaces the list. --none clears it.
`,
}

type Command = keyof typeof WALLET_HELP

const HINTS: Record<string, (id: string) => string> = {
  pick: (id) => `${CLI_NAME} update ${id} --pick <choice>=<option>,...`,
  membership: () => `${CLI_NAME} memberships <membership>...`,
  activation: (id) => `${CLI_NAME} update ${id} --activated <rule>,...`,
  anniversary: (id) => `${CLI_NAME} update ${id} --anniversary MM-DD`,
}

function parsePicks(values: string[]): Record<string, string[]> | string {
  const picks: Record<string, string[]> = {}
  for (const v of values) {
    const [choice, options] = v.split('=', 2)
    const ids = (options ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o !== '')
    if (!choice || ids.length === 0) {
      return `"--pick ${v}" should look like --pick five-percent=fast-food,movie-theaters.`
    }
    picks[choice] = ids
  }
  return picks
}

async function heldWallet(io: Io): Promise<Wallet | null> {
  try {
    return await loadWallet(walletPath(io.env))
  } catch {
    return null
  }
}

function report(
  result: SetupResult,
  message: string,
  cardId: string | null,
  io: Io,
): number {
  if (!result.ok) {
    io.stderr(`${result.error}\n`)
    return RUNTIME_ERROR
  }
  const lines = [message]
  if (cardId !== null) {
    lines.push(formatNotes(result.notes))
    const hints = [...new Set(result.notes.map((n) => n.kind))]
      .map((kind) => HINTS[kind]?.(cardId))
      .filter((h) => h !== undefined)
    if (hints.length > 0)
      lines.push(`Set them with:\n${hints.map((h) => `  ${h}`).join('\n')}`)
  }
  io.stdout(`${lines.join('\n')}\n`)
  return 0
}

export async function runWalletCommand(
  command: Command,
  argv: string[],
  io: Io,
): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        label: { type: 'string' },
        pick: { type: 'string', multiple: true },
        anniversary: { type: 'string' },
        activated: { type: 'string' },
        none: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    io.stderr(
      `${e instanceof Error ? e.message : String(e)}\nRun ${CLI_NAME} ${command} --help for usage.\n`,
    )
    return USAGE_ERROR
  }
  const { values, positionals } = parsed
  if (values.help) {
    io.stdout(WALLET_HELP[command])
    return 0
  }
  const usage = (message: string) => {
    io.stderr(`${message}\nRun ${CLI_NAME} ${command} --help for usage.\n`)
    return USAGE_ERROR
  }
  const cardOptionsGiven =
    values.label !== undefined ||
    values.pick !== undefined ||
    values.anniversary !== undefined ||
    values.activated !== undefined
  if (command !== 'add' && command !== 'update' && cardOptionsGiven) {
    return usage(`${CLI_NAME} ${command} doesn't take card options.`)
  }
  if (command !== 'memberships' && values.none) {
    return usage('--none is only for memberships.')
  }

  const catalog = await loadCatalog()
  const file = walletPath(io.env)
  const where = displayPath(file)

  if (command === 'cards') {
    const query = positionals.join(' ')
    const result = searchCards(catalog, query, await heldWallet(io), io.today)
    if (result.cards.length === 0) {
      io.stderr(
        `No card matches "${query}". Run ${CLI_NAME} cards with no words to list all ${String(catalog.cards.length)}.\n`,
      )
      return RUNTIME_ERROR
    }
    const header = result.exact ? '' : 'No card matches every word. Closest:\n'
    io.stdout(`${header}${result.cards.map(formatCardInfo).join('\n')}\n`)
    return 0
  }

  if (command === 'memberships') {
    if (positionals.length === 0 && !values.none) {
      const held = await heldWallet(io)
      io.stdout(
        `Yours: ${held && held.memberships.length > 0 ? held.memberships.join(', ') : 'none'}\nKnown: ${knownMemberships(catalog).join(', ')}\n`,
      )
      return 0
    }
    if (positionals.length > 0 && values.none) {
      return usage('Give memberships or --none, not both.')
    }
    const list = values.none ? [] : positionals
    return report(
      await setMemberships(file, catalog, list),
      list.length > 0
        ? `Memberships set to ${list.join(', ')} in ${where}.`
        : `Memberships cleared in ${where}.`,
      null,
      io,
    )
  }

  if (positionals.length !== 1) {
    return usage('Give one card id.')
  }
  const id = positionals[0] ?? ''
  const name = catalog.cards.find((c) => c.id === id)?.name ?? id

  if (command === 'remove') {
    return report(
      await removeCard(file, catalog, id),
      `Removed ${name} from ${where}.`,
      null,
      io,
    )
  }

  const input: CardInput = { id }
  if (values.label !== undefined) input.checkoutLabel = values.label
  if (values.anniversary !== undefined) input.anniversary = values.anniversary
  if (values.activated !== undefined) {
    input.activated = values.activated
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r !== '')
  }
  if (values.pick !== undefined) {
    const picks = parsePicks(values.pick)
    if (typeof picks === 'string') return usage(picks)
    input.picks = picks
  }

  if (command === 'add') {
    const result = await addCard(file, catalog, input, io.today)
    return report(
      result,
      `Added ${name} to ${where}${result.ok && result.created ? ' (a new wallet)' : ''}.`,
      id,
      io,
    )
  }
  return report(
    await updateCard(file, catalog, input, io.today),
    `Updated ${name} in ${where}.`,
    id,
    io,
  )
}
