import { parseArgs } from 'node:util'
import { CLI_NAME } from '../brand.ts'
import { loadCatalog, walletPath, type Catalog } from '../data/load.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  findCategory,
  type CardFilters,
  type Exploration,
  type ExploreEntry,
  type Picks,
} from '../engine/explore.ts'
import {
  isValuationProfile,
  VALUATION_PROFILES,
  withValuationProfile,
} from '../engine/profiles.ts'
import {
  resolveSpendLines,
  simulateAdditions,
  simulateCatalog,
  spendLineFor,
  TYPICAL_MONTHLY_SPEND,
  TYPICAL_SPEND_NOTE,
  type CatalogSimulation,
  type Simulation,
  type SpendLine,
  type WalletWhatIf,
} from '../engine/simulate.ts'
import { knownMemberships } from '../engine/setup.ts'
import type { Wallet } from '../schema/wallet.ts'
import { cardsToUse, RUNTIME_ERROR, USAGE_ERROR, type Io } from './run.ts'

const FILTER_OPTIONS = `  --cash, --points        Cash back cards only, or points and miles cards only.
  --no-fee                Cards with no annual fee.
  --issuer <id>           One issuer's cards, e.g. chase or amex.
  --business              Business cards instead of personal ones.
  --closed                Include cards the issuer no longer takes applications for.
  --member <name>         A membership you have, e.g. amazon-prime. Repeatable.
  --valuation <profile>   flat (points at 1¢, the default) or points-heavy
                          (MR and UR at 1.7¢).`

export const BEST_HELP = `Usage: ${CLI_NAME} best <merchant or category> [amount] [options]

Ranks every card in earnrate's catalog for one purchase, not just yours. Each
card is set up at its best: the right category pick, activated, cap unused.

Examples:
  ${CLI_NAME} best groceries
  ${CLI_NAME} best amazon 120 --member amazon-prime
  ${CLI_NAME} best dining --no-fee

Options:
${FILTER_OPTIONS}
  --online, --in-store    How you're paying. Default: inferred from the merchant.
  --date <YYYY-MM-DD>     Purchase date. Default: today.
  --all                   List every card, not just the top 10.
  --json                  Print the full result as JSON.
  -h, --help              Show this help.
`

export const SIMULATE_HELP = `Usage: ${CLI_NAME} simulate [<what>=<dollars a month>...] [options]

Spends this much every month for a year and ranks the cards, and the
two-card pairs, that earn the most after annual fees. Each <what> is a
category (groceries, dining, gas, travel, streaming, other) or a merchant
(amazon, costco). With no amounts, it uses typical ones for a U.S. household.

Examples:
  ${CLI_NAME} simulate groceries=600 dining=300 gas=150 other=1000
  ${CLI_NAME} simulate groceries=600 amazon=150 other=800 --wallet

Options:
  --wallet                Start from your wallet and rank the cards that would
                          add the most to it, after their fee.
  --cards <ids>           The same, for cards you name instead of your wallet.
${FILTER_OPTIONS}
  --start <YYYY-MM-DD>    First month of the year simulated. Default: today.
  --all                   List more results.
  --json                  Print the full result as JSON.
  -h, --help              Show this help.
`

const FILTER_FLAGS = {
  cash: { type: 'boolean' },
  points: { type: 'boolean' },
  'no-fee': { type: 'boolean' },
  issuer: { type: 'string' },
  business: { type: 'boolean' },
  closed: { type: 'boolean' },
  member: { type: 'string', multiple: true },
  valuation: { type: 'string' },
  all: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const

type FilterValues = {
  cash?: boolean | undefined
  points?: boolean | undefined
  'no-fee'?: boolean | undefined
  issuer?: string | undefined
  business?: boolean | undefined
  closed?: boolean | undefined
  member?: string[] | undefined
  valuation?: string | undefined
}

type Settings = {
  filters: CardFilters
  memberships: string[]
  valuations: Wallet['valuations']
}

function settingsFrom(
  values: FilterValues,
  catalog: Catalog,
): Settings | string {
  if (values.cash && values.points) return 'Pick --cash or --points, not both.'
  if (values.valuation !== undefined && !isValuationProfile(values.valuation))
    return `Unknown valuation "${values.valuation}". Use flat or points-heavy.`
  const issuers = [...new Set(catalog.cards.map((c) => c.issuer))].sort()
  if (values.issuer !== undefined && !issuers.includes(values.issuer))
    return `Unknown issuer "${values.issuer}". Use one of: ${issuers.join(', ')}.`
  const known = knownMemberships(catalog)
  const unknown = (values.member ?? []).filter((m) => !known.includes(m))
  if (unknown.length > 0)
    return `Unknown membership "${unknown.join('", "')}". Use one of: ${known.join(', ')}.`
  return {
    filters: {
      ...ALL_PERSONAL_CARDS,
      kind: values.cash ? 'cash' : values.points ? 'points' : 'any',
      business: values.business ?? false,
      noAnnualFee: values['no-fee'] ?? false,
      issuer: values.issuer ?? null,
      includeClosed: values.closed ?? false,
    },
    memberships: values.member ?? [],
    valuations:
      values.valuation !== undefined && isValuationProfile(values.valuation)
        ? VALUATION_PROFILES[values.valuation]
        : {},
  }
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`
const wholeUsd = (n: number) => usd(Math.round(n))
const pct = (n: number) => `${String(Number(n.toFixed(2)))}%`

function feeText(e: { annualFee: number | null; firstYearFee: number | null }) {
  if (e.annualFee === null) return 'annual fee not on file'
  if (e.annualFee === 0) return 'no annual fee'
  if (e.firstYearFee !== null && e.firstYearFee !== e.annualFee)
    return `${usd(e.annualFee)} annual fee (${e.firstYearFee === 0 ? 'waived' : usd(e.firstYearFee)} the first year)`
  return `${usd(e.annualFee)} annual fee`
}

const TOP_BEST = 10

export function formatExploration(r: Exploration, all: boolean): string {
  const m = r.merchant
  const title =
    m.source === 'category'
      ? m.resolvedName.toLowerCase()
      : m.source === 'none'
        ? `"${m.input}" (not recognized)`
        : m.resolvedName
  if (r.ranked.length === 0) return `No cards match at ${title}.\n`
  const shown = all ? r.ranked : r.ranked.slice(0, TOP_BEST)
  const width = Math.max(...shown.map((e) => e.cardName.length))
  const lines = [`Best cards for ${title}:`, '']
  shown.forEach((e: ExploreEntry, i) => {
    const earned = e.earned === null ? '' : `  ${usd(e.earned)}`
    lines.push(
      `${String(i + 1).padStart(2)}. ${e.cardName.padEnd(width)}  ${pct(e.effectiveReturnPct).padStart(5)}${earned}  ${feeText(e)}`,
    )
    for (const c of e.conditions) lines.push(`    ${c}`)
    const upgrade = e.withMembership[0]
    if (upgrade)
      lines.push(
        `    With ${upgrade.membership}: ${pct(upgrade.effectiveReturnPct)}.`,
      )
    for (const w of e.warnings) lines.push(`    ! ${w}`)
  })
  if (r.ranked.length > shown.length)
    lines.push(
      `  + ${String(r.ranked.length - shown.length)} more (--all lists them)`,
    )
  for (const w of r.warnings) lines.push('', `! ${w}`)
  lines.push('', ...r.assumptions)
  return `${lines.join('\n')}\n`
}

function picksText(picks: Picks): string {
  const parts = Object.entries(picks).map(
    ([choice, options]) => `${choice}: ${options.join(', ')}`,
  )
  return parts.length === 0 ? '' : ` (picks ${parts.join('; ')})`
}

function cardNamer(catalog: Catalog) {
  return (id: string) => catalog.cards.find((c) => c.id === id)?.name ?? id
}

function splitText(sim: Simulation, name: (id: string) => string): string[] {
  const byCard = new Map<string, string[]>()
  for (const line of sim.lines) {
    const first = line.cards[0]
    if (first === undefined) continue
    byCard.set(first, [...(byCard.get(first) ?? []), line.label])
  }
  return [...byCard].map(([id, labels]) => `${labels.join(', ')} → ${name(id)}`)
}

const TOP_SIMULATED = 5

export function formatCatalogSimulation(
  r: CatalogSimulation,
  catalog: Catalog,
  all: boolean,
): string {
  const name = cardNamer(catalog)
  const first = r.singles[0]
  if (!first) return 'No cards match.\n'
  const top = all ? 20 : TOP_SIMULATED
  const lines = [
    `A year of this spending: ${wholeUsd(first.spend)}.`,
    '',
    'Best single cards (rewards minus annual fee, per year):',
  ]
  r.singles.slice(0, top).forEach((s, i) => {
    const card = s.cards[0]
    if (!card) return
    lines.push(
      `${String(i + 1).padStart(2)}. ${name(card.cardId)}  ${wholeUsd(s.net)}  (${wholeUsd(s.rewards)} rewards, ${wholeUsd(s.annualFees)} fee)${picksText(card.picks)}`,
    )
  })
  const pairs = r.pairs.slice(0, top)
  if (pairs.length > 0) {
    lines.push('', 'Best two-card pairs:')
    pairs.forEach((s, i) => {
      lines.push(
        `${String(i + 1).padStart(2)}. ${s.cards.map((c) => `${name(c.cardId)}${picksText(c.picks)}`).join(' + ')}  ${wholeUsd(s.net)}`,
      )
      if (s.alternatives.length > 0)
        lines.push(
          `    Same result with ${s.alternatives.map(name).join(' or ')} as the second card.`,
        )
      for (const split of splitText(s, name)) lines.push(`    ${split}`)
    })
    const bestPair = r.pairs[0]
    if (bestPair && bestPair.net <= first.net)
      lines.push(
        '',
        `One card is enough here: no pair beats ${name(first.cards[0]?.cardId ?? '')}.`,
      )
  }
  const notes = new Set([
    ...r.singles.slice(0, top).flatMap((s) => s.notes),
    ...pairs.flatMap((s) => s.notes),
  ])
  if (notes.size > 0) lines.push('', ...notes)
  lines.push(
    '',
    "Assumes each card's best picks, activations done each quarter, and no welcome bonuses.",
  )
  return `${lines.join('\n')}\n`
}

export function formatAdditions(
  r: WalletWhatIf,
  catalog: Catalog,
  all: boolean,
): string {
  const name = cardNamer(catalog)
  const lines = [
    `Your wallet earns about ${wholeUsd(r.current.rewards)} a year on this spending${r.current.annualFees > 0 ? `, with ${wholeUsd(r.current.annualFees)} in annual fees` : ''}.`,
  ]
  for (const split of splitText(r.current, name)) lines.push(`  ${split}`)
  const gains = r.additions.filter((a) => a.gain > 0)
  if (gains.length === 0) {
    lines.push('', 'No card would add more than its annual fee costs.')
  } else {
    lines.push('', 'Cards that would add the most (after their annual fee):')
    gains.slice(0, all ? 20 : TOP_SIMULATED).forEach((a, i) => {
      lines.push(
        `${String(i + 1).padStart(2)}. ${name(a.cardId)}  +${wholeUsd(a.gain)} a year  (+${wholeUsd(a.extraRewards)} rewards, ${wholeUsd(a.annualFee)} fee)${picksText(a.picks)}`,
      )
    })
  }
  const notes = new Set(r.current.notes)
  if (notes.size > 0) lines.push('', ...notes)
  lines.push(
    '',
    'Assumes your picks carry over, rotating categories get activated, and caps start fresh.',
  )
  return `${lines.join('\n')}\n`
}

export async function runBest(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        ...FILTER_FLAGS,
        online: { type: 'boolean' },
        'in-store': { type: 'boolean' },
        date: { type: 'string' },
      },
    })
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n${BEST_HELP}`)
    return USAGE_ERROR
  }
  const { values, positionals } = parsed
  if (values.help) {
    io.stdout(BEST_HELP)
    return 0
  }
  const words = [...positionals]
  const last = words.at(-1)
  const amount =
    words.length > 1 && last !== undefined && /^\$?\d+(\.\d+)?$/.test(last)
      ? Number(last.replace('$', ''))
      : null
  if (amount !== null) words.pop()
  const text = words.join(' ').trim()
  if (text === '') {
    io.stderr(`Say what you're buying, e.g. ${CLI_NAME} best groceries.\n`)
    return USAGE_ERROR
  }
  if (values.online && values['in-store']) {
    io.stderr('Pick --online or --in-store, not both.\n')
    return USAGE_ERROR
  }
  const catalog = await loadCatalog()
  const settings = settingsFrom(values, catalog)
  if (typeof settings === 'string') {
    io.stderr(`${settings}\n`)
    return USAGE_ERROR
  }
  const category = findCategory(catalog, text)
  const result = exploreCards(
    catalog,
    {
      merchant: category === null ? text : null,
      category,
      amount,
      channel: values.online
        ? 'online'
        : values['in-store']
          ? 'in_store'
          : null,
      date: values.date ?? io.today,
    },
    settings,
  )
  io.stdout(
    values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatExploration(result, values.all ?? false),
  )
  return 0
}

export function parseSpend(
  catalog: Catalog,
  args: string[],
): SpendLine[] | string {
  const lines: SpendLine[] = []
  for (const arg of args) {
    const match = /^(.+)=\$?(\d+(?:\.\d+)?)$/.exec(arg)
    if (!match?.[1] || match[2] === undefined)
      return `"${arg}" isn't <what>=<dollars a month>, e.g. groceries=600.`
    const what = match[1].replace(/[-_]/g, ' ')
    const category = findCategory(catalog, what)
    lines.push({
      merchant: category === null ? what : null,
      category,
      monthly: Number(match[2]),
    })
  }
  if (lines.length === 0)
    return `Give your monthly spending, e.g. ${CLI_NAME} simulate groceries=600 dining=300 other=1000.`
  return lines
}

export async function runSimulate(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        ...FILTER_FLAGS,
        wallet: { type: 'boolean' },
        cards: { type: 'string' },
        start: { type: 'string' },
      },
    })
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n${SIMULATE_HELP}`)
    return USAGE_ERROR
  }
  const { values, positionals } = parsed
  if (values.help) {
    io.stdout(SIMULATE_HELP)
    return 0
  }
  const catalog = await loadCatalog()
  const settings = settingsFrom(values, catalog)
  if (typeof settings === 'string') {
    io.stderr(`${settings}\n`)
    return USAGE_ERROR
  }
  const typical = positionals.length === 0
  const spend = typical
    ? TYPICAL_MONTHLY_SPEND.map((t) => spendLineFor(catalog, t.what, t.monthly))
    : parseSpend(catalog, positionals)
  if (typeof spend === 'string') {
    io.stderr(`${spend}\n`)
    return USAGE_ERROR
  }
  const lines = resolveSpendLines(catalog, spend)
  const unknown = lines.filter((l) => l.merchant.source === 'none')
  if (unknown.length > 0) {
    io.stderr(
      `Not a category or a merchant earnrate knows: ${unknown.map((l) => `"${l.merchant.input}"`).join(', ')}. Categories include groceries, dining, gas, travel, streaming and other.\n`,
    )
    return USAGE_ERROR
  }
  const options = { ...settings, start: values.start ?? io.today }

  if (values.wallet || values.cards !== undefined) {
    const wallet = await cardsToUse(walletPath(io.env), io, {
      cards: values.cards === undefined ? null : values.cards.split(','),
      members: values.member ?? [],
    })
    if (wallet === null) return RUNTIME_ERROR
    if (wallet === 'none') {
      io.stderr(
        `No saved wallet yet. Name your cards instead: --cards amex-gold,chase-prime-visa\n`,
      )
      return USAGE_ERROR
    }
    const valued =
      values.valuation !== undefined && isValuationProfile(values.valuation)
        ? withValuationProfile(wallet, values.valuation)
        : wallet
    const result = simulateAdditions(catalog, valued, lines, options)
    io.stdout(
      values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `${typical ? `${TYPICAL_SPEND_NOTE}\n\n` : ''}${formatAdditions(result, catalog, values.all ?? false)}`,
    )
    return 0
  }

  const result = simulateCatalog(catalog, lines, options)
  io.stdout(
    values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${typical ? `${TYPICAL_SPEND_NOTE}\n\n` : ''}${formatCatalogSimulation(result, catalog, values.all ?? false)}`,
  )
  return 0
}
