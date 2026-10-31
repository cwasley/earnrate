import { parseArgs } from 'node:util'
import { CLI_NAME } from '../brand.ts'
import { loadCatalog, walletPath } from '../data/load.ts'
import {
  compareOffers,
  type OfferComparison,
  type OfferSummary,
} from '../engine/offers.ts'
import { isValuationProfile, withValuationProfile } from '../engine/profiles.ts'
import { cardsToUse, RUNTIME_ERROR, USAGE_ERROR, type Io } from './run.ts'

export const OFFERS_HELP = `Usage: ${CLI_NAME} offers [--cash | --points] [--no-fee] [--business] [options]

Ranks the welcome offers on cards you don't have by first-year value: the
bonus at your point values minus the first year's annual fee.

Options:
  --cash                 Cash back cards only.
  --points               Points and miles cards only.
  --no-fee               Cards with no annual fee.
  --business             Business cards instead of personal ones.
  --held                 Include cards already in your wallet.
  --valuation <profile>  flat or points-heavy, instead of your wallet's values.
  --all                  List every offer, not just the top 10.
  --json                 Print the full comparison as JSON.
  -h, --help             Show this help.
`

const TOP = 10

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`

function reward(o: OfferSummary, currencyName: string): string {
  if (o.dollars !== null) return usd(o.dollars)
  return `${(o.points ?? 0).toLocaleString('en-US')} ${currencyName}`
}

function feeText(o: OfferSummary): string {
  if (o.annualFee === null) return 'annual fee not on file'
  if (o.annualFee === 0) return 'no annual fee'
  if (o.firstYearFee !== null && o.firstYearFee !== o.annualFee)
    return `${usd(o.annualFee)} annual fee (${o.firstYearFee === 0 ? 'waived' : usd(o.firstYearFee)} the first year)`
  return `${usd(o.annualFee)} annual fee`
}

export function formatOffers(
  c: OfferComparison,
  currencyName: (id: string) => string,
  all: boolean,
): string {
  if (c.offers.length === 0) {
    return `No published welcome offers match.${c.withoutOffer.length > 0 ? ` ${String(c.withoutOffer.length)} matching card(s) have none on file.` : ''}\n`
  }
  const shown = all ? c.offers : c.offers.slice(0, TOP)
  const width = Math.max(...shown.map((o) => o.cardName.length))
  const lines: string[] = []
  shown.forEach((o, i) => {
    const weeks = (o.months * 52) / 12
    const pace =
      o.spend > 0 ? ` (about ${usd(Math.round(o.spend / weeks))} a week)` : ''
    const spend =
      o.spend > 0
        ? `after ${usd(o.spend)} in ${String(o.months)} month${o.months === 1 ? '' : 's'}${pace}`
        : 'with no spending required'
    lines.push(
      `${String(i + 1).padStart(2)}. ${o.cardName.padEnd(width)}  about ${usd(Math.round(o.firstYearValue))} the first year`,
      `    ${reward(o, currencyName(o.currency))} ${spend}. ${feeText(o)[0]?.toUpperCase() ?? ''}${feeText(o).slice(1)}.${o.held ? ' In your wallet.' : ''}`,
    )
    if (o.validTo) lines.push(`    Offer ends ${o.validTo}.`)
    if (o.note) lines.push(`    ${o.note}`)
  })
  if (c.offers.length > shown.length)
    lines.push(
      `  + ${String(c.offers.length - shown.length)} more (--all lists them)`,
    )
  if (c.withoutOffer.length > 0)
    lines.push(
      '',
      `${String(c.withoutOffer.length)} matching card(s) have no published offer on file.`,
    )
  lines.push('', ...c.notes)
  return `${lines.join('\n')}\n`
}

export async function runOffers(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        cash: { type: 'boolean' },
        points: { type: 'boolean' },
        'no-fee': { type: 'boolean' },
        business: { type: 'boolean' },
        held: { type: 'boolean' },
        valuation: { type: 'string' },
        all: { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n${OFFERS_HELP}`)
    return USAGE_ERROR
  }
  const { values } = parsed
  if (values.help) {
    io.stdout(OFFERS_HELP)
    return 0
  }
  if (values.cash && values.points) {
    io.stderr('Pick --cash or --points, not both.\n')
    return USAGE_ERROR
  }
  if (values.valuation !== undefined && !isValuationProfile(values.valuation)) {
    io.stderr(
      `Unknown valuation "${values.valuation}". Use flat or points-heavy.\n`,
    )
    return USAGE_ERROR
  }

  const found = await cardsToUse(walletPath(io.env), io, {
    cards: null,
    members: [],
  })
  if (found === null) return RUNTIME_ERROR
  const catalog = await loadCatalog()
  const loaded =
    found === 'none' ? { valuations: {}, memberships: [], cards: [] } : found
  const wallet =
    values.valuation && isValuationProfile(values.valuation)
      ? withValuationProfile(loaded, values.valuation)
      : loaded

  const comparison = compareOffers(
    catalog,
    wallet,
    {
      kind: values.cash ? 'cash' : values.points ? 'points' : 'any',
      business: values.business ?? false,
      noAnnualFee: values['no-fee'] ?? false,
      includeHeld: values.held ?? false,
    },
    io.today,
  )
  if (values.json) {
    io.stdout(`${JSON.stringify(comparison, null, 2)}\n`)
    return 0
  }
  const currencyName = (id: string) =>
    catalog.currencies.find((c) => c.id === id)?.name ?? id
  io.stdout(formatOffers(comparison, currencyName, values.all ?? false))
  return 0
}
