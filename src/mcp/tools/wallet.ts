import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { membershipsFor, needsAnniversary } from '../../engine/setup.ts'
import { money, words } from '../../engine/text.ts'
import { walletSummary } from '../../engine/wallet-summary.ts'
import { formatBooking, formatWalletSummary } from '../../format/wallet.ts'
import { fail, type Context } from '../context.ts'
import {
  CardChange,
  CardId,
  cardInput,
  ChannelInput,
  DateInput,
  Merchant,
  type makeInputs,
} from '../inputs.ts'
import {
  RecordResultSchema,
  WalletChangeSchema,
  WalletSummarySchema,
} from '../schemas.ts'
import type { ServerDeps } from '../server.ts'

const WRITE = { readOnlyHint: false, openWorldHint: false }

// What update_card changed, so the reply confirms the values it saved.
function changes(args: z.infer<typeof CardChange>): string[] {
  const out: string[] = []
  for (const [choice, options] of Object.entries(args.picks ?? {}))
    out.push(`${words(choice)} picks: ${options.map(words).join(', ')}`)
  if (args.checkoutLabel === null) out.push('checkout name cleared')
  else if (args.checkoutLabel !== undefined)
    out.push(`checkout name "${args.checkoutLabel}"`)
  if (args.anniversary !== undefined)
    out.push(`anniversary ${args.anniversary}`)
  if (args.activated !== undefined)
    out.push(
      args.activated.length === 0
        ? 'nothing activated'
        : `activated: ${args.activated.join(', ')}`,
    )
  for (const [key, spent] of Object.entries(args.capSpent ?? {}))
    out.push(`${money(spent)} already spent on ${key} this period`)
  if (args.bonus === null) out.push('welcome bonus no longer tracked')
  else if (args.bonus !== undefined)
    out.push(
      `welcome bonus tracked from ${args.bonus.opened}, ${money(args.bonus.spent ?? 0)} spent so far`,
    )
  return out
}

// The tools that read or change a saved wallet.
export function registerWalletTools(
  server: McpServer,
  deps: ServerDeps,
  ctx: Context,
  inputs: ReturnType<typeof makeInputs>,
) {
  const { catalog, store } = deps

  server.registerTool(
    'list_wallet',
    {
      title: 'List wallet',
      description:
        "Lists the user's cards: checkout label, network, rewards currency and its value, spending caps with how much is left this period, chosen bonus categories (and whether they're current), welcome-bonus progress, which stores a store card works at, and when each card's data was last verified.",
      outputSchema: WalletSummarySchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const read = await ctx.readableWallet()
      if (typeof read === 'string') return fail(read)
      const summary = walletSummary(catalog, read.wallet, deps.today())
      return {
        content: [
          { type: 'text', text: read.start ?? formatWalletSummary(summary) },
        ],
        structuredContent: summary,
      }
    },
  )

  server.registerTool(
    'record_purchase',
    {
      title: 'Record a purchase',
      description:
        "Records a purchase the user has already made, so spending caps and welcome-bonus progress stay accurate for future recommendations. It updates the user's saved wallet. Only call it after the purchase has happened, and only once per purchase: calling it twice counts the spend twice. Purchases with no cap and no open welcome bonus are acknowledged and nothing is written.",
      inputSchema: z.object({
        cardId: z
          .string()
          .min(1)
          .describe(
            'The card used, as a cardId from list_wallet or best_card_for_purchase.',
          ),
        merchant: Merchant,
        amount: z.number().positive().describe('Amount spent in US dollars.'),
        channel: ChannelInput,
        date: DateInput,
        category: inputs.CategoryInput,
      }),
      outputSchema: RecordResultSchema,
      annotations: {
        ...WRITE,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: deps.llm !== null,
      },
    },
    async ({ cardId, merchant, amount, channel, date, category }) => {
      const w = await ctx.wallet()
      if (typeof w === 'string') return fail(w)
      if (!w.cards.some((c) => c.id === cardId))
        return fail(
          `"${cardId}" isn't in the wallet. Cards: ${w.cards.map((c) => c.id).join(', ')}.`,
        )
      const purchase = {
        cardId,
        merchant,
        amount,
        channel: channel ?? null,
        date: date ?? deps.today(),
      }
      const resolved = await ctx.resolve(
        merchant,
        purchase.channel,
        category ?? null,
      )
      if (resolved.merchant.source === 'none')
        return fail(
          `earnrate doesn't recognize "${merchant}", so it can't tell which caps this purchase counts toward. Nothing was recorded. Call record_purchase again with category if you can tell what kind of business it is (a restaurant, a grocery store, a gas station); otherwise ask the user.`,
        )
      const result = await store.record(purchase, resolved.merchant)
      if (!result.ok) return fail(`Couldn't record it: ${result.error}`)
      const { cap: booking, bonus } = result
      const output =
        booking || bonus
          ? {
              recorded: true,
              booking,
              bonus,
              message: formatBooking(amount, cardId, booking, bonus),
            }
          : {
              recorded: false,
              booking: null,
              bonus: null,
              message: `Nothing to track: ${cardId} has no spending cap or open welcome bonus for this purchase, so the wallet wasn't changed.`,
            }
      return {
        content: [
          {
            type: 'text',
            text: [output.message, ...resolved.notices].join('\n'),
          },
        ],
        structuredContent: output,
      }
    },
  )

  server.registerTool(
    'add_card',
    {
      title: 'Add a card',
      description:
        "Adds a card the user holds to their wallet by its id from search_cards, creating the wallet if there isn't one. The reply says what the card still needs (category picks, memberships, activations); ask the user about those. Stores only the card's product id and settings, never card numbers.",
      inputSchema: CardChange,
      outputSchema: WalletChangeSchema,
      annotations: { ...WRITE, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const result = await store.addCard(cardInput(args), deps.today())
      const started =
        !result.ok || !result.created
          ? ''
          : deps.savedWallets === 'account'
            ? ', the first card in your saved wallet'
            : `, starting a new wallet at ${store.where}`
      return ctx.changed(
        result,
        `Added ${ctx.cardName(args.cardId)} (${args.cardId})${started}.`,
      )
    },
  )

  server.registerTool(
    'update_card',
    {
      title: 'Update a card',
      description:
        'Changes settings on a card already in the wallet: its category picks for this period, checkout label, anniversary or activated categories. Picks replace the saved ones in each choice group you set (other groups are kept) for the current period. Use it when the user picks new categories, such as each quarter on U.S. Bank Cash+.',
      inputSchema: CardChange,
      outputSchema: WalletChangeSchema,
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      const what = changes(args)
      const card = catalog.cards.find((c) => c.id === args.cardId)
      const unused =
        args.anniversary !== undefined && card && !needsAnniversary(card)
          ? " None of its caps reset on the account anniversary, so earnrate doesn't use it."
          : ''
      return ctx.changed(
        await store.updateCard(cardInput(args), deps.today()),
        `Updated ${ctx.cardName(args.cardId)} (${args.cardId})${what.length > 0 ? `: ${what.join('; ')}` : ''}.${unused}`,
      )
    },
  )

  server.registerTool(
    'remove_card',
    {
      title: 'Remove a card',
      description:
        "Removes a card from the wallet, with its tracked cap usage and bonus progress. Only when the user says they no longer have it or don't want it considered.",
      inputSchema: z.object({ cardId: CardId }),
      outputSchema: WalletChangeSchema,
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    async ({ cardId }) =>
      ctx.changed(
        await store.removeCard(cardId),
        `Removed ${ctx.cardName(cardId)} (${cardId}).`,
        { notes: false },
      ),
  )

  server.registerTool(
    'set_memberships',
    {
      title: 'Set memberships',
      description:
        "Sets the memberships that unlock some cards' rates, such as amazon-prime for Prime Visa's 5% or a Bank of America Preferred Rewards tier, and costco for a Costco membership (so spending answers don't count its cost against Costco Anywhere). Replaces the whole list, so include the ones to keep.",
      inputSchema: z.object({ memberships: inputs.AllMemberships }),
      outputSchema: WalletChangeSchema,
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    async ({ memberships }) => {
      const result = await store.setMemberships(memberships)
      const used = new Set(
        (result.ok ? result.wallet.cards : []).flatMap((held) => {
          const card = catalog.cards.find((c) => c.id === held.id)
          return card ? membershipsFor(card) : []
        }),
      )
      const unused = memberships.filter((m) => !used.has(m))
      return ctx.changed(
        result,
        `${
          memberships.length > 0
            ? `Memberships set to ${memberships.join(', ')}.`
            : 'Memberships cleared.'
        }${unused.length > 0 ? ` ${unused.join(', ')} ${unused.length === 1 ? "doesn't" : "don't"} change any saved card's rates yet; kept for cards that use ${unused.length === 1 ? 'it' : 'them'}.` : ''}`,
        { notes: false },
      )
    },
  )
}
