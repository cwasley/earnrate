import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { Catalog } from '../../schema/catalog.ts'
import { membershipsFor, needsAnniversary } from '../../engine/setup.ts'
import {
  choiceName,
  currencyLabel,
  money,
  shortDate,
  words,
} from '../../engine/text.ts'
import { profileText, VALUATION_PROFILES } from '../../engine/profiles.ts'
import { optionName, walletSummary } from '../../engine/wallet-summary.ts'
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

// "Saved wallet started 4 minutes ago": relative, since the server doesn't
// know the user's time zone, and precise enough to tell apart two wallets
// started the same day.
function startedText(started: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(started)) / 60_000)
  const ago =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${String(minutes)} minute${minutes === 1 ? '' : 's'} ago`
        : minutes < 48 * 60
          ? `${String(Math.floor(minutes / 60))} hour${minutes < 120 ? '' : 's'} ago`
          : `on ${shortDate(started.slice(0, 10))}`
  return `Saved wallet started ${ago}.`
}

// What update_card changed, so the reply confirms the values it saved.
function changes(catalog: Catalog, args: z.infer<typeof CardChange>): string[] {
  const card = catalog.cards.find((c) => c.id === args.cardId)
  const out: string[] = []
  for (const [choice, options] of Object.entries(args.picks ?? {}))
    out.push(
      `${choiceName(choice)} picks: ${options.map((o) => (card ? optionName(catalog, card, choice, o) : words(o))).join('; ')}`,
    )
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
        "Lists the user's cards: checkout label, network, rewards currency and its value, spending caps with how much is left this period, chosen bonus categories (and whether they're current), welcome-bonus progress, which stores a store card works at, when each card's data was last verified, the point values the user saved, and (for the hosted wallet) when it was started.",
      outputSchema: WalletSummarySchema,
      annotations: {
        title: 'List wallet',
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const read = await ctx.readableWallet()
      if (typeof read === 'string') return fail(read)
      const started =
        deps.savedWallets === 'account' ? await deps.store.started() : null
      const summary = {
        ...walletSummary(catalog, read.wallet, deps.today()),
        started,
      }
      const when =
        started === null ? '' : `${startedText(started, Date.now())}\n`
      return {
        content: [
          {
            type: 'text',
            text: `${when}${read.start === null ? '' : `${read.start}\n`}${formatWalletSummary(summary)}`,
          },
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
        "Records a purchase the user has already made, so spending caps and welcome-bonus progress stay accurate for future recommendations. It updates the user's saved wallet. Only call it after the purchase has happened, and only once per purchase: calling it twice counts the spend twice. Purchases with no cap and no open welcome bonus are acknowledged and nothing is written. For a merchant earnrate doesn't recognize it asks for category first, so caps aren't missed.",
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
        category: inputs.RecordCategoryInput,
      }),
      outputSchema: RecordResultSchema,
      annotations: {
        title: 'Record a purchase',
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
          `earnrate doesn't recognize "${merchant}", so it can't tell which caps this purchase counts toward. Nothing was recorded. Call record_purchase again with category if you can tell what kind of business it is (a restaurant, a grocery store, a gas station), or ask the user. If nobody knows, category "other" records it toward a welcome bonus without touching any cap.`,
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
      annotations: {
        title: 'Add a card',
        ...WRITE,
        destructiveHint: false,
        idempotentHint: false,
      },
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
        'Changes settings on a card already in the wallet: its category picks for this period, checkout label, anniversary, activated categories, cap spending so far (capSpent) or a welcome bonus to track. Picks replace the saved ones in each choice group you set (other groups are kept) for the current period. Use it when the user picks new categories, such as each quarter on U.S. Bank Cash+.',
      inputSchema: CardChange,
      outputSchema: WalletChangeSchema,
      annotations: {
        title: 'Update a card',
        ...WRITE,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async (args) => {
      const what = changes(catalog, args)
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
        "Removes a card from the wallet, with its tracked cap usage and bonus progress. Memberships and point values stay, even when the last card goes. Only when the user says they no longer have it or don't want it considered.",
      inputSchema: z.object({ cardId: CardId }),
      outputSchema: WalletChangeSchema,
      annotations: {
        title: 'Remove a card',
        ...WRITE,
        destructiveHint: true,
        idempotentHint: true,
      },
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
        "Sets the memberships that unlock some cards' rates, such as amazon-prime for Prime Visa's 5% or a Bank of America Preferred Rewards tier, and costco for a Costco membership (so spending answers don't count its cost against Costco Anywhere). Replaces the whole list, so include the ones to keep. It saves them even with no cards saved, and every answer then uses them.",
      inputSchema: z.object({ memberships: inputs.AllMemberships }),
      outputSchema: WalletChangeSchema,
      annotations: {
        title: 'Set memberships',
        ...WRITE,
        destructiveHint: true,
        idempotentHint: true,
      },
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

  server.registerTool(
    'set_point_values',
    {
      title: 'Set point values',
      description: `Saves what the user's points are worth to them, in cents per point, in their saved wallet; every answer then compares cards at those values unless a valuation profile is asked for. No saved cards are needed. Use it when the user says what their points are worth ("I value Chase points at 1.5¢") or that they transfer points to airlines and hotels (profile points-heavy). Values change only the currencies given; null goes back to earnrate's default. Currencies: ${catalog.currencies.map((c) => c.id).join(', ')}.`,
      inputSchema: z.object({
        values: z
          .record(z.string(), z.number().nullable())
          .optional()
          .describe(
            'Cents per point by currency id, e.g. {"UR": 1.5, "MR": 1.6}. null goes back to the default.',
          ),
        profile: z
          .enum(['flat', 'points-heavy'])
          .optional()
          .describe(
            `A preset: flat (${profileText('flat')}) or points-heavy (${profileText('points-heavy')}). Values given too win over it.`,
          ),
      }),
      outputSchema: WalletChangeSchema,
      annotations: {
        title: 'Set point values',
        ...WRITE,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ values, profile }) => {
      const changes: Record<string, number | null> = {
        ...(profile ? VALUATION_PROFILES[profile] : {}),
        ...(values ?? {}),
      }
      if (Object.keys(changes).length === 0)
        return fail('Give values (cents per point by currency) or a profile.')
      const result = await store.setValuations(changes)
      const set = Object.entries(changes).map(([id, cents]) =>
        cents === null
          ? `${currencyLabel(catalog, id)} back to the default`
          : `${currencyLabel(catalog, id)} at ${String(cents)}¢`,
      )
      return ctx.changed(result, `Point values: ${set.join(', ')}.`, {
        notes: false,
      })
    },
  )
}
