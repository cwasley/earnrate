import { z } from 'zod'
import type { AccountStore } from '../data/store.ts'
import type { Catalog } from '../schema/catalog.ts'
import { makeContext } from './context.ts'
import { makeInputs } from './inputs.ts'
import type { ServerDeps } from './server.ts'
import { importHandler } from './tools/account.ts'
import { walletHandlers, walletListing, type Handler } from './tools/wallet.ts'

// The changes earnrate.dev can make to a synced wallet, by MCP tool name.
// import_wallet replaces it all, with the tool's own confirmation.
export const WALLET_CHANGES = [
  'add_card',
  'update_card',
  'remove_card',
  'set_memberships',
  'set_point_values',
  'record_purchase',
  'import_wallet',
] as const
export type WalletChangeName = (typeof WALLET_CHANGES)[number]

export type WalletApiDeps = {
  catalog: Catalog
  store: AccountStore
  today: () => string
}

export type ApiAnswer = { status: number; body: Record<string, unknown> }

const ChangeRequest = z.object({
  tool: z.enum(WALLET_CHANGES),
  input: z.record(z.string(), z.unknown()).optional(),
})

// The hosted wallet over plain HTTP: reads give what list_wallet gives, and
// each change runs the MCP tool's own handler, so the rules and refusals
// can't drift between earnrate.dev and Claude.
export function walletApi(deps: WalletApiDeps) {
  const server: ServerDeps = {
    ...deps,
    savedWallets: 'account',
    llm: null,
    version: '',
  }
  const ctx = makeContext(server)
  const handlers: Record<WalletChangeName, Handler<z.ZodType>> = {
    ...walletHandlers(server, ctx, makeInputs(deps.catalog)),
    import_wallet: importHandler(deps.catalog, deps.store, ctx),
  }

  async function read(): Promise<ApiAnswer> {
    const found = await walletListing(server, ctx)
    if (typeof found === 'string')
      return { status: 422, body: { error: found } }
    return {
      status: 200,
      body: { wallet: found.wallet, summary: found.summary },
    }
  }

  // `body` is the request's parsed JSON: {"tool": "add_card", "input": {...}}.
  async function change(body: unknown): Promise<ApiAnswer & { tool?: string }> {
    const request = ChangeRequest.safeParse(body)
    if (!request.success)
      return {
        status: 400,
        body: {
          error: `Send one change as {"tool": ..., "input": {...}}, where tool is one of ${WALLET_CHANGES.join(', ')}.`,
        },
      }
    const { tool, input } = request.data
    const handler = handlers[tool]
    const args = handler.input.safeParse(input ?? {})
    if (!args.success)
      return {
        status: 400,
        tool,
        body: {
          error: `Invalid input for ${tool}: ${z.prettifyError(args.error)}`,
        },
      }
    const result = await handler.run(args.data)
    const text = result.content.map((c) => c.text).join('\n')
    if (result.isError) return { status: 422, tool, body: { error: text } }
    const after = await read()
    return {
      status: after.status,
      tool,
      body:
        after.status === 200 ? { message: text, ...after.body } : after.body,
    }
  }

  return { read, change }
}
