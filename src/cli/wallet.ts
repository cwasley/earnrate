import { parseArgs } from 'node:util'
import { CLI_NAME } from '../brand.ts'
import { FileWalletStore } from '../data/file-store.ts'
import { loadCatalog, loadWallet, walletPath } from '../data/load.ts'
import type { SetupResult } from '../data/store.ts'
import {
  isValuationProfile,
  profileText,
  VALUATION_PROFILES,
} from '../engine/profiles.ts'
import { cardDetails, DETAILS_LEFT_OUT } from '../engine/card-details.ts'
import { membershipName } from '../engine/memberships.ts'
import { issuerName } from '../format/card-text.ts'
import { knownMemberships, searchCards } from '../engine/setup.ts'
import { currencyChanges, type CardInput } from '../engine/wallet-change.ts'
import { formatCardInfo, formatNotes } from '../format/cards.ts'
import type { Wallet } from '../schema/wallet.ts'
import { displayPath, RUNTIME_ERROR, USAGE_ERROR, type Io } from './run.ts'

const CARD_OPTIONS = `Options:
  --label <text>             How the card appears at checkout, e.g. "Amex Gold".
  --pick <choice>=<options>  Bonus categories you picked for this period, e.g.
                             --pick five-percent=fast-food,movie-theaters.
                             Repeat for each choice.
  --anniversary <MM-DD>      Account anniversary, for caps that reset on it
                             and a fee card's renewal check.
  --opened <date>            Optional: the day the account opened (YYYY-MM-DD),
                             for cards with a first-year rate. Without it the
                             card is ranked at its standard rates.
  --activated <rules>        Rules you've activated with the issuer, comma
                             separated. Replaces the current list.
  --enrolled <credits>       Statement credits you've enrolled in with the
                             issuer, or use if they need no enrolling, and
                             free nights you use, comma separated, e.g.
                             --enrolled lululemon. They count against the
                             annual fee. Replaces the current list.
  --credit-used <credit>=<dollars>
                             How much of a credit you've received this period,
                             e.g. --credit-used lululemon=40. Repeat for each.
  --skipped-credits <credits>
                             Statement credits and free nights you don't use,
                             comma separated, e.g. --skipped-credits dunkin.
                             They're left out of picks, the to-do list and
                             annual-fee math. Replaces the current list.
  --night-value <night>=<dollars>
                             Optional: what a yearly free night is worth to
                             you, e.g. --night-value anniversary-night=300.
                             It counts at that instead of its point cap, and
                             is marked used; a night with no point cap counts
                             only this way. <night>=none clears it.
  --cap-spent <cap>=<dollars>
                             Spending toward a cap so far this period, e.g.
                             --cap-spent us-supermarkets=1200. Repeat for each.
  --milestone-spent <bonus>=<dollars>
                             Spending this year toward a spend bonus, e.g.
                             --milestone-spent spend-15k=9000. Repeat for each.
  --bonus-opened <date>      Track a welcome bonus: the day the account opened
                             (YYYY-MM-DD). Spending needed and the deadline
                             default to the card's published offer.
  --bonus-spent <dollars>    Spending toward it so far. Default 0.
  --bonus-spend <dollars>    The spending needed, if your offer differs.
  --bonus-by <date>          The deadline, if your offer differs.
  --no-bonus                 Stop tracking the welcome bonus.
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

Changes a card in your wallet: picks for this period, label, anniversary,
opening date, activations, spending toward caps and spend bonuses, statement
credits or welcome bonus. Picks for the current period are merged with ones
already set.

${CARD_OPTIONS}
`,
  remove: `Usage: ${CLI_NAME} remove <card-id>

Removes a card from your wallet, with its tracked cap usage, welcome-bonus
progress, spend-bonus spending and statement credits used. Your memberships
and point values stay.
`,
  memberships: `Usage: ${CLI_NAME} memberships [<membership>...] [--none]

With no arguments, shows your memberships and the ones earnrate knows. With
names, replaces the list. --none clears it. No cards need to be saved first.
`,
  'skip-issuers': `Usage: ${CLI_NAME} skip-issuers [<issuer>...] [--none]

Issuers you can't or won't get a new card from (for example chase, if
you're over its 5/24 rule). ${CLI_NAME} offers and the cards that would add
the most leave them out. With no arguments, shows the list and the issuers
earnrate knows. With issuers, replaces the list. --none clears it.
`,
  values: `Usage: ${CLI_NAME} values [<currency>=<cents>...] [--profile <name>]

What your points are worth to you, in cents per point, saved in your wallet
file; every answer then uses them unless you pass --valuation. With no
arguments, shows them.

Examples:
  ${CLI_NAME} values UR=1.5 MR=1.6
  ${CLI_NAME} values UR=default          back to earnrate's value
  ${CLI_NAME} values --profile points-heavy

Options:
  --profile <name>       flat (${profileText('flat')}) or points-heavy (${profileText('points-heavy')}).
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
        opened: { type: 'string' },
        activated: { type: 'string' },
        enrolled: { type: 'string' },
        'skipped-credits': { type: 'string' },
        'credit-used': { type: 'string', multiple: true },
        'night-value': { type: 'string', multiple: true },
        'cap-spent': { type: 'string', multiple: true },
        'milestone-spent': { type: 'string', multiple: true },
        'bonus-opened': { type: 'string' },
        'bonus-spent': { type: 'string' },
        'bonus-spend': { type: 'string' },
        'bonus-by': { type: 'string' },
        'no-bonus': { type: 'boolean' },
        none: { type: 'boolean' },
        profile: { type: 'string' },
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
    values.opened !== undefined ||
    values.activated !== undefined ||
    values.enrolled !== undefined ||
    values['skipped-credits'] !== undefined ||
    values['credit-used'] !== undefined ||
    values['night-value'] !== undefined ||
    values['cap-spent'] !== undefined ||
    values['milestone-spent'] !== undefined ||
    values['bonus-opened'] !== undefined ||
    values['bonus-spent'] !== undefined ||
    values['bonus-spend'] !== undefined ||
    values['bonus-by'] !== undefined ||
    values['no-bonus'] !== undefined
  if (command !== 'add' && command !== 'update' && cardOptionsGiven) {
    return usage(`${CLI_NAME} ${command} doesn't take card options.`)
  }
  if (command !== 'memberships' && command !== 'skip-issuers' && values.none) {
    return usage('--none is only for memberships and skip-issuers.')
  }

  const catalog = await loadCatalog()
  const file = walletPath(io.env)
  const where = displayPath(file)
  const store = new FileWalletStore(catalog, file)

  if (command === 'cards') {
    const query = positionals.join(' ')
    const held = await heldWallet(io)
    const result = searchCards(catalog, query, held, io.today)
    if (result.cards.length === 0) {
      io.stderr(
        `No card matches "${query}". Run ${CLI_NAME} cards with no words to list all ${String(catalog.cards.length)}.\n`,
      )
      return RUNTIME_ERROR
    }
    const header = result.exact ? '' : 'No card matches every word. Closest:\n'
    const details = cardDetails(
      catalog,
      result.cards.map((c) => c.id),
      held,
      io.today,
    )
    const footer = details === null ? `\n${DETAILS_LEFT_OUT}\n` : ''
    io.stdout(
      `${header}${result.cards.map((c, i) => formatCardInfo(catalog, c, details?.[i])).join('\n')}\n${footer}`,
    )
    return 0
  }

  if (command === 'values') {
    const changes: Record<string, number | null> = {}
    if (values.profile !== undefined) {
      if (!isValuationProfile(values.profile))
        return usage(
          `Unknown profile "${values.profile}". Use flat or points-heavy.`,
        )
      Object.assign(changes, VALUATION_PROFILES[values.profile])
    }
    for (const arg of positionals) {
      const [id, value] = arg.split('=')
      const cents = value === 'default' ? null : Number(value)
      if (
        !id ||
        value === undefined ||
        (cents !== null && !Number.isFinite(cents))
      )
        return usage(`"${arg}" isn't <currency>=<cents>, like UR=1.5.`)
      changes[id] = cents
    }
    const given = currencyChanges(catalog, changes)
    if (!given.ok) return usage(given.error)
    if (Object.keys(changes).length === 0) {
      const held = await heldWallet(io)
      const set = Object.entries(held?.valuations ?? {})
      io.stdout(
        `${set.length > 0 ? `Yours: ${set.map(([id, v]) => `${id}=${typeof v === 'number' ? String(v) : JSON.stringify(v)}`).join(' ')}` : "Yours: earnrate's defaults"}\nCurrencies: ${catalog.currencies.map((c) => c.id).join(', ')}\n`,
      )
      return 0
    }
    return report(
      await store.setValuations(given.changes),
      `Point values updated in ${where}: ${Object.entries(given.changes)
        .map(
          ([id, c]) =>
            `${id} ${c === null ? `back to earnrate's default, ${String(catalog.currencies.find((x) => x.id === id)?.value_cents ?? 1)}¢` : `${String(c)}¢`}`,
        )
        .join(', ')}.`,
      null,
      io,
    )
  }

  if (command === 'skip-issuers') {
    const issuerList = (ids: string[]) =>
      ids.map((i) => `${issuerName(catalog, i)} (${i})`).join(', ')
    if (positionals.length === 0 && !values.none) {
      const held = await heldWallet(io)
      const known = [...new Set(catalog.cards.map((c) => c.issuer))].sort()
      io.stdout(
        `Left out: ${held?.skipped_issuers?.length ? issuerList(held.skipped_issuers) : 'none'}\nKnown: ${known.join(', ')}\n`,
      )
      return 0
    }
    if (positionals.length > 0 && values.none) {
      return usage('Give issuers or --none, not both.')
    }
    const list = values.none ? [] : positionals
    return report(
      await store.setSkippedIssuers(list),
      list.length > 0
        ? `Next-card answers now leave out ${issuerList(list)} (${where}).`
        : `Next-card answers include every issuer again (${where}).`,
      null,
      io,
    )
  }

  if (command === 'memberships') {
    if (positionals.length === 0 && !values.none) {
      const held = await heldWallet(io)
      io.stdout(
        `Yours: ${held && held.memberships.length > 0 ? held.memberships.map((m) => `${membershipName(catalog, m)} (${m})`).join(', ') : 'none'}\nKnown: ${knownMemberships(catalog).join(', ')}\n`,
      )
      return 0
    }
    if (positionals.length > 0 && values.none) {
      return usage('Give memberships or --none, not both.')
    }
    const list = values.none ? [] : positionals
    return report(
      await store.setMemberships(list),
      list.length > 0
        ? `Memberships set to ${list.map((m) => `${membershipName(catalog, m)} (${m})`).join(', ')} in ${where}.`
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
      await store.removeCard(id),
      `Removed ${name} from ${where}.`,
      null,
      io,
    )
  }

  const input: CardInput = { id }
  if (values.label !== undefined) input.checkoutLabel = values.label
  if (values.anniversary !== undefined) input.anniversary = values.anniversary
  if (values.opened !== undefined) input.opened = values.opened
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
  const dollarsFlag = (flag: string, text: string | undefined) => {
    if (text === undefined) return undefined
    const n = Number(text.replace(/[$,]/g, ''))
    return Number.isFinite(n) ? n : `--${flag} takes dollars, like 1200.`
  }
  const idList = (text: string) =>
    text
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r !== '')
  if (values.enrolled !== undefined) input.enrolled = idList(values.enrolled)
  if (values['skipped-credits'] !== undefined)
    input.skippedCredits = idList(values['skipped-credits'])
  // --credit-used, --cap-spent and --milestone-spent: <id>=<dollars>, repeated.
  const dollarPairs = (
    flag: 'credit-used' | 'cap-spent' | 'milestone-spent',
    example: string,
  ): Record<string, number> | string | undefined => {
    const pairs = values[flag]
    if (pairs === undefined) return undefined
    const out: Record<string, number> = {}
    for (const pair of pairs) {
      const [id = '', dollars] = pair.split('=')
      const n = dollarsFlag(flag, dollars)
      if (id.trim() === '' || n === undefined || typeof n === 'string')
        return `--${flag} takes <id>=<dollars>, like ${example}.`
      out[id.trim()] = n
    }
    return out
  }
  const creditUsed = dollarPairs('credit-used', 'lululemon=40')
  const capSpent = dollarPairs('cap-spent', 'us-supermarkets=1200')
  const milestoneSpent = dollarPairs('milestone-spent', 'spend-15k=9000')
  for (const result of [creditUsed, capSpent, milestoneSpent])
    if (typeof result === 'string') return usage(result)
  if (typeof creditUsed === 'object') input.creditUsed = creditUsed
  if (typeof capSpent === 'object') input.capSpent = capSpent
  if (values['night-value'] !== undefined) {
    const nightValues: Record<string, number | null> = {}
    for (const pair of values['night-value']) {
      const [night = '', dollars = ''] = pair.split('=')
      const n =
        dollars.trim() === 'none' ? null : dollarsFlag('night-value', dollars)
      if (night.trim() === '' || dollars.trim() === '' || typeof n === 'string')
        return usage(
          '--night-value takes <night>=<dollars>, like anniversary-night=300, or <night>=none.',
        )
      nightValues[night.trim()] = n ?? null
    }
    input.nightValues = nightValues
  }
  if (typeof milestoneSpent === 'object') input.milestoneSpent = milestoneSpent
  if (values['no-bonus']) {
    input.bonus = null
  } else if (values['bonus-opened'] !== undefined) {
    const spent = dollarsFlag('bonus-spent', values['bonus-spent'])
    const spend = dollarsFlag('bonus-spend', values['bonus-spend'])
    if (typeof spent === 'string') return usage(spent)
    if (typeof spend === 'string') return usage(spend)
    input.bonus = {
      opened: values['bonus-opened'],
      ...(spent === undefined ? {} : { spent }),
      ...(spend === undefined ? {} : { spend }),
      ...(values['bonus-by'] === undefined ? {} : { by: values['bonus-by'] }),
    }
  } else if (
    values['bonus-spent'] !== undefined ||
    values['bonus-spend'] !== undefined ||
    values['bonus-by'] !== undefined
  ) {
    return usage('Give --bonus-opened with the other --bonus options.')
  }

  if (command === 'add') {
    const result = await store.addCard(input, io.today)
    return report(
      result,
      `Added ${name} to ${where}${result.ok && result.created ? ' (a new wallet)' : ''}.`,
      id,
      io,
    )
  }
  return report(
    await store.updateCard(input, io.today),
    `Updated ${name} in ${where}.`,
    id,
    io,
  )
}
