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
        'Replaces the saved wallet with a wallet.yaml from the earnrate command line or earnrate.dev, when the user pastes or attaches one. Wallet files only: never statements or card numbers. If cards are already saved, it refuses unless replace is true: confirm with the user first.',
      inputSchema: z.object({
        yaml: z
          .string()
          .min(1)
          .max(100_000)
          .describe('The wallet.yaml text, as the user gave it.'),
        replace: z
          .boolean()
          .optional()
          .describe(
            'true to replace a wallet that already has cards, after the user confirms.',
          ),
      }),
      outputSchema: WalletChangeSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ yaml, replace }) => {
      const parsed = parseWalletYaml(yaml, catalog)
      if (typeof parsed === 'string') return fail(parsed)
      let current
      try {
        current = await store.load()
      } catch (e) {
        if (replace !== true)
          return fail(
            `Couldn't read the saved wallet to check what it holds (${e instanceof Error ? e.message : String(e)}). Ask the user, then call again with replace: true to overwrite it.`,
          )
        current = null
      }
      if (current !== null && current.cards.length > 0 && replace !== true)
        return fail(
          `This would replace the ${String(current.cards.length)} ${current.cards.length === 1 ? 'card' : 'cards'} already saved (${current.cards.map((c) => c.id).join(', ')}). Ask the user, then call again with replace: true.`,
        )
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
        "Deletes the saved wallet and its recovery code now and for good, and signs out every Claude app connected to it, this one included. earnrate.dev and the earnrate command line keep their own wallets and aren't affected. Only when the user asks to delete it: show it with list_wallet, offer export_wallet, and pass confirm and cards only after the user confirms. It refuses if the wallet no longer holds that many cards, so a retried call can't delete a different wallet.",
      inputSchema: z.object({
        confirm: z
          .literal(true)
          .describe('true, only after the user confirms the deletion.'),
        cards: z
          .number()
          .int()
          .nonnegative()
          .describe(
            'How many cards the wallet held when the user confirmed, from list_wallet: 0 for an empty wallet.',
          ),
      }),
      outputSchema: z.object({ deleted: z.boolean() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cards }) => {
      // An unreadable wallet can still be deleted: the user confirmed it.
      const current = await store.load().catch(() => undefined)
      const held = current === undefined ? cards : (current?.cards.length ?? 0)
      if (held !== cards)
        return fail(
          `This saved wallet holds ${String(held)} ${held === 1 ? 'card' : 'cards'}, not ${String(cards)}, so it isn't the wallet the user confirmed (it may have been deleted and a new one connected). Show it with list_wallet and confirm again.`,
        )
      await store.erase()
      return {
        content: [
          {
            type: 'text',
            text: "Deleted the saved wallet and its recovery code, and signed out every Claude app connected to it, this one included. To keep using earnrate here, the user connects again on earnrate's page and starts a new wallet.",
          },
        ],
        structuredContent: { deleted: true },
      }
    },
  )

  server.registerTool(
    'switch_wallet',
    {
      title: 'Switch wallets',
      description:
        "Disconnects this app from its saved wallet so the user can connect a different one with its recovery code, or start a new one, on earnrate's page. Nothing is deleted. Use it when the user wants another wallet. Never ask for the recovery code in the conversation.",
      inputSchema: z.object({}),
      outputSchema: z.object({ disconnected: z.boolean() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      await store.disconnect()
      return {
        content: [
          {
            type: 'text',
            text: "Disconnected from this saved wallet; nothing was deleted. earnrate's sign-in page opens on the next earnrate request (or reconnect earnrate in the app's connector settings). There the user chooses \"Already have a wallet?\" and types the other wallet's recovery code, or starts a new wallet. Other Claude accounts connected to this wallet through the same app are signed out too.",
          },
        ],
        structuredContent: { disconnected: true },
      }
    },
  )
}
