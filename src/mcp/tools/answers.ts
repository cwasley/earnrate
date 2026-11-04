import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { catalogCheatSheet, cheatSheet } from '../../engine/cheat-sheet.ts'
import { exploreCards } from '../../engine/explore.ts'
import { compareOffers } from '../../engine/offers.ts'
import { withValuationProfile } from '../../engine/profiles.ts'
import { recommend } from '../../engine/recommend.ts'
import { searchCards } from '../../engine/setup.ts'
import {
  resolveSpendLines,
  simulateAdditions,
  simulateCatalog,
  TYPICAL_SPEND_NOTE,
  typicalSpendLines,
} from '../../engine/simulate.ts'
import {
  categoryPhrase,
  currencyName,
  NETWORK_NAMES,
} from '../../engine/text.ts'
import { EMPTY_WALLET } from '../../engine/transient.ts'
import type { MerchantResolution } from '../../engine/types.ts'
import { formatCardInfo } from '../../format/cards.ts'
import { formatCheatSheet } from '../../format/cheat-sheet.ts'
import {
  formatAdditions,
  formatCatalogSimulation,
  formatExploration,
} from '../../format/explore.ts'
import { formatOffers } from '../../format/offers.ts'
import { formatRecommendation } from '../../format/recommendation.ts'
import { resolvePlace, withCallerCategory } from '../../merchants/resolve.ts'
import { ALL_CARDS_NOTE, fail, type Context } from '../context.ts'
import {
  ChannelInput,
  CountryInput,
  DateInput,
  Merchant,
  settings,
  type makeInputs,
} from '../inputs.ts'
import {
  CardSearchSchema,
  CheatSheetSchema,
  ExplorationSchema,
  MerchantResolutionSchema,
  OfferComparisonSchema,
  PurchaseAnswerSchema,
  SpendingSimulationSchema,
} from '../schemas.ts'
import type { ServerDeps } from '../server.ts'

const SOURCES: Record<MerchantResolution['source'], string> = {
  override: "from earnrate's merchant list",
  seed: "from earnrate's merchant list",
  llm: 'classified by Claude',
  caller: 'from the category given with the request',
  category: 'a kind of purchase, not a store',
  none: 'not recognized',
}

const EVERY_CARD_NOTE =
  "Picked from every card earnrate knows, as asked, not just the user's saved cards. The user's saved memberships and point values still apply."

const TOP = 10

// The tools that answer without a saved wallet: from every card, the cards
// named in the conversation, or a saved wallet if there is one.
export function registerAnswerTools(
  server: McpServer,
  deps: ServerDeps,
  ctx: Context,
  inputs: ReturnType<typeof makeInputs>,
) {
  const { catalog } = deps
  const {
    CategoryInput,
    CatalogCategory,
    NamedCards,
    NamedMemberships,
    OfferFilters,
    CatalogFilters,
  } = inputs

  server.registerTool(
    'best_card_for_purchase',
    {
      title: 'Best card for a purchase',
      description:
        "Which credit card earns the most rewards for a purchase, and why. With no cards given and no saved wallet, it ranks every card earnrate knows (in `allCards`): a complete answer for anyone. With cards named in the conversation (`cards`) or a saved wallet, it picks the best of the user's own: `decision.cardId` is the pick and `decision.checkoutLabel` is how the card appears at checkout, with every usable card ranked with reasons, cards the merchant won't take, assumptions, warnings, and when a different point valuation would change the pick. For a business earnrate may not know, like a local restaurant, pass `category` when you can tell what kind of business it is. When the user is paying outside the U.S. or in another currency, pass `country`: abroad, each card is ranked after its foreign transaction fee. Never needs or returns card numbers.",
      inputSchema: z.object({
        merchant: Merchant,
        amount: z
          .number()
          .positive()
          .optional()
          .describe('Purchase amount in US dollars. Improves cap math.'),
        channel: ChannelInput,
        date: DateInput,
        country: CountryInput,
        category: CategoryInput,
        cards: NamedCards,
        memberships: NamedMemberships,
        valuation: CatalogFilters.valuation,
      }),
      outputSchema: PurchaseAnswerSchema,
      annotations: {
        title: 'Best card for a purchase',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: deps.llm !== null,
      },
    },
    async ({
      merchant,
      amount,
      channel,
      date,
      country,
      category,
      cards,
      memberships,
      valuation,
    }) => {
      const held = await ctx.cardsFor(cards, memberships)
      if (typeof held === 'string') return fail(held)
      const wallet =
        held !== null && valuation
          ? withValuationProfile(held, valuation)
          : held
      const purchase = {
        merchant,
        amount: amount ?? null,
        channel: channel ?? null,
        date: date ?? deps.today(),
        country: (country ?? 'US').toUpperCase(),
      }
      const resolved = await ctx.resolve(
        merchant,
        purchase.channel,
        category ?? null,
      )
      const retry =
        resolved.merchant.source === 'none'
          ? `earnrate doesn't recognize "${merchant}", so this answer uses only base rates and may miss the best card. If you can tell what kind of business it is (a restaurant, a grocery store, a gas station), call best_card_for_purchase again with category; otherwise ask the user.\n\n`
          : ''
      if (wallet === null) {
        const explored = exploreCards(
          catalog,
          {
            merchant,
            category: null,
            amount: purchase.amount,
            channel: purchase.channel,
            date: purchase.date,
            country: purchase.country,
          },
          settings({ memberships, valuation }, await ctx.saved()),
          resolved.merchant,
        )
        const allCards = { ...explored, ranked: explored.ranked.slice(0, TOP) }
        const empty = recommend(
          catalog,
          EMPTY_WALLET,
          purchase,
          resolved.merchant,
        )
        return {
          content: [
            {
              type: 'text',
              text: `${retry}${formatExploration(allCards, catalog, true)}\n${ALL_CARDS_NOTE}`,
            },
          ],
          structuredContent: {
            ...empty,
            warnings: [ALL_CARDS_NOTE, ...resolved.notices],
            allCards,
          },
        }
      }
      const rec = recommend(catalog, wallet, purchase, resolved.merchant)
      const output = {
        ...rec,
        warnings: [...rec.warnings, ...resolved.notices],
        allCards: null,
      }
      return {
        content: [
          {
            type: 'text',
            text: `${retry}${ctx.fromCards(cards)}${formatRecommendation(output, purchase, { all: true })}`,
          },
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
      annotations: {
        title: 'Resolve a merchant',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: deps.llm !== null,
      },
    },
    async ({ merchant, channel, category }) => {
      const resolved = await ctx.resolve(
        merchant,
        channel ?? null,
        category ?? null,
      )
      const m = resolved.merchant
      const text = [
        `${m.resolvedName}: ${categoryPhrase(catalog, m.category)}${m.likelyMcc === null ? '' : ` (MCC ${String(m.likelyMcc)})`}, ${m.confidence} confidence, ${SOURCES[m.source]}.`,
        m.accepts === null
          ? m.source === 'none'
            ? 'Which card networks it takes is unknown.'
            : 'Takes all major card networks.'
          : `Takes ${m.accepts.map((n) => NETWORK_NAMES[n] ?? n).join(', ')} only.`,
        ...(m.ambiguity ? [m.ambiguity.note] : []),
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
    'compare_welcome_offers',
    {
      title: 'Compare welcome offers',
      description:
        "Ranks the public welcome (sign-up) offers on cards the user doesn't have by first-year value: the bonus at the user's point values minus the first year's annual fee and any membership the card needs that the user doesn't have. Offers the issuer rules out because of a card in the user's wallet are marked likely not eligible and listed last. Use it when the user asks which new card to get or which has the best sign-up bonus. It covers only the cards earnrate knows, offers vary by person, and each offer's note gives the issuer's eligibility rules; pass those caveats on. It doesn't account for what a card would earn on the user's spending.",
      inputSchema: z.object({
        ...OfferFilters,
        valuation: CatalogFilters.valuation,
        includeHeld: z
          .boolean()
          .optional()
          .describe('Include cards already in the wallet.'),
        cards: NamedCards,
      }),
      outputSchema: OfferComparisonSchema,
      annotations: {
        title: 'Compare welcome offers',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const wallet = await ctx.cardsFor(args.cards, undefined)
      if (typeof wallet === 'string') return fail(wallet)
      const base = wallet ?? { ...EMPTY_WALLET, ...(await ctx.saved()) }
      const comparison = compareOffers(
        catalog,
        args.valuation ? withValuationProfile(base, args.valuation) : base,
        {
          kind: args.kind ?? 'any',
          noAnnualFee: args.noAnnualFee ?? false,
          business: args.business ?? false,
          includeHeld: args.includeHeld ?? false,
        },
        deps.today(),
      )
      const trimmed = {
        ...comparison,
        // Offers ruled out by a card the user holds sort last; keep them in
        // view so the reason shows.
        offers: comparison.offers.filter(
          (o, i) => i < TOP || o.ineligible !== null,
        ),
      }
      const more = comparison.offers.length - trimmed.offers.length
      return {
        content: [
          {
            type: 'text',
            text:
              (wallet === null ? '' : ctx.fromCards(args.cards)) +
              formatOffers(trimmed, (id) => currencyName(catalog, id), true) +
              (more > 0
                ? `\nThe top ${String(TOP)} of ${String(comparison.offers.length)} offers${trimmed.offers.length > TOP ? `, plus ${String(trimmed.offers.length - TOP)} likely not eligible` : ''}. Narrow them with kind, noAnnualFee or business.\n`
                : ''),
          },
        ],
        structuredContent: trimmed,
      }
    },
  )

  server.registerTool(
    'best_cards_for',
    {
      title: 'Best cards for a purchase',
      description:
        'Ranks every card earnrate knows that takes new applicants, not only the user\'s, for one purchase or category, each set up at its best (the right category pick, activated, cap unused), with its annual fee and what earning the rate takes. Use it for questions like "what\'s the best card for groceries?" or "which card should I get for Amazon?". It needs no wallet. For which of the user\'s own cards to use, call best_card_for_purchase instead. Mention the annual fee and any conditions alongside each card.',
      inputSchema: z.object({
        merchant: Merchant.optional(),
        category: CatalogCategory.optional(),
        amount: z
          .number()
          .positive()
          .optional()
          .describe('Purchase amount in US dollars, if known.'),
        channel: ChannelInput,
        country: CountryInput,
        ...CatalogFilters,
      }),
      outputSchema: ExplorationSchema,
      annotations: {
        title: 'Best cards for a purchase',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      if (args.merchant === undefined && args.category === undefined)
        return fail('Give a merchant or a category.')
      const channel = args.channel ?? null
      const result = exploreCards(
        catalog,
        {
          merchant: args.merchant ?? null,
          category: args.category ?? null,
          amount: args.amount ?? null,
          channel,
          date: deps.today(),
          country: (args.country ?? 'US').toUpperCase(),
        },
        settings(args, await ctx.saved()),
        args.merchant === undefined
          ? undefined
          : withCallerCategory(
              resolvePlace(catalog, args.merchant, channel),
              args.category ?? null,
            ),
      )
      const trimmed = { ...result, ranked: result.ranked.slice(0, TOP) }
      return {
        content: [
          { type: 'text', text: formatExploration(trimmed, catalog, true) },
        ],
        structuredContent: trimmed,
      }
    },
  )

  server.registerTool(
    'simulate_spending',
    {
      title: 'Simulate a year of spending',
      description:
        'Spends monthly amounts for a year across every card earnrate knows, and ranks single cards and two-card pairs by rewards minus annual fees, and minus a membership a card needs (a Costco membership) unless the user has it or spends at Costco. Spending is optional: without it, typical U.S. household amounts are used and the answer says so. With `cards` (named in the conversation) or compareToWallet (the saved wallet), it ranks the cards that would add the most to those cards instead. Use it for "which card fits my spending?" or "is it worth adding a card?". It leaves out welcome bonuses.',
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
        cards: NamedCards,
        compareToWallet: z
          .boolean()
          .optional()
          .describe(
            "Rank the cards that would add the most to the user's saved wallet.",
          ),
        ...CatalogFilters,
      }),
      outputSchema: SpendingSimulationSchema,
      annotations: {
        title: 'Simulate a year of spending',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
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
      const options = {
        ...settings(args, await ctx.saved()),
        start: deps.today(),
      }
      const wantsTheirs =
        (args.cards !== undefined && args.cards.length > 0) ||
        args.compareToWallet === true
      const wallet = wantsTheirs
        ? await ctx.cardsFor(args.cards, args.memberships)
        : null
      if (typeof wallet === 'string') return fail(wallet)
      if (wallet !== null) {
        const valued = args.valuation
          ? withValuationProfile(wallet, args.valuation)
          : wallet
        const result = simulateAdditions(catalog, valued, lines, options)
        const text = `${ctx.fromCards(args.cards)}${formatAdditions(result, catalog, false)}`
        return {
          content: [{ type: 'text', text: [...notes, text].join('\n\n') }],
          structuredContent: {
            notes,
            singles: [],
            pairs: [],
            current: result.current,
            additions: result.additions
              .slice(0, TOP)
              .map(({ simulation: _, ...a }) => a),
          },
        }
      }
      if (wantsTheirs) notes.push(ALL_CARDS_NOTE)
      const result = simulateCatalog(catalog, lines, options)
      const text = formatCatalogSimulation(result, catalog, false)
      return {
        content: [{ type: 'text', text: [...notes, text].join('\n\n') }],
        structuredContent: {
          notes,
          singles: result.singles.slice(0, TOP),
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
        "The card to use for each everyday kind of purchase right now: groceries, dining, gas, Amazon, Costco, travel, streaming, drugstores and everything else. With no cards given and no saved wallet, it picks from every card earnrate knows (`scope: all cards`, each row noting the card's fee and conditions). With cards named in the conversation or a saved wallet, it picks from the user's own cards, with caps, picks and activations as they are. The kind, noAnnualFee, business and issuer filters apply only when it picks from every card. For one specific store, call best_card_for_purchase instead. Pass on the notes.",
      inputSchema: z.object({
        date: DateInput,
        cards: NamedCards,
        everyCard: z
          .boolean()
          .optional()
          .describe(
            'true to pick from every card earnrate knows even when the user has a saved wallet ("which cards should I get?"); the filters then apply.',
          ),
        memberships: NamedMemberships,
        kind: CatalogFilters.kind,
        noAnnualFee: CatalogFilters.noAnnualFee,
        business: CatalogFilters.business,
        issuer: CatalogFilters.issuer,
        valuation: CatalogFilters.valuation,
      }),
      outputSchema: CheatSheetSchema,
      annotations: {
        title: 'Cheat sheet',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const wallet =
        args.everyCard === true
          ? null
          : await ctx.cardsFor(args.cards, args.memberships)
      if (typeof wallet === 'string') return fail(wallet)
      const date = args.date ?? deps.today()
      const sheet =
        wallet === null
          ? {
              ...catalogCheatSheet(
                catalog,
                date,
                settings(args, await ctx.saved()),
              ),
              notes: [
                args.everyCard === true ? EVERY_CARD_NOTE : ALL_CARDS_NOTE,
              ],
            }
          : cheatSheet(
              catalog,
              args.valuation
                ? withValuationProfile(wallet, args.valuation)
                : wallet,
              date,
            )
      return {
        content: [
          {
            type: 'text',
            text: `${wallet === null ? '' : ctx.fromCards(args.cards)}${formatCheatSheet(sheet)}`,
          },
        ],
        structuredContent: sheet,
      }
    },
  )

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
      annotations: {
        title: 'Search cards',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
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
}
