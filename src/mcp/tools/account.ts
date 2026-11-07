import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { emptyWallet, type AccountStore } from '../../data/store.ts'
import { parseWalletYaml, walletYaml } from '../../format/wallet-yaml.ts'
import { listed } from '../../engine/text.ts'
import { savedSettingsText } from '../../engine/wallet-summary.ts'
import type { Catalog } from '../../schema/catalog.ts'
import type { Wallet } from '../../schema/wallet.ts'
import { fail, type Context } from '../context.ts'
import { WalletChangeSchema } from '../schemas.ts'
import type { Handler } from './wallet.ts'

const cardsText = (n: number) => `${String(n)} ${n === 1 ? 'card' : 'cards'}`

// Everything a saved wallet holds, in words; empty when there's nothing.
const contentsOf = (catalog: Catalog, w: Wallet) => [
  ...(w.cards.length > 0
    ? [`${cardsText(w.cards.length)} (${w.cards.map((c) => c.id).join(', ')})`]
    : []),
  ...savedSettingsText(catalog, w),
]

const ImportInput = z.object({
  yaml: z
    .string()
    .min(1)
    .max(100_000)
    .describe('The wallet.yaml text, as the user gave it.'),
  replace: z
    .boolean()
    .optional()
    .describe(
      'true to replace what the wallet already holds, after the user confirms.',
    ),
})

export function importHandler(
  catalog: Catalog,
  store: AccountStore,
  ctx: Context,
): Handler<typeof ImportInput> {
  const contents = (w: Wallet) => contentsOf(catalog, w)
  return {
    input: ImportInput,
    run: async ({ yaml, replace }) => {
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
      const before = current === null ? [] : contents(current)
      if (before.length > 0 && replace !== true)
        return fail(
          `This would replace what's saved: ${listed(before)}. Ask the user, then call again with replace: true.`,
        )
      return ctx.changed(
        await store.replace(parsed),
        before.length > 0
          ? `Replaced what was saved (${listed(before)}) with the imported wallet: ${listed(contents(parsed))}.`
          : `Imported a wallet with ${listed(contents(parsed)) || 'nothing in it'}.`,
        { notes: false },
      )
    },
  }
}

// A saved wallet on the hosted server has no file to copy or delete, so
// these do it.
export function registerAccountTools(
  server: McpServer,
  catalog: Catalog,
  store: AccountStore,
  ctx: Context,
) {
  const contents = (w: Wallet) => contentsOf(catalog, w)
  const importWallet = importHandler(catalog, store, ctx)

  server.registerTool(
    'export_wallet',
    {
      title: 'Export the wallet',
      description:
        'The saved wallet as a wallet.yaml file: card ids, checkout labels, picks, activations, opening dates and anniversaries, memberships, point values, cap usage, welcome-bonus progress, yearly spending toward spend bonuses, and statement credits enrolled in, used and not used. earnrate.dev imports it, and the earnrate command line reads it saved as ~/.earnrate/wallet.yaml. Never card numbers.',
      inputSchema: z.object({}),
      outputSchema: z.object({ yaml: z.string() }),
      annotations: {
        title: 'Export the wallet',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
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
        'Replaces the saved wallet with a wallet.yaml from the earnrate command line or earnrate.dev, when the user pastes or attaches one. Wallet files only: never statements or card numbers. If anything is already saved (cards, memberships or point values), it refuses unless replace is true: confirm with the user first.',
      inputSchema: importWallet.input,
      outputSchema: WalletChangeSchema,
      annotations: {
        title: 'Import a wallet',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) => importWallet.run(args),
  )

  server.registerTool(
    'delete_wallet',
    {
      title: 'Delete the wallet',
      description:
        "Deletes the saved wallet and its recovery code now and for good, and signs out every app connected to it, this one included. earnrate.dev and the earnrate command line keep their own wallets and aren't affected. Only when the user asks to delete it: show it with list_wallet, offer export_wallet, and pass confirm, cards and saved only after the user confirms. It refuses if the wallet no longer holds what list_wallet showed, so a retried call can't delete a different wallet.",
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
        saved: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'How many memberships and point values list_wallet showed, counted together: 0 if none.',
          ),
      }),
      outputSchema: z.object({ deleted: z.boolean() }),
      annotations: {
        title: 'Delete the wallet',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cards, saved }) => {
      // An unreadable wallet can still be deleted: the user confirmed it.
      const loaded = await store.load().catch(() => undefined)
      if (loaded !== undefined) {
        const current = loaded ?? emptyWallet()
        const settings = savedSettingsText(catalog, current)
        if (current.cards.length !== cards || settings.length !== (saved ?? 0))
          return fail(
            `This saved wallet holds ${listed(contents(current)) || 'nothing'}, not what the user confirmed (${cardsText(cards)}${saved === undefined ? '' : ` and ${String(saved)} memberships and point values`}); it may have changed, or be a different wallet. Show it with list_wallet, confirm again, and pass cards: ${String(current.cards.length)} and saved: ${String(settings.length)}.`,
          )
      }
      await store.erase()
      return {
        content: [
          {
            type: 'text',
            text: "Deleted the saved wallet and its recovery code, and signed out every app connected to it, this one included. To keep using earnrate here, the user connects again on earnrate's page and starts a new wallet.",
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
        "Disconnects this app from its saved wallet so the user can connect a different one with its recovery code, or start a new one, on earnrate's page. Nothing is deleted. It also signs out anyone else connected to this wallet through the same app (another account the recovery code was shared with): say so before calling it. Use it when the user wants another wallet. Never ask for the recovery code in the conversation.",
      inputSchema: z.object({}),
      outputSchema: z.object({ disconnected: z.boolean() }),
      annotations: {
        title: 'Switch wallets',
        readOnlyHint: false,
        // It signs out this app's other connections to the wallet, which only
        // the recovery code undoes.
        destructiveHint: true,
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
            text: "Disconnected from this saved wallet; nothing was deleted. earnrate's sign-in page opens on the next earnrate request (or reconnect earnrate in the app's connector settings). There the user chooses \"Already have a wallet?\" and types the other wallet's recovery code, or starts a new wallet. Other accounts connected to this wallet through the same app are signed out too.",
          },
        ],
        structuredContent: { disconnected: true },
      }
    },
  )
}
