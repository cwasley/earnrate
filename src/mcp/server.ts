import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { MCP_SERVER_NAME } from '../brand.ts'
import { formatCardInfo, formatNotes } from '../cli/cards.ts'
import { formatRecommendation } from '../cli/format.ts'
import { formatOffers } from '../cli/offers.ts'
import { walletProblems } from '../data/integrity.ts'
import { loadWallet, type Catalog } from '../data/load.ts'
import {
  withWalletLock,
  writeBonusSpent,
  writeCapBooking,
} from '../data/wallet-write.ts'
import {
  addCard,
  removeCard,
  setMemberships,
  updateCard,
  type CardInput,
  type SetupResult,
} from '../data/wallet-setup.ts'
import { bonusStatus, countsTowardBonus } from '../engine/bonus.ts'
import { compareOffers } from '../engine/offers.ts'
import { capBooking } from '../engine/record.ts'
import { recommend } from '../engine/recommend.ts'
import { knownMemberships, searchCards } from '../engine/setup.ts'
import type { Channel, MerchantResolution } from '../engine/types.ts'
import { walletSummary } from '../engine/wallet-summary.ts'
import type { LlmSession } from '../merchants/fallback.ts'
import { resolveMerchant, withCallerCategory } from '../merchants/resolve.ts'
import { IsoDate } from '../schema/common.ts'
import type { Wallet } from '../schema/wallet.ts'
import {
  CardSearchSchema,
  MerchantResolutionSchema,
  RecommendationSchema,
  OfferComparisonSchema,
  RecordResultSchema,
  WalletChangeSchema,
  WalletSummarySchema,
} from './schemas.ts'

export type ServerDeps = {
  catalog: Catalog
  walletFile: string
  today: () => string // YYYY-MM-DD
  llm: LlmSession | null // shared across connections, so the call limit holds
  version: string
}

const Merchant = z
  .string()
  .min(1)
  .describe(
    'Merchant name or web address as the user would say it or see it, e.g. "Whole Foods" or "delta.com".',
  )
const ChannelInput = z
  .enum(['online', 'in_store'])
  .optional()
  .describe(
    'How the purchase is made. Omit if unknown; the answer says what it assumed.',
  )
const DateInput = IsoDate.optional().describe(
  'Purchase date, YYYY-MM-DD. Defaults to today.',
)

const INSTRUCTIONS = `earnrate picks which of the user's credit cards earns the most for a purchase. Its wallet lists the cards they hold by product id, never card numbers; never ask for card numbers, expiry dates or security codes.

If a tool says there's no wallet yet, ask the user which cards they have, find each with search_cards, and add it with add_card. add_card and update_card reply with what a card still needs, such as category picks, memberships like Amazon Prime, or activated bonus categories. Ask the user about those and set them with update_card or set_memberships.`

const fail = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  isError: true,
})

const dollars = (n: number) =>
  `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`

export function createEarnrateServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: deps.version },
    { instructions: INSTRUCTIONS },
  )
  const { catalog } = deps

  // Read on every call, so edits to the wallet file apply without a restart.
  async function wallet(): Promise<Wallet | string> {
    let loaded: Wallet
    try {
      loaded = await loadWallet(deps.walletFile)
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
        return `There's no wallet yet (${deps.walletFile}). Ask the user which credit cards they have, find each one with search_cards, and add it with add_card.`
      }
      return `Couldn't read the wallet at ${deps.walletFile}: ${e instanceof Error ? e.message : String(e)}`
    }
    const problems = walletProblems(loaded, catalog)
    return problems.length > 0
      ? `The wallet at ${deps.walletFile} has problems:\n${problems.map((p) => `- ${p}`).join('\n')}`
      : loaded
  }

  // The caller's category is free and comes before the paid Claude fallback;
  // neither ever overrides a merchant earnrate already knows.
  async function resolve(
    merchant: string,
    channel: Channel | null,
    category: string | null,
  ): Promise<{ merchant: MerchantResolution; notices: string[] }> {
    const known = resolveMerchant(catalog, merchant, channel)
    if (known.source !== 'none' || category !== null || !deps.llm) {
      return { merchant: withCallerCategory(known, category), notices: [] }
    }
    return deps.llm.resolve(catalog, merchant, channel)
  }

  const ids = catalog.categories.map((c) => c.id) as [string, ...string[]]
  const CategoryInput = z
    .enum(ids)
    .optional()
    .describe(
      `Only for a merchant earnrate may not know, and only if you're confident what kind of business it is: its spending category, e.g. grocery.supermarket for a supermarket, dining for a restaurant, gas for a gas station. Ignored when earnrate knows the merchant. Leave it out if unsure. Categories: ${catalog.categories.map((c) => `${c.id} (${c.name})`).join(', ')}.`,
    )

  server.registerTool(
    'best_card_for_purchase',
    {
      title: 'Best card for a purchase',
      description:
        "Picks the card in the user's wallet that earns the most rewards for a purchase, and explains why. Call it before paying. `decision.cardId` is the pick and `decision.checkoutLabel` is how the card appears at checkout. Also returns every usable card ranked with reasons, cards the merchant won't take, the assumptions made, warnings, and when a different point valuation would change the pick. Never needs or returns card numbers.",
      inputSchema: z.object({
        merchant: Merchant,
        amount: z
          .number()
          .positive()
          .optional()
          .describe('Purchase amount in US dollars. Improves cap math.'),
        channel: ChannelInput,
        date: DateInput,
        category: CategoryInput,
      }),
      outputSchema: RecommendationSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: deps.llm !== null,
      },
    },
    async ({ merchant, amount, channel, date, category }) => {
      const w = await wallet()
      if (typeof w === 'string') return fail(w)
      const purchase = {
        merchant,
        amount: amount ?? null,
        channel: channel ?? null,
        date: date ?? deps.today(),
        country: 'US',
      }
      const resolved = await resolve(
        merchant,
        purchase.channel,
        category ?? null,
      )
      const rec = recommend(catalog, w, purchase, resolved.merchant)
      const output = {
        ...rec,
        warnings: [...rec.warnings, ...resolved.notices],
      }
      return {
        content: [
          { type: 'text', text: formatRecommendation(output, purchase) },
        ],
        structuredContent: output,
      }
    },
  )

  server.registerTool(
    'resolve_merchant',
    {
      title: 'Resolve a merchant',
      description:
        'Shows how earnrate identifies a merchant: its spend category, likely MCC, which card networks it takes, confidence, and whether that came from curated data, Claude, or nowhere. Use it to explain or double-check a recommendation.',
      inputSchema: z.object({
        merchant: Merchant,
        channel: ChannelInput,
        category: CategoryInput,
      }),
      outputSchema: MerchantResolutionSchema,
      annotations: { readOnlyHint: true, openWorldHint: deps.llm !== null },
    },
    async ({ merchant, channel, category }) => {
      const resolved = await resolve(
        merchant,
        channel ?? null,
        category ?? null,
      )
      const m = resolved.merchant
      const text = [
        `${m.resolvedName}: ${m.category}${m.likelyMcc === null ? '' : ` (MCC ${String(m.likelyMcc)})`}, ${m.confidence} confidence, from ${m.source}.`,
        ...(m.inference
          ? [`Claude's reasoning: ${m.inference.rationale}`]
          : []),
        ...resolved.notices,
      ].join('\n')
      return {
        content: [{ type: 'text', text }],
        structuredContent: m,
      }
    },
  )

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
      const w = await wallet()
      if (typeof w === 'string') return fail(w)
      const summary = walletSummary(catalog, w, deps.today())
      const lines = summary.cards.map((c) => {
        const caps = c.caps
          .filter((cap) => cap.remaining !== null)
          .map(
            (cap) =>
              `${cap.key} ${dollars(cap.spent)} of ${dollars(cap.amount)} used for ${cap.currentPeriod ?? ''}`,
          )
        const chosen = c.chosen
          ? `; chosen categories for ${c.chosen.period}${c.chosen.current ? '' : ' (out of date)'}`
          : ''
        const onlyAt = c.onlyAt ? `; works only at ${c.onlyAt.join(', ')}` : ''
        const rotation =
          c.rotationGap === null
            ? ''
            : `; rotating categories for ${c.rotationGap} not in earnrate yet`
        const b = c.bonus
        const bonus =
          b?.state === 'open' && b.spend !== null
            ? `; welcome bonus ${dollars(b.spent)} of ${dollars(b.spend)} spent, due ${b.deadline ?? ''}`
            : b
              ? `; welcome bonus ${b.state}`
              : ''
        return `- ${c.checkoutLabel ?? c.cardName} (${c.cardId}): ${c.currency} at ${String(c.centsPerUnit)}¢${caps.length > 0 ? `; ${caps.join(', ')}` : ''}${chosen}${rotation}${onlyAt}${bonus}`
      })
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: summary,
      }
    },
  )

  server.registerTool(
    'compare_welcome_offers',
    {
      title: 'Compare welcome offers',
      description:
        "Ranks the public welcome (sign-up) offers on cards the user doesn't have by first-year value: the bonus at the user's point values minus the first year's annual fee. Use it when the user asks which new card to get or which has the best sign-up bonus. It covers only the cards earnrate knows, offers vary by person, and each offer's note gives the issuer's eligibility rules; pass those caveats on. It doesn't account for what a card would earn on the user's spending.",
      inputSchema: z.object({
        kind: z
          .enum(['any', 'cash', 'points'])
          .optional()
          .describe(
            'cash: cash back cards only. points: points and miles cards only.',
          ),
        noAnnualFee: z
          .boolean()
          .optional()
          .describe('Only cards with no annual fee.'),
        business: z
          .boolean()
          .optional()
          .describe('Business cards instead of personal ones.'),
        includeHeld: z
          .boolean()
          .optional()
          .describe('Include cards already in the wallet.'),
      }),
      outputSchema: OfferComparisonSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const w = await wallet()
      if (typeof w === 'string') return fail(w)
      const comparison = compareOffers(
        catalog,
        w,
        {
          kind: args.kind ?? 'any',
          noAnnualFee: args.noAnnualFee ?? false,
          business: args.business ?? false,
          includeHeld: args.includeHeld ?? false,
        },
        deps.today(),
      )
      const currencyName = (id: string) =>
        catalog.currencies.find((c) => c.id === id)?.name ?? id
      return {
        content: [
          { type: 'text', text: formatOffers(comparison, currencyName, false) },
        ],
        structuredContent: comparison,
      }
    },
  )

  server.registerTool(
    'record_purchase',
    {
      title: 'Record a purchase',
      description:
        "Records a purchase the user has already made, so spending caps and welcome-bonus progress stay accurate for future recommendations. It updates the user's wallet file. Only call it after the purchase has happened, and only once per purchase: calling it twice counts the spend twice. Purchases with no cap and no open welcome bonus are acknowledged and nothing is written.",
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
        category: CategoryInput,
      }),
      outputSchema: RecordResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: deps.llm !== null,
      },
    },
    // Queued per wallet file: parallel calls would otherwise each read the
    // old usage and the last write would drop the others' spend.
    (args) =>
      withWalletLock(deps.walletFile, async () => {
        const { cardId, merchant, amount, channel, date, category } = args
        const w = await wallet()
        if (typeof w === 'string') return fail(w)
        if (!w.cards.some((c) => c.id === cardId)) {
          return fail(
            `"${cardId}" isn't in the wallet. Cards: ${w.cards.map((c) => c.id).join(', ')}.`,
          )
        }
        const purchase = {
          cardId,
          merchant,
          amount,
          channel: channel ?? null,
          date: date ?? deps.today(),
        }
        const resolved = await resolve(
          merchant,
          purchase.channel,
          category ?? null,
        )
        const booking = capBooking(catalog, w, purchase, resolved.merchant)
        const held = w.cards.find((c) => c.id === cardId)
        const status = held
          ? bonusStatus(catalog, w, held, purchase.date)
          : null
        const bonus =
          status &&
          status.spend !== null &&
          (status.remaining ?? 0) > 0 &&
          countsTowardBonus(status, purchase.date)
            ? {
                cardId,
                before: status.spent,
                after: Math.round((status.spent + amount) * 100) / 100,
                spend: status.spend,
                deadline: status.deadline,
              }
            : null
        if (!booking && !bonus) {
          const output = {
            recorded: false,
            booking: null,
            bonus: null,
            message: `Nothing to track: ${cardId} has no spending cap or open welcome bonus for this purchase, so the wallet wasn't changed.`,
          }
          return {
            content: [{ type: 'text', text: output.message }],
            structuredContent: output,
          }
        }
        try {
          if (booking) await writeCapBooking(deps.walletFile, booking)
          if (bonus) await writeBonusSpent(deps.walletFile, cardId, bonus.after)
        } catch (e) {
          return fail(
            `Couldn't record it: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
        const messages: string[] = []
        if (booking) {
          const left = Math.max(0, booking.capAmount - booking.after)
          messages.push(
            `Recorded ${dollars(amount)} on ${cardId} against "${booking.capKey}": ${dollars(booking.before)} → ${dollars(booking.after)} of ${dollars(booking.capAmount)} for ${booking.period}, ${dollars(left)} left.`,
          )
        }
        if (bonus) {
          const left = Math.max(0, bonus.spend - bonus.after)
          messages.push(
            left === 0
              ? `Welcome bonus spend met on ${cardId}: ${dollars(bonus.after)} of ${dollars(bonus.spend)}.`
              : `Welcome bonus on ${cardId}: ${dollars(bonus.after)} of ${dollars(bonus.spend)} spent, ${dollars(left)} to go by ${bonus.deadline ?? 'the deadline'}.`,
          )
        }
        const output = {
          recorded: true,
          booking,
          bonus,
          message: messages.join(' '),
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
      }),
  )

  const CardId = z
    .string()
    .min(1)
    .describe('The card id from search_cards, e.g. chase-sapphire-preferred.')
  const cardFields = {
    checkoutLabel: z
      .string()
      .min(1)
      .optional()
      .describe(
        'How the card appears at checkout or in a browser wallet, e.g. "Amex Gold". Optional.',
      ),
    picks: z
      .record(z.string(), z.array(z.string()).min(1))
      .optional()
      .describe(
        'For cards where the cardholder picks bonus categories: choice id → option ids, from search_cards, e.g. {"five-percent": ["tv-internet-streaming", "fast-food"]}. Saved for the current period. Ask the user; don\'t guess.',
      ),
    anniversary: z
      .string()
      .regex(/^\d{2}-\d{2}$/)
      .optional()
      .describe(
        "The account's anniversary as MM-DD, for cards whose cap resets on it.",
      ),
    activated: z
      .array(z.string())
      .optional()
      .describe(
        'Rule ids the user has activated with the issuer, such as rotating categories. Replaces the current list.',
      ),
  }

  // A card change reports what that card still needs; other changes don't.
  function changed(result: SetupResult, message: string, cardChange = true) {
    if (!result.ok) return fail(result.error)
    const output = {
      message,
      created: result.created,
      cardIds: result.wallet.cards.map((c) => c.id),
      memberships: result.wallet.memberships,
      notes: result.notes,
    }
    const text = [
      message,
      `Wallet: ${output.cardIds.join(', ')}.`,
      ...(cardChange ? [formatNotes(result.notes)] : []),
    ].join('\n')
    return {
      content: [{ type: 'text' as const, text }],
      structuredContent: output,
    }
  }

  const cardInput = (args: {
    cardId: string
    checkoutLabel?: string | undefined
    picks?: Record<string, string[]> | undefined
    anniversary?: string | undefined
    activated?: string[] | undefined
  }): CardInput => ({
    id: args.cardId,
    ...(args.checkoutLabel === undefined
      ? {}
      : { checkoutLabel: args.checkoutLabel }),
    ...(args.picks === undefined ? {} : { picks: args.picks }),
    ...(args.anniversary === undefined
      ? {}
      : { anniversary: args.anniversary }),
    ...(args.activated === undefined ? {} : { activated: args.activated }),
  })

  const cardName = (id: string) =>
    catalog.cards.find((c) => c.id === id)?.name ?? id

  server.registerTool(
    'search_cards',
    {
      title: 'Search cards',
      description:
        'Finds credit cards in earnrate\'s catalog by name or issuer, e.g. "sapphire", "amex gold" or "bofa". Returns each card\'s id (for add_card), network, annual fee, whether it\'s already in the wallet, and what it needs set up: category picks and their options, memberships, activations. Leave the query out to list every card. US cards only.',
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe('Card name or issuer, as the user said it.'),
      }),
      outputSchema: CardSearchSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      const held = await loadWallet(deps.walletFile).catch(() => null)
      const result = searchCards(catalog, query ?? '', held, deps.today())
      const header = result.exact
        ? ''
        : result.cards.length > 0
          ? 'No card matched every word. Closest:\n'
          : `No card matched "${query ?? ''}". earnrate covers ${String(catalog.cards.length)} US cards; list them all by leaving the query out.`
      return {
        content: [
          {
            type: 'text',
            text: header + result.cards.map(formatCardInfo).join('\n'),
          },
        ],
        structuredContent: result,
      }
    },
  )

  server.registerTool(
    'add_card',
    {
      title: 'Add a card',
      description:
        "Adds a card the user holds to their wallet by its id from search_cards, creating the wallet if there isn't one. The reply says what the card still needs (category picks, memberships, activations); ask the user about those. Stores only the card's product id and settings, never card numbers.",
      inputSchema: z.object({ cardId: CardId, ...cardFields }),
      outputSchema: WalletChangeSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) =>
      withWalletLock(deps.walletFile, async () => {
        const result = await addCard(
          deps.walletFile,
          catalog,
          cardInput(args),
          deps.today(),
        )
        return changed(
          result,
          `Added ${cardName(args.cardId)} (${args.cardId})${result.ok && result.created ? `, starting a new wallet at ${deps.walletFile}` : ''}.`,
        )
      }),
  )

  server.registerTool(
    'update_card',
    {
      title: 'Update a card',
      description:
        'Changes settings on a card already in the wallet: its category picks for this period, checkout label, anniversary or activated categories. Picks for the current period are merged with the ones already saved. Use it when the user picks new categories, such as each quarter on U.S. Bank Cash+.',
      inputSchema: z.object({ cardId: CardId, ...cardFields }),
      outputSchema: WalletChangeSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) =>
      withWalletLock(deps.walletFile, async () =>
        changed(
          await updateCard(
            deps.walletFile,
            catalog,
            cardInput(args),
            deps.today(),
          ),
          `Updated ${cardName(args.cardId)} (${args.cardId}).`,
        ),
      ),
  )

  server.registerTool(
    'remove_card',
    {
      title: 'Remove a card',
      description:
        "Removes a card from the wallet, with its tracked cap usage and bonus progress. Only when the user says they no longer have it or don't want it considered.",
      inputSchema: z.object({ cardId: CardId }),
      outputSchema: WalletChangeSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cardId }) =>
      withWalletLock(deps.walletFile, async () =>
        changed(
          await removeCard(deps.walletFile, catalog, cardId),
          `Removed ${cardName(cardId)} (${cardId}).`,
          false,
        ),
      ),
  )

  const memberships = knownMemberships(catalog) as [string, ...string[]]
  server.registerTool(
    'set_memberships',
    {
      title: 'Set memberships',
      description:
        "Sets the memberships that unlock some cards' rates, such as amazon-prime for Prime Visa's 5% or a Bank of America Preferred Rewards tier. Replaces the whole list, so include the ones to keep.",
      inputSchema: z.object({
        memberships: z
          .array(z.enum(memberships))
          .describe(
            `Every membership the user has. Known: ${memberships.join(', ')}.`,
          ),
      }),
      outputSchema: WalletChangeSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) =>
      withWalletLock(deps.walletFile, async () =>
        changed(
          await setMemberships(deps.walletFile, catalog, args.memberships),
          args.memberships.length > 0
            ? `Memberships set to ${args.memberships.join(', ')}.`
            : 'Memberships cleared.',
          false,
        ),
      ),
  )

  return server
}
