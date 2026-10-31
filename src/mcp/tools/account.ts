import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { AccountStore } from '../../data/store.ts'
import { parseWalletYaml, walletYaml } from '../../format/wallet-yaml.ts'
import type { Catalog } from '../../schema/catalog.ts'
import { fail, type Context } from '../context.ts'
import { WalletChangeSchema } from '../schemas.ts'

// A saved wallet on the hosted server has no file to copy or delete, so
// these do it.
export function registerAccountTools(
  server: McpServer,
  catalog: Catalog,
  store: AccountStore,
  ctx: Context,
) {
  server.registerTool(
    'export_wallet',
    {
      title: 'Export the wallet',
      description:
        'The saved wallet as a wallet.yaml file the earnrate command line and earnrate.dev can import: card ids, picks, activations, memberships, cap usage and bonus progress. Never card numbers.',
      inputSchema: z.object({}),
      outputSchema: z.object({ yaml: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const w = await ctx.wallet()
      if (typeof w === 'string') return fail(w)
      const yaml = walletYaml(w)
      return {
        content: [{ type: 'text', text: yaml }],
        structuredContent: { yaml },
      }
    },
  )

  server.registerTool(
    'import_wallet',
    {
      title: 'Import a wallet',
      description:
        'Replaces the saved wallet with a wallet.yaml from the earnrate command line or earnrate.dev, when the user pastes or attaches one. Wallet files only: never statements or card numbers. Confirm with the user first if they already have cards saved.',
      inputSchema: z.object({
        yaml: z
          .string()
          .min(1)
          .max(100_000)
          .describe('The wallet.yaml text, as the user gave it.'),
      }),
      outputSchema: WalletChangeSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ yaml }) => {
      const parsed = parseWalletYaml(yaml, catalog)
      if (typeof parsed === 'string') return fail(parsed)
      const count = parsed.cards.length
      return ctx.changed(
        await store.replace(parsed),
        `Imported a wallet with ${String(count)} ${count === 1 ? 'card' : 'cards'}.`,
        { notes: false },
      )
    },
  )

  server.registerTool(
    'delete_wallet',
    {
      title: 'Delete the wallet',
      description:
        'Deletes the saved wallet now and for good, and signs out every app using it. Only when the user asks to delete it; confirm first, and offer export_wallet to keep a copy.',
      inputSchema: z.object({}),
      outputSchema: z.object({ deleted: z.boolean() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      await store.erase()
      return {
        content: [
          {
            type: 'text',
            text: 'Deleted the saved wallet. Answers now cover every card, or the cards named in the conversation.',
          },
        ],
        structuredContent: { deleted: true },
      }
    },
  )
}
