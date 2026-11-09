import { parseArgs } from 'node:util'
import { CLI_NAME } from '../brand.ts'
import { loadCatalog, walletPath } from '../data/load.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  type CardFilters,
} from '../engine/explore.ts'
import {
  isValuationProfile,
  profileText,
  VALUATION_PROFILES,
  withValuationProfile,
} from '../engine/profiles.ts'
import {
  nothingCounted,
  resolveSpendLines,
  simulateAdditions,
  simulateCatalog,
  spendLineFor,
  typicalSpend,
  TYPICAL_SPEND_NOTE,
  type SpendLine,
} from '../engine/simulate.ts'
import {
  formatAdditions,
  formatCatalogSimulation,
  formatExploration,
} from '../format/explore.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import {
  BOTH_CHANNELS,
  cardList,
  channelOf,
  dateProblem,
  membershipProblem,
  paymentOf,
  splitAmount,
  valuationProblem,
} from './args.ts'
import { COUNTRY_CODE, countryProblem } from '../schema/common.ts'
import {
  cardsToUse,
  type Io,
  RUNTIME_ERROR,
  savedSettings,
  USAGE_ERROR,
} from './run.ts'

const FILTER_OPTIONS = `  --cash, --points        Cash back cards only, or points and miles cards only.
  --no-fee                Cards with no annual fee.
  --issuer <id>           One issuer's cards, e.g. chase or amex.
  --business              Business cards instead of personal ones.
  --closed                Include cards the issuer no longer takes applications for.
  --member <name>         A membership you have, e.g. amazon-prime or costco. Repeatable.
  --valuation <profile>   flat (${profileText('flat')}) or points-heavy
                          (${profileText('points-heavy')}), instead of your
                          saved point values.`

const BEST_HELP = `Usage: ${CLI_NAME} best <merchant or category> [amount] [options]

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
  --country <code>        Where you're paying. Abroad, cards rank after their
                          foreign transaction fees. Default: US.
  --paying <how>          card, apple-pay, google-pay or paypal. Rates that need
                          one (Apple Pay on Apple Card) count only when you say.
  --all                   List every card, not just the top 10.
  --json                  Print the full result as JSON.
  -h, --help              Show this help.
`

const SIMULATE_HELP = `Usage: ${CLI_NAME} simulate [<what>=<dollars a month>...] [options]

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
  saved: Pick<Wallet, 'valuations' | 'memberships'>,
): Settings | string {
  if (values.cash && values.points) return 'Pick --cash or --points, not both.'
  const problem =
    valuationProblem(values.valuation) ??
    membershipProblem(catalog, values.member ?? [])
  if (problem !== null) return problem
  const issuers = [...new Set(catalog.cards.map((c) => c.issuer))].sort()
  if (values.issuer !== undefined && !issuers.includes(values.issuer))
    return `Unknown issuer "${values.issuer}". Use one of: ${issuers.join(', ')}.`
  return {
    filters: {
      ...ALL_PERSONAL_CARDS,
      kind: values.cash ? 'cash' : values.points ? 'points' : 'any',
      business: values.business ?? false,
      noAnnualFee: values['no-fee'] ?? false,
      issuer: values.issuer ?? null,
      includeClosed: values.closed ?? false,
    },
    memberships: values.member ?? saved.memberships,
    valuations:
      values.valuation !== undefined && isValuationProfile(values.valuation)
        ? VALUATION_PROFILES[values.valuation]
        : saved.valuations,
  }
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
        country: { type: 'string' },
        paying: { type: 'string' },
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
  const split = splitAmount(positionals)
  if (typeof split === 'string') {
    io.stderr(`${split}\n`)
    return USAGE_ERROR
  }
  const { text, amount } = split
  if (text === '') {
    io.stderr(`Say what you're buying, e.g. ${CLI_NAME} best groceries.\n`)
    return USAGE_ERROR
  }
  if (values.online && values['in-store']) {
    io.stderr(`${BOTH_CHANNELS}\n`)
    return USAGE_ERROR
  }
  const dated = dateProblem(values.date)
  if (dated !== null) {
    io.stderr(`${dated}\n`)
    return USAGE_ERROR
  }
  const country = values.country ?? 'US'
  if (!COUNTRY_CODE.test(country)) {
    io.stderr(`${countryProblem(country)}\n`)
    return USAGE_ERROR
  }
  const paying = paymentOf(values.paying)
  if ('problem' in paying) {
    io.stderr(`${paying.problem}\n`)
    return USAGE_ERROR
  }
  const catalog = await loadCatalog()
  const settings = settingsFrom(
    values,
    catalog,
    await savedSettings(io, catalog),
  )
  if (typeof settings === 'string') {
    io.stderr(`${settings}\n`)
    return USAGE_ERROR
  }
  const result = exploreCards(
    catalog,
    {
      merchant: text,
      category: null,
      amount,
      channel: channelOf(values),
      date: values.date ?? io.today,
      country: country.toUpperCase(),
      payment: paying.payment,
    },
    settings,
  )
  io.stdout(
    values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatExploration(result, catalog, values.all ?? false),
  )
  return 0
}

function parseSpend(catalog: Catalog, args: string[]): SpendLine[] | string {
  const lines: SpendLine[] = []
  for (const arg of args) {
    const match = /^(.+)=\$?(\d+(?:\.\d+)?)$/.exec(arg)
    if (!match?.[1] || match[2] === undefined)
      return `"${arg}" isn't <what>=<dollars a month>, e.g. groceries=600.`
    lines.push(
      spendLineFor(catalog, match[1].replace(/[-_]/g, ' '), Number(match[2])),
    )
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
  const settings = settingsFrom(
    values,
    catalog,
    await savedSettings(io, catalog),
  )
  if (typeof settings === 'string') {
    io.stderr(`${settings}\n`)
    return USAGE_ERROR
  }
  const typical = positionals.length === 0
  const spend = typical
    ? typicalSpend(catalog)
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
  const none = nothingCounted(catalog, lines)
  if (none !== null) {
    io.stderr(`${none}\n`)
    return USAGE_ERROR
  }
  const started = dateProblem(values.start)
  if (started !== null) {
    io.stderr(`${started}\n`)
    return USAGE_ERROR
  }
  const options = { ...settings, start: values.start ?? io.today }

  if (values.wallet || values.cards !== undefined) {
    const wallet = await cardsToUse(catalog, walletPath(io.env), io, {
      cards: cardList(values.cards),
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
