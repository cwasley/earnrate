import { parseArgs } from 'node:util'
import { CLI_NAME } from '../brand.ts'
import { loadCatalog, walletPath } from '../data/load.ts'
import { compareOffers } from '../engine/offers.ts'
import { isValuationProfile, withValuationProfile } from '../engine/profiles.ts'
import { currencyName } from '../engine/text.ts'
import { formatOffers } from '../format/offers.ts'
import { cardList, valuationProblem } from './args.ts'
import {
  cardsToUse,
  RUNTIME_ERROR,
  savedSettings,
  USAGE_ERROR,
  type Io,
} from './run.ts'

const OFFERS_HELP = `Usage: ${CLI_NAME} offers [--cash | --points] [--no-fee] [--business] [options]

Which card to get next: ranks cards you don't have by their first two years
together. That's what each adds to your cards at typical spending, plus its
welcome bonus in year one if the minimum spend fits in the window, less each
year's annual fee. Each also shows the bonus alone. Issuers saved with ${CLI_NAME} skip-issuers are left out.

Options:
  --cash                 Cash back cards only.
  --points               Points and miles cards only.
  --no-fee               Cards with no annual fee.
  --business             Business cards instead of personal ones.
  --held                 Include cards already in your wallet.
  --cards <ids>          Cards you have, instead of your wallet, comma separated.
  --member <name>        A membership you have, in place of the saved ones.
  --skip-issuer <id>     Leave out an issuer's cards (chase), in place of the
                         saved list. Repeat for more.
  --valuation <profile>  flat or points-heavy, instead of your wallet's values.
  --all                  List every offer, not just the top 10.
  --json                 Print the full comparison as JSON.
  -h, --help             Show this help.
`

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
        cards: { type: 'string' },
        member: { type: 'string', multiple: true },
        'skip-issuer': { type: 'string', multiple: true },
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
  const problem = valuationProblem(values.valuation)
  if (problem !== null) {
    io.stderr(`${problem}\n`)
    return USAGE_ERROR
  }

  const catalog = await loadCatalog()
  const found = await cardsToUse(catalog, walletPath(io.env), io, {
    cards: cardList(values.cards),
    members: values.member ?? [],
  })
  if (found === null) return RUNTIME_ERROR
  const loaded =
    found === 'none'
      ? await savedSettings(io, catalog).then((saved) => ({
          valuations: saved.valuations,
          memberships: values.member ?? saved.memberships,
          ...(saved.skipped_issuers
            ? { skipped_issuers: saved.skipped_issuers }
            : {}),
          cards: [],
        }))
      : found
  const skips = values['skip-issuer']
  const issuers = new Set(catalog.cards.map((c) => c.issuer))
  const unknown = (skips ?? []).filter((i) => !issuers.has(i))
  if (unknown.length > 0) {
    io.stderr(
      `No card earnrate knows is from ${unknown.map((i) => `'${i}'`).join(', ')}. Issuers: ${[...issuers].sort().join(', ')}.\n`,
    )
    return USAGE_ERROR
  }
  const skipped = skips ? { ...loaded, skipped_issuers: skips } : loaded
  const wallet =
    values.valuation && isValuationProfile(values.valuation)
      ? withValuationProfile(skipped, values.valuation)
      : skipped

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
  io.stdout(
    formatOffers(
      comparison,
      (id) => currencyName(catalog, id),
      values.all ?? false,
      catalog,
    ),
  )
  return 0
}
