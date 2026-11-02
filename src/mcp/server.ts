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

// The tools that read or change a saved wallet.
export const SAVED_WALLET_TOOLS = [
  'list_wallet',
  'record_purchase',
  'add_card',
  'update_card',
  'remove_card',
  'set_memberships',
  'set_point_values',
  'export_wallet',
  'import_wallet',
  'delete_wallet',
  'switch_wallet',
]

const SAVING: Record<ServerDeps['savedWallets'], string> = {
  file: 'Only if they want earnrate to remember their cards, track spending caps or welcome bonuses, or record purchases, save a wallet with add_card and the other wallet tools.',
  account:
    "The user signed in to earnrate when they connected it, to an anonymous saved wallet (no email or name). It may have no cards yet; answers then cover every card. Save cards with add_card only when the user agrees. The wallet can change outside this conversation when the user signs in again on earnrate's page, so read it with list_wallet rather than from memory. To use a different wallet or start a new one, call switch_wallet; the user then connects on earnrate's page with that wallet's recovery code. Never ask for the recovery code in the conversation; it's typed only on earnrate's page. To change the code, the user opens https://mcp.earnrate.dev/change-code. earnrate.dev and the earnrate command line keep their own separate wallets; export_wallet and import_wallet move one between them.",
}

const WHICH_WALLET: Record<ServerDeps['savedWallets'], string> = {
  file: "This server's saved wallet is a file on the user's computer.",
  account:
    "This server's saved wallet is hosted by earnrate, not a file on the user's computer.",
}

const instructions = (
  savedWallets: ServerDeps['savedWallets'],
) => `earnrate answers which credit card earns the most for a purchase, from each issuer's own terms. Anyone can use it without entering anything: with no cards given, best_card_for_purchase, best_cards_for, cheat_sheet, simulate_spending and compare_welcome_offers answer from every card earnrate knows, and that's a complete answer. Never require the user's cards, and don't ask what they spend unless the answer depends on it; simulate_spending assumes typical amounts when none are given and says so.

Personalizing is optional. If the user names their cards, pass them as \`cards\` (ids from search_cards) for that answer; nothing is saved. After answering, offer once to save those cards so earnrate remembers them, and save them with add_card only if the user says yes. ${SAVING[savedWallets]} When a card needs category picks, memberships like Amazon Prime, or activations, ask the user rather than guessing.

The wallet lists cards by product id, never card numbers; never ask for card numbers, expiry dates or security codes.

${WHICH_WALLET[savedWallets]} The earnrate extension on the user's computer and the hosted earnrate connector keep separate wallets with the same tools. If both are connected, say which wallet an answer comes from, and ask the user which one to use before saving or recording anything.`

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
