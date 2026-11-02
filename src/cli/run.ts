import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CLI_NAME,
  CONFIG_DIR,
  LLM_ENV_VAR,
  LLM_MAX_CALLS_ENV_VAR,
  LLM_MODEL_ENV_VAR,
  MERCHANT_CACHE_ENV_VAR,
  WALLET_ENV_VAR,
} from '../brand.ts'
import { walletProblems } from '../data/integrity.ts'
import { loadCatalog, loadWallet, walletPath } from '../data/load.ts'
import { ALL_PERSONAL_CARDS, exploreCards } from '../engine/explore.ts'
import {
  profileText,
  VALUATION_PROFILES,
  withValuationProfile,
} from '../engine/profiles.ts'
import { recommend } from '../engine/recommend.ts'
import { walletFromCards } from '../engine/transient.ts'
import type { MerchantResolution, Purchase } from '../engine/types.ts'
import { formatExploration } from '../format/explore.ts'
import {
  formatRecommendation,
  plain,
  type Style,
} from '../format/recommendation.ts'
import { DEFAULT_LLM_MODEL } from '../merchants/anthropic.ts'
import type { Classifier } from '../merchants/classifier.ts'
import { DEFAULT_MAX_CALLS } from '../merchants/fallback.ts'
import { llmEnabled, openLlmSession } from '../merchants/from-env.ts'
import { resolvePlace, withCallerCategory } from '../merchants/resolve.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { packageVersion } from '../version.ts'
import { membershipProblem, parseCliArgs } from './args.ts'
import { runCheatSheet } from './cheatsheet.ts'
import { runTodo } from './todo.ts'
import { runBest, runSimulate } from './explore.ts'
import { runImport } from './import.ts'
import { runOffers } from './offers.ts'
import { runWalletCommand, WALLET_HELP } from './wallet.ts'

export type Io = {
  env: NodeJS.ProcessEnv
  today: string // YYYY-MM-DD
  stdout: (text: string) => void
  stderr: (text: string) => void
  style?: Style
  classifier?: Classifier // replaces the Anthropic classifier in tests
}

const HELP = `Usage: ${CLI_NAME} <merchant> [amount] [options]

Picks the card that earns the most at a merchant, and says why: from your
wallet if you've saved one, from cards you name with --cards, or else from
every card earnrate knows.

Examples:
  ${CLI_NAME} whole foods 80
  ${CLI_NAME} costco --in-store
  ${CLI_NAME} delta.com 450 --valuation points-heavy

Compare every card, no wallet needed:
  ${CLI_NAME} best <merchant or category>          Rank all cards for one purchase.
  ${CLI_NAME} simulate groceries=600 dining=300    Best cards and pairs for a year of spending.

Save your cards (optional):
  ${CLI_NAME} cards [search words]                 Find cards and their ids.
  ${CLI_NAME} add <card-id> [--pick ...]           Add a card you hold.
  ${CLI_NAME} update <card-id> [--pick ...]        Change picks, label or activations.
  ${CLI_NAME} remove <card-id>                     Remove a card.
  ${CLI_NAME} memberships [names...]               Show or set memberships (amazon-prime, costco).
  ${CLI_NAME} values [UR=1.5 ...]                  Show or set what your points are worth.

Other commands:
  ${CLI_NAME} cheatsheet                           The best card for each category this quarter.
  ${CLI_NAME} todo [--ics file]                    What your cards need this quarter, with dates.
  ${CLI_NAME} import <statement.csv> --card <id>   Replay a statement against your wallet.
  ${CLI_NAME} offers [--cash | --points]           Rank welcome offers on cards you don't have.
  ${CLI_NAME} mcp                                  Run the MCP server over stdio, for AI assistants.
  Add --help to any command for its options.

Options:
  --online, --in-store   How you're paying. Default: inferred from the merchant.
  --valuation <profile>  flat (${profileText('flat')}) or points-heavy (${profileText('points-heavy')}),
                         instead of your saved point values.
                         Default: the values in your wallet.
  --all                  List every card, not just the top three.
  --json                 Print the full recommendation as JSON.
  --date <YYYY-MM-DD>    Purchase date. Default: today.
  --country <code>       Where you're paying. Default: US.
  --cards <ids>          Answer for these cards instead of your wallet, comma
                         separated: --cards amex-gold,chase-prime-visa.
  --member <name>        A membership you have, in place of the saved ones.
  --category <id>        For a merchant earnrate doesn't know: its category,
                         e.g. grocery.supermarket. Ignored for known merchants.
  --llm, --no-llm        Ask Claude to classify merchants earnrate doesn't know.
                         Off unless you pass --llm or set ${LLM_ENV_VAR}=on.
  -h, --help             Show this help.
  -v, --version          Show the version.

Wallet: $${WALLET_ENV_VAR}, or ~/${CONFIG_DIR}/wallet.yaml.

Claude lookups use your own key (ANTHROPIC_API_KEY) and send only the
merchant text you typed, never amounts or cards. Results are saved in
~/${CONFIG_DIR}/merchant-cache.json (or $${MERCHANT_CACHE_ENV_VAR}), so each merchant is
looked up once. ${LLM_MODEL_ENV_VAR} picks the model (default ${DEFAULT_LLM_MODEL}).
${LLM_MAX_CALLS_ENV_VAR} caps calls per session (default ${String(DEFAULT_MAX_CALLS)}).
`

export const USAGE_ERROR = 2
export const RUNTIME_ERROR = 1

const EXAMPLE_WALLET = fileURLToPath(
  new URL('../../wallet.example.yaml', import.meta.url),
)

export function displayPath(file: string): string {
  const home = homedir()
  return file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file
}

// The cards to answer for: those named with --cards, else the wallet file.
// 'none' means no cards saved or named, which answers from every card.
// Named cards use the saved memberships (unless --member names some) and the
// saved point values, as the MCP tools do.
export async function cardsToUse(
  catalog: Catalog,
  file: string,
  io: Io,
  named: { cards: string[] | null; members: string[] },
): Promise<Wallet | 'none' | null> {
  const problem = membershipProblem(catalog, named.members)
  if (problem !== null) {
    io.stderr(`${problem}\n`)
    return null
  }
  if (named.cards !== null) {
    const saved = await savedSettings(io)
    const wallet = walletFromCards(
      catalog,
      {
        cards: named.cards.map((id) => ({ id })),
        memberships:
          named.members.length > 0 ? named.members : saved.memberships,
      },
      io.today,
    )
    if (typeof wallet === 'string') {
      io.stderr(`${wallet}\n`)
      return null
    }
    return { ...wallet, valuations: saved.valuations }
  }
  try {
    await access(file)
  } catch {
    return 'none'
  }
  const loaded = await readWallet(file, io)
  if (!loaded) return null
  const problems = walletProblems(loaded, catalog)
  if (problems.length > 0) {
    io.stderr(
      `Your wallet at ${displayPath(file)} has problems:\n${problems.map((p) => `  - ${p}\n`).join('')}`,
    )
    return null
  }
  return loaded.cards.length === 0 ? 'none' : loaded
}

export const NO_WALLET_HINT = `These are every card earnrate knows. For the best of your own cards, name them with --cards amex-gold,chase-prime-visa, or save them: ${CLI_NAME} add <card-id> (${CLI_NAME} cards finds ids).`

// The point values and memberships saved in the wallet, which every answer
// uses unless --valuation or --member says otherwise. No wallet, or one that
// can't be read, has none.
export async function savedSettings(
  io: Io,
): Promise<Pick<Wallet, 'valuations' | 'memberships'>> {
  try {
    const { valuations, memberships } = await loadWallet(walletPath(io.env))
    return { valuations, memberships }
  } catch {
    return { valuations: {}, memberships: [] }
  }
}

export async function readWallet(file: string, io: Io): Promise<Wallet | null> {
  try {
    return await loadWallet(file)
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      io.stderr(
        `No wallet at ${displayPath(file)} yet. Add the cards you hold:\n  ${CLI_NAME} cards sapphire          find a card's id\n  ${CLI_NAME} add chase-sapphire-preferred\nOr start from the example: mkdir -p ${displayPath(path.dirname(file))} && cp ${displayPath(EXAMPLE_WALLET)} ${displayPath(file)}\nOr set ${WALLET_ENV_VAR} to your wallet's path.\n`,
      )
    } else {
      io.stderr(
        `Couldn't read your wallet:\n${e instanceof Error ? e.message : String(e)}\n`,
      )
    }
    return null
  }
}

export async function run(argv: string[], io: Io): Promise<number> {
  if (argv[0] === 'import') return runImport(argv.slice(1), io)
  if (argv[0] === 'offers') return runOffers(argv.slice(1), io)
  if (argv[0] === 'best') return runBest(argv.slice(1), io)
  if (argv[0] === 'cheatsheet') return runCheatSheet(argv.slice(1), io)
  if (argv[0] === 'todo') return runTodo(argv.slice(1), io)
  if (argv[0] === 'simulate') return runSimulate(argv.slice(1), io)
  const command = argv[0]
  if (command !== undefined && Object.hasOwn(WALLET_HELP, command)) {
    return runWalletCommand(
      command as keyof typeof WALLET_HELP,
      argv.slice(1),
      io,
    )
  }
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
    io.stdout(`${CLI_NAME} ${await packageVersion()}\n`)
    return 0
  }
  const args = parseCliArgs(argv)
  if (args.kind === 'help') {
    io.stdout(HELP)
    return 0
  }
  if (args.kind === 'error') {
    io.stderr(`${args.message}\nRun ${CLI_NAME} --help for usage.\n`)
    return USAGE_ERROR
  }
  const { options } = args

  const llmOn = options.llm ?? llmEnabled(io.env)

  const catalog = await loadCatalog()
  const loaded = await cardsToUse(catalog, walletPath(io.env), io, options)
  if (loaded === null) return RUNTIME_ERROR
  const purchase: Purchase = {
    merchant: options.merchant,
    amount: options.amount,
    channel: options.channel,
    date: options.date ?? io.today,
    country: options.country,
  }

  if (
    options.category !== null &&
    !catalog.categories.some((c) => c.id === options.category)
  ) {
    io.stderr(
      `Unknown category "${options.category}". Use one of: ${catalog.categories.map((c) => c.id).join(', ')}.\n`,
    )
    return USAGE_ERROR
  }

  let merchant: MerchantResolution = withCallerCategory(
    resolvePlace(catalog, purchase.merchant, purchase.channel),
    options.category,
  )
  const notices: string[] = []
  if (llmOn && merchant.source === 'none') {
    const opened = await openLlmSession({
      env: io.env,
      today: () => io.today,
      classifier: io.classifier,
    })
    if (opened.kind === 'error') {
      io.stderr(`${opened.message}\n`)
      return USAGE_ERROR
    }
    notices.push(...opened.notices)
    const resolved = await opened.session.resolve(
      catalog,
      purchase.merchant,
      purchase.channel,
    )
    merchant = resolved.merchant
    notices.push(...resolved.notices)
  }
  if (loaded === 'none') {
    const saved = await savedSettings(io)
    const explored = exploreCards(
      catalog,
      {
        merchant: purchase.merchant,
        category: null,
        amount: purchase.amount,
        channel: purchase.channel,
        date: purchase.date,
      },
      {
        filters: ALL_PERSONAL_CARDS,
        memberships:
          options.members.length > 0 ? options.members : saved.memberships,
        valuations: options.valuation
          ? VALUATION_PROFILES[options.valuation]
          : saved.valuations,
      },
      merchant,
    )
    if (options.json) {
      io.stdout(`${JSON.stringify(explored, null, 2)}\n`)
    } else {
      io.stdout(
        `${formatExploration(explored, catalog, options.all)}\n${NO_WALLET_HINT}\n`,
      )
    }
    for (const n of notices) io.stderr(`${n}\n`)
    return 0
  }
  const wallet = options.valuation
    ? withValuationProfile(loaded, options.valuation)
    : loaded
  const rec = recommend(catalog, wallet, purchase, merchant)

  if (options.json) {
    io.stdout(`${JSON.stringify(rec, null, 2)}\n`)
    for (const n of notices) io.stderr(`${n}\n`)
  } else {
    io.stdout(
      formatRecommendation(rec, purchase, {
        all: options.all,
        style: io.style ?? plain,
        notices,
      }),
    )
  }
  return 0
}
