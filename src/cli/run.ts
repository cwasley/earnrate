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
import { withValuationProfile } from '../engine/profiles.ts'
import { recommend } from '../engine/recommend.ts'
import type { MerchantResolution, Purchase } from '../engine/types.ts'
import { DEFAULT_LLM_MODEL } from '../merchants/anthropic.ts'
import type { Classifier } from '../merchants/classifier.ts'
import { DEFAULT_MAX_CALLS } from '../merchants/fallback.ts'
import { llmEnabled, openLlmSession } from '../merchants/from-env.ts'
import { resolveMerchant, withCallerCategory } from '../merchants/resolve.ts'
import type { Wallet } from '../schema/wallet.ts'
import { packageVersion } from '../version.ts'
import { parseCliArgs } from './args.ts'
import { runImport } from './import.ts'
import { runOffers } from './offers.ts'
import { runWalletCommand, WALLET_HELP } from './wallet.ts'
import { formatRecommendation, plain, type Style } from './format.ts'

export type Io = {
  env: NodeJS.ProcessEnv
  today: string // YYYY-MM-DD
  stdout: (text: string) => void
  stderr: (text: string) => void
  style?: Style
  classifier?: Classifier // replaces the Anthropic classifier in tests
}

export const HELP = `Usage: ${CLI_NAME} <merchant> [amount] [options]

Picks the card in your wallet that earns the most at a merchant, and says why.

Examples:
  ${CLI_NAME} whole foods 80
  ${CLI_NAME} costco --in-store
  ${CLI_NAME} delta.com 450 --valuation points-heavy

Set up your wallet:
  ${CLI_NAME} cards [search words]                 Find cards and their ids.
  ${CLI_NAME} add <card-id> [--pick ...]           Add a card you hold.
  ${CLI_NAME} update <card-id> [--pick ...]        Change picks, label or activations.
  ${CLI_NAME} remove <card-id>                     Remove a card.
  ${CLI_NAME} memberships [names...]               Show or set memberships (amazon-prime).

Other commands:
  ${CLI_NAME} import <statement.csv> --card <id>   Replay a statement against your wallet.
  ${CLI_NAME} offers [--cash | --points]           Rank welcome offers on cards you don't have.
  ${CLI_NAME} mcp                                  Run the MCP server over stdio, for AI agents.
  Add --help to any command for its options.

Options:
  --online, --in-store   How you're paying. Default: inferred from the merchant.
  --valuation <profile>  flat (points at 1¢) or points-heavy (MR and UR at 1.7¢).
                         Default: the values in your wallet.
  --all                  List every card, not just the top three.
  --json                 Print the full recommendation as JSON.
  --date <YYYY-MM-DD>    Purchase date. Default: today.
  --country <code>       Where you're paying. Default: US.
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

  const file = walletPath(io.env)
  const loaded = await readWallet(file, io)
  if (!loaded) return RUNTIME_ERROR
  const catalog = await loadCatalog()
  const problems = walletProblems(loaded, catalog)
  if (problems.length > 0) {
    io.stderr(
      `Your wallet at ${displayPath(file)} has problems:\n${problems.map((p) => `  - ${p}\n`).join('')}`,
    )
    return RUNTIME_ERROR
  }

  const wallet = options.valuation
    ? withValuationProfile(loaded, options.valuation)
    : loaded
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
    resolveMerchant(catalog, purchase.merchant, purchase.channel),
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
