import { McpServer } from '@modelcontextprotocol/server'
import { MCP_SERVER_NAME } from '../brand.ts'
import type { AccountStore, WalletStore } from '../data/store.ts'
import type { LlmSession } from '../merchants/fallback.ts'
import type { Catalog } from '../schema/catalog.ts'
import { makeContext } from './context.ts'
import { makeInputs } from './inputs.ts'
import { registerAccountTools } from './tools/account.ts'
import { registerAnswerTools } from './tools/answers.ts'
import { registerWalletTools } from './tools/wallet.ts'

// Where a saved wallet lives: 'file' is the local YAML file, 'account' the
// hosted server's anonymous wallets, which add export, import and delete.
export type WalletSaving =
  | { savedWallets: 'file'; store: WalletStore }
  | { savedWallets: 'account'; store: AccountStore }

export type ServerDeps = {
  catalog: Catalog
  today: () => string // YYYY-MM-DD
  llm: LlmSession | null // shared across connections, so the call limit holds
  version: string
} & WalletSaving

// The tools that answer without a saved wallet.
export const ANSWER_TOOLS = [
  'best_card_for_purchase',
  'best_cards_for',
  'simulate_spending',
  'compare_welcome_offers',
  'cheat_sheet',
  'resolve_merchant',
  'search_cards',
]

// The tools that read or change a saved wallet. The hosted server asks for
// sign-in before running one.
export const SAVED_WALLET_TOOLS = [
  'list_wallet',
  'record_purchase',
  'add_card',
  'update_card',
  'remove_card',
  'set_memberships',
  'export_wallet',
  'import_wallet',
  'delete_wallet',
]

const SAVING: Record<ServerDeps['savedWallets'], string> = {
  file: 'Only if they want earnrate to remember their cards, track spending caps or welcome bonuses, or record purchases, save a wallet with add_card and the other wallet tools.',
  account:
    "Only if they want earnrate to remember their cards, track spending caps or welcome bonuses, or record purchases, save a wallet with add_card and the other wallet tools. Saved wallets are anonymous: the first wallet tool asks the user to open an earnrate page, where they start a wallet (it shows a recovery code to keep; no email or name) or reconnect one with their code. Never ask for the recovery code in the conversation; it's typed only on that page. To change the code, the user opens https://mcp.earnrate.dev/change-code.",
}

const instructions = (
  savedWallets: ServerDeps['savedWallets'],
) => `earnrate answers which credit card earns the most for a purchase, from each issuer's own terms. Anyone can use it without entering anything: with no cards given, best_card_for_purchase, best_cards_for, cheat_sheet, simulate_spending and compare_welcome_offers answer from every card earnrate knows, and that's a complete answer. Never require the user's cards, and don't ask what they spend unless the answer depends on it; simulate_spending assumes typical amounts when none are given and says so.

Personalizing is optional. If the user names their cards, pass them as \`cards\` (ids from search_cards) for that answer; nothing is saved. ${SAVING[savedWallets]} When a card needs category picks, memberships like Amazon Prime, or activations, ask the user rather than guessing.

The wallet lists cards by product id, never card numbers; never ask for card numbers, expiry dates or security codes.`

export function createEarnrateServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: deps.version },
    { instructions: instructions(deps.savedWallets) },
  )
  const ctx = makeContext(deps)
  const inputs = makeInputs(deps.catalog)
  registerAnswerTools(server, deps, ctx, inputs)
  registerWalletTools(server, deps, ctx, inputs)
  if (deps.savedWallets === 'account')
    registerAccountTools(server, deps.catalog, deps.store, ctx)
  return server
}
