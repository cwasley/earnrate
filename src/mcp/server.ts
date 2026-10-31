import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { MCP_SERVER_NAME } from '../brand.ts'
import { formatCardInfo, formatNotes } from '../cli/cards.ts'
import { formatRecommendation } from '../cli/format.ts'
import { formatCheatSheet } from '../format/cheat-sheet.ts'
import {
  formatAdditions,
  formatCatalogSimulation,
  formatExploration,
} from '../format/explore.ts'
import { formatOffers } from '../format/offers.ts'
import { walletProblems } from '../data/integrity.ts'
import type { Catalog } from '../data/load.ts'
import type { SetupResult, WalletStore } from '../data/store.ts'
import type { CardInput } from '../engine/wallet-change.ts'
import { catalogCheatSheet, cheatSheet } from '../engine/cheat-sheet.ts'
import { ALL_PERSONAL_CARDS, exploreCards } from '../engine/explore.ts'
import { walletFromCards } from '../engine/transient.ts'
import { compareOffers } from '../engine/offers.ts'
import { VALUATION_PROFILES } from '../engine/profiles.ts'
import { recommend } from '../engine/recommend.ts'
import {
  resolveSpendLines,
  simulateAdditions,
  simulateCatalog,
  TYPICAL_SPEND_NOTE,
  typicalSpendLines,
} from '../engine/simulate.ts'
import { knownMemberships, searchCards } from '../engine/setup.ts'
import type { Channel, MerchantResolution } from '../engine/types.ts'
import { walletSummary } from '../engine/wallet-summary.ts'
import type { LlmSession } from '../merchants/fallback.ts'
import { resolveMerchant, withCallerCategory } from '../merchants/resolve.ts'
import { IsoDate } from '../schema/common.ts'
import type { Wallet } from '../schema/wallet.ts'
import {
  CardSearchSchema,
  CheatSheetSchema,
  ExplorationSchema,
  MerchantResolutionSchema,
  PurchaseAnswerSchema,
  SpendingSimulationSchema,
  OfferComparisonSchema,
  RecordResultSchema,
  WalletChangeSchema,
  WalletSummarySchema,
} from './schemas.ts'

export type ServerDeps = {
  catalog: Catalog
  store: WalletStore // where a saved wallet lives; it's optional
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

const INSTRUCTIONS = `earnrate answers which credit card earns the most for a purchase, from each issuer's own terms. Anyone can use it without entering anything: with no cards given, best_card_for_purchase, best_cards_for, cheat_sheet, simulate_spending and compare_welcome_offers answer from every card earnrate knows, and that's a complete answer. Never require the user's cards, and don't ask what they spend unless the answer depends on it; simulate_spending assumes typical amounts when none are given and says so.

Personalizing is optional. If the user names their cards, pass them as \`cards\` (ids from search_cards) for that answer; nothing is saved. Only if they want earnrate to remember their cards, track spending caps or welcome bonuses, or record purchases, save a wallet with add_card and the other wallet tools. When a card needs category picks, memberships like Amazon Prime, or activations, ask the user rather than guessing.

The wallet lists cards by product id, never card numbers; never ask for card numbers, expiry dates or security codes.`

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

  const noWallet = `There's no wallet yet (${deps.store.where}), which is normal before the user adds a card. Ask the user which credit cards they have, find each one with search_cards, and add it with add_card. best_cards_for and simulate_spending work without a wallet.`

  // Read on every call, so edits to the wallet apply without a restart.
  async function wallet(): Promise<Wallet | string> {
    let loaded: Wallet
    try {
      const found = await deps.store.load()
      if (found === null) return noWallet
      loaded = found
    } catch (e) {
      return `Couldn't read the wallet at ${deps.store.where}: ${e instanceof Error ? e.message : String(e)}`
    }
    const problems = walletProblems(loaded, catalog)
    return problems.length > 0
      ? `The wallet at ${deps.store.where} has problems:\n${problems.map((p) => `- ${p}`).join('\n')}`
      : loaded
  }

  // No wallet yet is the first-run state, not a failure: read-only tools
  // answer from an empty wallet and say how to start one.
  async function readableWallet(): Promise<
    { wallet: Wallet; start: string | null } | string
  > {
    const w = await wallet()
    if (typeof w !== 'string') return { wallet: w, start: null }
    return w === noWallet
      ? { wallet: { valuations: {}, memberships: [], cards: [] }, start: w }
      : w
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

  const namedMembershipIds = knownMemberships(catalog) as [string, ...string[]]
  const NamedCardsInput = z
    .array(
      z.object({
        cardId: z.string().min(1).describe('A card id from search_cards.'),
        picks: z
          .record(z.string(), z.array(z.string()).min(1))
          .optional()
          .describe(
            "Bonus categories the user picked, for cards that have them: choice id → option ids, from search_cards. Ask; don't guess.",
          ),
        activated: z
          .array(z.string())
          .optional()
          .describe(
            'Bonuses the user has activated with the issuer, as rule ids from search_cards.',
          ),
      }),
    )
    .optional()
    .describe(
      "Cards the user named in this conversation, to answer for just those cards without saving anything. Leave out to use the user's saved wallet if they have one; with neither, the answer covers every card earnrate knows.",
    )
  const NamedMembershipsInput = z
    .array(z.enum(namedMembershipIds))
    .optional()
    .describe(
      "Memberships the user has, such as amazon-prime, when they're named in the conversation rather than saved.",
    )
  const ALL_CARDS_NOTE =
    "The user hasn't named their cards, so this covers every card earnrate knows. That's a complete answer. If they want the best of their own cards, they can name them (pass them as `cards`); saving a wallet is optional."

  type NamedCard = {
    cardId: string
    picks?: Record<string, string[]> | undefined
    activated?: string[] | undefined
  }
  type Source = { wallet: Wallet; named: boolean } | { wallet: null }

  // Cards named in the conversation come first, then the saved wallet; with
  // neither, read tools answer from every card earnrate knows.
  async function sourceFor(
    cards: NamedCard[] | undefined,
    memberships: string[] | undefined,
  ): Promise<Source | string> {
    if (cards && cards.length > 0) {
      const w = walletFromCards(
        catalog,
        {
          cards: cards.map((c) => ({
            id: c.cardId,
            ...(c.picks ? { picks: c.picks } : {}),
            ...(c.activated ? { activated: c.activated } : {}),
          })),
          ...(memberships ? { memberships } : {}),
        },
        deps.today(),
      )
      return typeof w === 'string' ? w : { wallet: w, named: true }
    }
    const read = await readableWallet()
    if (typeof read === 'string') return read
    return read.start !== null
      ? { wallet: null }
      : { wallet: read.wallet, named: false }
  }

  server.registerTool(
    'best_card_for_purchase',
    {
      title: 'Best card for a purchase',
      description:
        "Which card earns the most rewards for a purchase, and why. With no cards given and no saved wallet, it ranks every card earnrate knows (in `allCards`): a complete answer for anyone. With cards named in the conversation (`cards`) or a saved wallet, it picks the best of the user's own: `decision.cardId` is the pick and `decision.checkoutLabel` is how the card appears at checkout, with every usable card ranked with reasons, cards the merchant won't take, assumptions, warnings, and when a different point valuation would change the pick. Never needs or returns card numbers.",
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
        cards: NamedCardsInput,
        memberships: NamedMembershipsInput,
      }),
      outputSchema: PurchaseAnswerSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: deps.llm !== null,
      },
    },
    async ({
      merchant,
      amount,
      channel,
      date,
      category,
      cards,
      memberships,
    }) => {
      const source = await sourceFor(cards, memberships)
      if (typeof source === 'string') return fail(source)
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
      if (source.wallet === null) {
        const explored = exploreCards(
          catalog,
          {
            merchant,
            category: null,
            amount: purchase.amount,
            channel: purchase.channel,
            date: purchase.date,
          },
          { ...settings({}), memberships: memberships ?? [] },
          resolved.merchant,
        )
        const allCards = { ...explored, ranked: explored.ranked.slice(0, 10) }
        const empty = recommend(
          catalog,
          { valuations: {}, memberships: [], cards: [] },
          purchase,
          resolved.merchant,
        )
        return {
          content: [
            {
              type: 'text',
              text: `${formatExploration(allCards, true)}\n${ALL_CARDS_NOTE}`,
            },
          ],
          structuredContent: {
            ...empty,
            warnings: [ALL_CARDS_NOTE, ...resolved.notices],
            allCards,
          },
        }
      }
      const rec = recommend(catalog, source.wallet, purchase, resolved.merchant)
      const output = {
        ...rec,
        warnings: [...rec.warnings, ...resolved.notices],
        allCards: null,
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
      const read = await readableWallet()
      if (typeof read === 'string') return fail(read)
      const summary = walletSummary(catalog, read.wallet, deps.today())
      if (read.start !== null)
        return {
          content: [{ type: 'text', text: read.start }],
          structuredContent: summary,
        }
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
        cards: NamedCardsInput,
      }),
      outputSchema: OfferComparisonSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const source = await sourceFor(args.cards, undefined)
      if (typeof source === 'string') return fail(source)
      const comparison = compareOffers(
        catalog,
        source.wallet ?? { valuations: {}, memberships: [], cards: [] },
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

  const CatalogCategory = z
    .enum(ids)
    .describe(
      `A spending category: ${catalog.categories.map((c) => `${c.id} (${c.name})`).join(', ')}.`,
    )
  const issuers = [...new Set(catalog.cards.map((c) => c.issuer))].sort() as [
    string,
    ...string[],
  ]
  const membershipIds = knownMemberships(catalog) as [string, ...string[]]
  const CatalogFilters = {
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
    issuer: z.enum(issuers).optional().describe("Only this issuer's cards."),
    memberships: z
      .array(z.enum(membershipIds))
      .optional()
      .describe(
        "Memberships the user has, such as amazon-prime. Rates that need one they don't have are listed separately.",
      ),
    valuation: z
      .enum(['flat', 'points-heavy'])
      .optional()
      .describe(
        'flat (default): points at their cash-out value, about 1¢. points-heavy: Amex MR and Chase UR at 1.7¢, for people who transfer points to airlines and hotels.',
      ),
  }
  const settings = (args: {
    kind?: 'any' | 'cash' | 'points' | undefined
    noAnnualFee?: boolean | undefined
    business?: boolean | undefined
    issuer?: string | undefined
    memberships?: string[] | undefined
    valuation?: 'flat' | 'points-heavy' | undefined
  }) => ({
    filters: {
      ...ALL_PERSONAL_CARDS,
      kind: args.kind ?? 'any',
      noAnnualFee: args.noAnnualFee ?? false,
      business: args.business ?? false,
      issuer: args.issuer ?? null,
    },
    memberships: args.memberships ?? [],
    valuations: args.valuation ? VALUATION_PROFILES[args.valuation] : {},
  })

  server.registerTool(
    'best_cards_for',
    {
      title: 'Best cards for a purchase',
      description:
        'Ranks every card earnrate knows, not only the user\'s, for one purchase or category, each set up at its best (the right category pick, activated, cap unused), with its annual fee and what earning the rate takes. Use it for questions like "what\'s the best card for groceries?" or "which card should I get for Amazon?". It needs no wallet. For which of the user\'s own cards to use, call best_card_for_purchase instead. Mention the annual fee and any conditions alongside each card.',
      inputSchema: z.object({
        merchant: Merchant.optional(),
        category: CatalogCategory.optional(),
        amount: z
          .number()
          .positive()
          .optional()
          .describe('Purchase amount in US dollars, if known.'),
        channel: ChannelInput,
        ...CatalogFilters,
      }),
      outputSchema: ExplorationSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => {
      if (args.merchant === undefined && args.category === undefined)
        return fail('Give a merchant or a category.')
      const result = exploreCards(
        catalog,
        {
          merchant: args.merchant ?? null,
          category:
            args.merchant === undefined ? (args.category ?? null) : null,
          amount: args.amount ?? null,
          channel: args.channel ?? null,
          date: deps.today(),
        },
        settings(args),
      )
      const trimmed = { ...result, ranked: result.ranked.slice(0, 10) }
      return {
        content: [{ type: 'text', text: formatExploration(trimmed, true) }],
        structuredContent: trimmed,
      }
    },
  )

  server.registerTool(
    'simulate_spending',
    {
      title: 'Simulate a year of spending',
      description:
        'Spends monthly amounts for a year across every card earnrate knows, and ranks single cards and two-card pairs by rewards minus annual fees. Spending is optional: without it, typical U.S. household amounts are used and the answer says so. With `cards` (named in the conversation) or compareToWallet (the saved wallet), it ranks the cards that would add the most to those cards instead. Use it for "which card fits my spending?" or "is it worth adding a card?". It leaves out welcome bonuses.',
      inputSchema: z.object({
        spending: z
          .array(
            z.object({
              merchant: Merchant.optional(),
              category: CatalogCategory.optional(),
              monthly: z.number().positive().describe('US dollars a month.'),
            }),
          )
          .optional()
          .describe(
            "Monthly spending lines, each a category (grocery.supermarket, dining, gas, other) or a merchant (Amazon, Costco). Optional: leave out to use typical amounts, and don't press the user for numbers they haven't offered.",
          ),
        cards: NamedCardsInput,
        compareToWallet: z
          .boolean()
          .optional()
          .describe(
            "Rank the cards that would add the most to the user's saved wallet.",
          ),
        ...CatalogFilters,
      }),
      outputSchema: SpendingSimulationSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const given = args.spending ?? []
      if (
        given.some((l) => l.merchant === undefined && l.category === undefined)
      )
        return fail('Each spending line needs a merchant or a category.')
      const lines =
        given.length === 0
          ? typicalSpendLines(catalog)
          : resolveSpendLines(
              catalog,
              given.map((l) => ({
                merchant: l.merchant ?? null,
                category:
                  l.merchant === undefined ? (l.category ?? null) : null,
                monthly: l.monthly,
              })),
            )
      const unknown = lines.filter((l) => l.merchant.source === 'none')
      if (unknown.length > 0)
        return fail(
          `earnrate doesn't know ${unknown.map((l) => `"${l.merchant.input}"`).join(', ')}. Give a category for those lines instead.`,
        )
      const notes = given.length === 0 ? [TYPICAL_SPEND_NOTE] : []
      const options = { ...settings(args), start: deps.today() }
      const wantsTheirs =
        (args.cards !== undefined && args.cards.length > 0) ||
        args.compareToWallet === true
      const source = wantsTheirs
        ? await sourceFor(args.cards, args.memberships)
        : null
      if (typeof source === 'string') return fail(source)
      if (source && source.wallet !== null) {
        const w = source.wallet
        const valued = args.valuation
          ? {
              ...w,
              valuations: {
                ...w.valuations,
                ...VALUATION_PROFILES[args.valuation],
              },
            }
          : w
        const result = simulateAdditions(catalog, valued, lines, options)
        const text = formatAdditions(result, catalog, false)
        return {
          content: [{ type: 'text', text: [...notes, text].join('\n\n') }],
          structuredContent: {
            notes,
            singles: [],
            pairs: [],
            current: result.current,
            additions: result.additions
              .slice(0, 10)
              .map(({ simulation: _, ...a }) => a),
          },
        }
      }
      if (source) notes.push(ALL_CARDS_NOTE)
      const result = simulateCatalog(catalog, lines, options)
      const text = formatCatalogSimulation(result, catalog, false)
      return {
        content: [{ type: 'text', text: [...notes, text].join('\n\n') }],
        structuredContent: {
          notes,
          singles: result.singles.slice(0, 10),
          pairs: result.pairs.slice(0, 5),
          current: null,
          additions: [],
        },
      }
    },
  )

  server.registerTool(
    'cheat_sheet',
    {
      title: 'Cheat sheet',
      description:
        "The card to use for each everyday kind of purchase right now: groceries, dining, gas, Amazon, Costco, travel, streaming, drugstores and everything else. With no cards given and no saved wallet, it picks from every card earnrate knows (`scope: all cards`, each row noting the card's fee and conditions). With cards named in the conversation or a saved wallet, it picks from the user's own cards, with caps, picks and activations as they are. For one specific store, call best_card_for_purchase instead. Pass on the notes.",
      inputSchema: z.object({
        date: DateInput,
        cards: NamedCardsInput,
        memberships: NamedMembershipsInput,
      }),
      outputSchema: CheatSheetSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const source = await sourceFor(args.cards, args.memberships)
      if (typeof source === 'string') return fail(source)
      const date = args.date ?? deps.today()
      if (source.wallet === null) {
        const sheet = catalogCheatSheet(catalog, date, {
          ...settings({}),
          memberships: args.memberships ?? [],
        })
        const withNote = { ...sheet, notes: [ALL_CARDS_NOTE] }
        return {
          content: [{ type: 'text', text: formatCheatSheet(withNote) }],
          structuredContent: withNote,
        }
      }
      const sheet = cheatSheet(catalog, source.wallet, date)
      return {
        content: [{ type: 'text', text: formatCheatSheet(sheet) }],
        structuredContent: sheet,
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
      (async () => {
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
        const result = await deps.store.record(purchase, resolved.merchant)
        if (!result.ok) return fail(`Couldn't record it: ${result.error}`)
        const { cap: booking, bonus } = result
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
      })(),
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
    bonus: z
      .object({
        opened: IsoDate.describe('The day the account opened, YYYY-MM-DD.'),
        spent: z
          .number()
          .nonnegative()
          .optional()
          .describe('Dollars already spent toward the bonus. Default 0.'),
        spend: z
          .number()
          .positive()
          .optional()
          .describe(
            "Dollars of spending the bonus needs, only if the user's offer differs from the published one.",
          ),
        by: IsoDate.optional().describe(
          "The deadline, YYYY-MM-DD, only if the user's offer differs from the published one.",
        ),
      })
      .nullable()
      .optional()
      .describe(
        "A welcome bonus the user is working toward, so purchases recorded on this card count toward it and answers can favor it. Ask when they opened the account; spending needed and the deadline default to the card's published offer. null stops tracking it.",
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
    bonus?:
      | {
          opened: string
          spent?: number | undefined
          spend?: number | undefined
          by?: string | undefined
        }
      | null
      | undefined
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
    ...(args.bonus === undefined
      ? {}
      : {
          bonus:
            args.bonus === null
              ? null
              : {
                  opened: args.bonus.opened,
                  ...(args.bonus.spent === undefined
                    ? {}
                    : { spent: args.bonus.spent }),
                  ...(args.bonus.spend === undefined
                    ? {}
                    : { spend: args.bonus.spend }),
                  ...(args.bonus.by === undefined ? {} : { by: args.bonus.by }),
                },
        }),
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
      const held = await deps.store.load().catch(() => null)
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
    async (args) => {
      const result = await deps.store.addCard(cardInput(args), deps.today())
      return changed(
        result,
        `Added ${cardName(args.cardId)} (${args.cardId})${result.ok && result.created ? `, starting a new wallet at ${deps.store.where}` : ''}.`,
      )
    },
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
    async (args) =>
      changed(
        await deps.store.updateCard(cardInput(args), deps.today()),
        `Updated ${cardName(args.cardId)} (${args.cardId}).`,
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
    async ({ cardId }) =>
      changed(
        await deps.store.removeCard(cardId),
        `Removed ${cardName(cardId)} (${cardId}).`,
        false,
      ),
  )

  server.registerTool(
    'set_memberships',
    {
      title: 'Set memberships',
      description:
        "Sets the memberships that unlock some cards' rates, such as amazon-prime for Prime Visa's 5% or a Bank of America Preferred Rewards tier. Replaces the whole list, so include the ones to keep.",
      inputSchema: z.object({
        memberships: z
          .array(z.enum(membershipIds))
          .describe(
            `Every membership the user has. Known: ${membershipIds.join(', ')}.`,
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
    async (args) =>
      changed(
        await deps.store.setMemberships(args.memberships),
        args.memberships.length > 0
          ? `Memberships set to ${args.memberships.join(', ')}.`
          : 'Memberships cleared.',
        false,
      ),
  )

  return server
}
