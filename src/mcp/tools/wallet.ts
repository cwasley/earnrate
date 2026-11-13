import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { Catalog } from '../../schema/catalog.ts'
import { membershipsFor, needsAnniversary } from '../../engine/setup.ts'
import {
  choiceName,
  currencyLabel,
  listed,
  money,
  shortDate,
  subscriptionPaidText,
  words,
} from '../../engine/text.ts'
import { counts, creditAt, tracksUse } from '../../engine/credits.ts'
import { membershipName } from '../../engine/memberships.ts'
import { profileText, VALUATION_PROFILES } from '../../engine/profiles.ts'
import { optionName } from '../../engine/rule-text.ts'
import { currencyChanges } from '../../engine/wallet-change.ts'
import { walletSummary } from '../../engine/wallet-summary.ts'
import { checklist } from '../../engine/checklist.ts'
import { pickedCategories } from '../../engine/evaluate.ts'
import { choicePeriod, periodKey } from '../../engine/periods.ts'
import { periodPhrase, possessive } from '../../engine/text.ts'
import { cardText, issuerName } from '../../format/card-text.ts'
import {
  formatBooking,
  formatChecklist,
  formatWalletSummary,
} from '../../format/wallet.ts'
import { fail, type Context } from '../context.ts'
import {
  CardChange,
  CardId,
  cardInput,
  ChannelInput,
  DateInput,
  Merchant,
  strictInput,
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
  return `It was started ${ago}.`
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
  if (args.opened === null) out.push('opening date cleared')
  else if (args.opened !== undefined) out.push(`opened ${args.opened}`)
  if (args.activated !== undefined)
    out.push(
      args.activated.length === 0
        ? 'nothing activated'
        : `activated: ${args.activated.join(', ')}`,
    )
  for (const [key, spent] of Object.entries(args.capSpent ?? {}))
    out.push(`${money(spent)} already spent on ${key} this period`)
  for (const [id, spent] of Object.entries(args.milestoneSpent ?? {}))
    out.push(
      `${money(spent)} spent toward ${id} this ${card?.milestones.find((m) => m.id === id)?.period === 'cardmember_year' ? 'cardmember year' : 'year'}`,
    )
  if (args.enrolled !== undefined)
    out.push(
      args.enrolled.length === 0
        ? 'no credits enrolled'
        : `enrolled in: ${args.enrolled.join(', ')}`,
    )
  for (const [id, used] of Object.entries(args.creditUsed ?? {})) {
    const credit = card?.credits.find((c) => c.id === id)
    out.push(
      credit && !tracksUse(credit)
        ? `nothing kept for the ${id} credit: it pays a subscription, counted in full each period`
        : `${money(used)} of the ${id} credit used this period`,
    )
  }
  if (args.skippedCredits !== undefined)
    out.push(
      args.skippedCredits.length === 0
        ? 'every credit counted'
        : `credits not used: ${args.skippedCredits.join(', ')}`,
    )
  for (const [id, dollars] of Object.entries(args.nightValues ?? {}))
    out.push(
      dollars === null
        ? `your value for ${id} cleared`
        : `${id} worth ${money(dollars)} to you`,
    )
  if (args.bonus === null) out.push('welcome bonus no longer tracked')
  else if (args.bonus !== undefined)
    out.push(
      `welcome bonus tracked from ${args.bonus.opened}, ${money(args.bonus.spent ?? 0)} spent so far`,
    )
  return out
}

export type ToolResult = {
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

// A tool's input and what it does, shared by the MCP tool and the hosted
// server's wallet API, so both give the same answers and refusals.
export type Handler<S extends z.ZodType> = {
  input: S
  run: (args: z.infer<S>) => Promise<ToolResult>
}

// The saved wallet with its summary and to-do list, as list_wallet shows it.
export async function walletListing(deps: ServerDeps, ctx: Context) {
  const read = await ctx.readableWallet()
  if (typeof read === 'string') return read
  const started =
    deps.savedWallets === 'account' ? await deps.store.started() : null
  const base = walletSummary(deps.catalog, read.wallet, deps.today())
  const summary = {
    ...base,
    started,
    checklist: checklist(
      deps.catalog,
      read.wallet,
      deps.today(),
      base,
      cardText(deps.catalog).shortName,
    ),
  }
  return { ...read, summary }
}

export function walletHandlers(
  deps: ServerDeps,
  ctx: Context,
  inputs: ReturnType<typeof makeInputs>,
) {
  const { catalog, store } = deps

  const listWallet = {
    input: z.object({}),
    run: async (): Promise<ToolResult> => {
      const found = await walletListing(deps, ctx)
      if (typeof found === 'string') return fail(found)
      const { start, summary } = found
      const running =
        deps.version === '' ? '' : ` Running earnrate ${deps.version}.`
      const when =
        summary.started === null
          ? `This is ${ctx.walletName}.${running}\n`
          : `This is ${ctx.walletName}. ${startedText(summary.started, Date.now())}${running}\n`
      return {
        content: [
          {
            type: 'text',
            text: `${when}${start === null ? '' : `${start}\n`}${formatChecklist(summary.checklist)}${formatWalletSummary(summary)}`,
          },
        ],
        structuredContent: summary,
      }
    },
  }

  const RecordInput = z.object({
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
  })
  const recordPurchase: Handler<typeof RecordInput> = {
    input: RecordInput,
    run: async ({ cardId, merchant, amount, channel, date, category }) => {
      const w = await ctx.wallet()
      if (typeof w === 'string') return fail(w)
      if (!w.cards.some((c) => c.id === cardId))
        return fail(
          `"${cardId}" isn't in the wallet. Cards: ${w.cards.map((c) => c.id).join(', ')}.`,
        )
      if (date !== undefined && date > deps.today())
        return fail(
          `${date} is after today (${deps.today()}). record_purchase is for purchases already made; nothing was recorded.`,
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
      const { cap: booking, bonus, milestones, credit } = result
      // A purchase from an earlier period than the picks on file can't be
      // matched to that period's categories.
      const stalePicks = (date: string): string | null => {
        const card = catalog.cards.find((c) => c.id === cardId)
        const held = w.cards.find((c) => c.id === cardId)
        if (!card || !held) return null
        const { staleChoice } = pickedCategories(card, held, date)
        const period = choicePeriod(card)
        if (staleChoice === null || period === null) return null
        const key = periodKey(period, date, null) ?? ''
        return `Nothing was recorded: ${cardText(catalog).shortName(cardId)}'s category picks on file are ${periodPhrase(period, staleChoice)}, and this purchase is from ${periodPhrase(period, key).replace(/^for /, '')}, so it can't be matched to that period's picks or cap.`
      }
      const capSummary = booking
        ? walletSummary(catalog, w, purchase.date)
            .cards.find((c) => c.cardId === cardId)
            ?.caps.find((c) => c.key === booking.capKey)
        : undefined
      const capLabel = capSummary?.label ?? null
      const shortName = cardText(catalog).shortName(cardId)
      // A subscription credit here pays in full each period: nothing is
      // booked against it, and the reply says so.
      const held = w.cards.find((c) => c.id === cardId)
      const heldCard = catalog.cards.find((c) => c.id === cardId)
      const paying =
        held && heldCard
          ? creditAt(catalog, heldCard, held, resolved.merchant, purchase.date)
          : null
      // Paying a subscription that needs no enrolling on the card says the
      // cardholder uses its credit, unless they said they don't.
      let marked = false
      if (
        paying &&
        held &&
        !tracksUse(paying.credit) &&
        paying.credit.enroll !== true &&
        !paying.confirmed &&
        !(held.skipped_credits ?? []).includes(paying.credit.id)
      ) {
        const done = await store.updateCard(
          {
            id: cardId,
            enrolled: [...(held.enrolled ?? []), paying.credit.id],
          },
          purchase.date,
        )
        marked = done.ok
      }
      const subscription =
        paying && !tracksUse(paying.credit) && (marked || counts(paying))
          ? `${marked ? `Marked ${possessive(shortName)} ${paying.name} credit as one you use. ` : ''}${subscriptionPaidText(shortName, paying)}`
          : null
      const output =
        booking || bonus || milestones.length > 0 || credit
          ? {
              recorded: true,
              booking,
              bonus,
              milestones,
              credit,
              message: `${formatBooking(amount, shortName, booking, bonus, milestones, credit, capLabel, capSummary?.afterCap ?? null)}${subscription === null ? '' : ` ${subscription}`} Saved in ${ctx.walletName}.`,
            }
          : {
              recorded: false,
              booking: null,
              bonus: null,
              milestones: [],
              credit: null,
              message:
                stalePicks(purchase.date) ??
                (subscription === null
                  ? `Nothing to track: ${shortName} has no spending cap, open welcome bonus, spend bonus or enrolled statement credit for this purchase, so the wallet wasn't changed.`
                  : `${subscription} The wallet wasn't changed.`),
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
  }

  const addCard: Handler<typeof CardChange> = {
    input: CardChange,
    run: async (args) => {
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
  }

  const updateCard: Handler<typeof CardChange> = {
    input: CardChange,
    run: async (args) => {
      const what = changes(catalog, args)
      const card = catalog.cards.find((c) => c.id === args.cardId)
      const unused =
        args.anniversary !== undefined &&
        card &&
        !needsAnniversary(card) &&
        (card.annual_fee ?? 0) === 0
          ? " It has no annual fee and none of its caps reset on the account anniversary, so earnrate doesn't use it."
          : ''
      return ctx.changed(
        await store.updateCard(cardInput(args), deps.today()),
        `Updated ${ctx.cardName(args.cardId)} (${args.cardId})${what.length > 0 ? `: ${what.join('; ')}` : ''}.${unused}`,
      )
    },
  }

  const RemoveInput = z.object({ cardId: CardId })
  const removeCard: Handler<typeof RemoveInput> = {
    input: RemoveInput,
    run: async ({ cardId }) =>
      ctx.changed(
        await store.removeCard(cardId),
        `Removed ${ctx.cardName(cardId)} (${cardId}).`,
        { notes: false },
      ),
  }

  const MembershipsInput = z.object({
    memberships: inputs.AllMemberships.optional(),
    skippedIssuers: inputs.SkippedIssuers.optional().describe(
      "Issuers the user says they can't or won't get a new card from (for example Chase, over its 5/24 rule): left out of compare_welcome_offers and of the cards that would add the most. Replaces the saved list; [] clears it. Ask; never assume.",
    ),
  })
  const setMemberships: Handler<typeof MembershipsInput> = {
    input: MembershipsInput,
    run: async ({ memberships, skippedIssuers }) => {
      if (memberships === undefined && skippedIssuers === undefined)
        return fail('Give memberships, skippedIssuers or both.')
      let skipText = ''
      if (skippedIssuers !== undefined) {
        const skipped = await store.setSkippedIssuers(skippedIssuers)
        skipText =
          skippedIssuers.length > 0
            ? `Next-card answers now leave out ${listed(skippedIssuers.map((i) => issuerName(catalog, i)))}.`
            : 'Next-card answers include every issuer again.'
        if (memberships === undefined || !skipped.ok)
          return ctx.changed(skipped, skipText, { notes: false })
      }
      if (memberships === undefined) return fail('Give memberships.')
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
            ? `Memberships set to ${memberships.map((m) => `${membershipName(catalog, m)} (${m})`).join(', ')}.`
            : 'Memberships cleared.'
        }${skipText === '' ? '' : ` ${skipText}`}${unused.length > 0 ? ` ${listed(unused.map((m) => membershipName(catalog, m)))} ${unused.length === 1 ? "doesn't" : "don't"} change any saved card's rates yet; kept for cards that use ${unused.length === 1 ? 'it' : 'them'}.` : ''}`,
        { notes: false },
      )
    },
  }

  const PointValuesInput = z.object({
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
  })
  const setPointValues: Handler<typeof PointValuesInput> = {
    input: PointValuesInput,
    run: async ({ values, profile }) => {
      const given = currencyChanges(catalog, values ?? {})
      if (!given.ok) return fail(given.error)
      const changes: Record<string, number | null> = {
        ...(profile ? VALUATION_PROFILES[profile] : {}),
        ...given.changes,
      }
      if (Object.keys(changes).length === 0)
        return fail('Give values (cents per point by currency) or a profile.')
      const result = await store.setValuations(changes)
      const set = Object.entries(changes).map(([id, cents]) =>
        cents === null
          ? `${currencyLabel(catalog, id)} back to earnrate's default, ${String(catalog.currencies.find((c) => c.id === id)?.value_cents ?? 1)}¢`
          : `${currencyLabel(catalog, id)} at ${String(cents)}¢`,
      )
      return ctx.changed(result, `Point values: ${set.join(', ')}.`, {
        notes: false,
      })
    },
  }

  return {
    list_wallet: listWallet,
    record_purchase: recordPurchase,
    add_card: addCard,
    update_card: updateCard,
    remove_card: removeCard,
    set_memberships: setMemberships,
    set_point_values: setPointValues,
  }
}

export function registerWalletTools(
  server: McpServer,
  deps: ServerDeps,
  ctx: Context,
  inputs: ReturnType<typeof makeInputs>,
) {
  const { catalog } = deps
  const tools = walletHandlers(deps, ctx, inputs)

  server.registerTool(
    'list_wallet',
    {
      title: 'List wallet',
      description: `Starts with a to-do list for the user's cards right now (bonuses to activate and their deadlines, categories to pick or confirm, caps nearly used up, welcome bonuses to finish and the weekly pace, yearly spend bonuses at least 75% of the way, statement credits to enroll in or use before they reset, whether the user uses a card's credits and yearly free night, and a fee card's renewal check in the month before its anniversary: whether it still pays for itself at typical spending; then, for 60 days, changes an issuer made to the user's cards, with the old and new terms and the issuer's page, and one line per card for earnrate's corrections to its own data about it, which are earnrate's mistakes and not the issuer's); use it when the user asks what to do with their cards this quarter or what they're forgetting. Then lists the user's cards: checkout label, network, rewards currency and its value, spending caps with how much is left this period, chosen bonus categories (and whether they're current), welcome-bonus progress, progress toward yearly spend bonuses, statement credits (enrolled or not, and what's left this period), yearly free nights (used or not, and what one is worth to the user if they said), which stores a store card works at, when each card's data was last verified, the point values the user saved, and (for the hosted wallet) when it was started. ${ctx.walletUse}`,
      outputSchema: WalletSummarySchema,
      annotations: {
        title: 'List wallet',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    () => tools.list_wallet.run(),
  )

  server.registerTool(
    'record_purchase',
    {
      title: 'Record a purchase',
      description: `Records a purchase the user has already made, so spending caps, welcome-bonus progress, yearly spend bonuses and statement credits used stay accurate for future recommendations. It updates the user's saved wallet. Only call it after the purchase has happened, and only once per purchase: calling it twice counts the spend twice. Purchases with no cap, no open welcome bonus, no spend bonus and no enrolled statement credit are acknowledged and nothing is written. For a merchant earnrate doesn't recognize it asks for category first, so caps aren't missed. ${ctx.walletUse}`,
      inputSchema: strictInput('record_purchase', tools.record_purchase.input),
      outputSchema: RecordResultSchema,
      annotations: {
        title: 'Record a purchase',
        ...WRITE,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: deps.llm !== null,
      },
    },
    (args) => tools.record_purchase.run(args),
  )

  server.registerTool(
    'add_card',
    {
      title: 'Add a card',
      description: `Adds a card the user holds to their wallet by its id from search_cards, creating the wallet if there isn't one. The reply says what the card still needs (category picks, memberships, activations); ask the user about those. Stores only the card's product id and settings, never card numbers. ${ctx.walletUse}`,
      inputSchema: strictInput('add_card', tools.add_card.input),
      outputSchema: WalletChangeSchema,
      annotations: {
        title: 'Add a card',
        ...WRITE,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (args) => tools.add_card.run(args),
  )

  server.registerTool(
    'update_card',
    {
      title: 'Update a card',
      description: `Changes settings on a card already in the wallet: its category picks for this period, checkout label, anniversary, opening date (optional; for first-year rates), activated categories, cap spending so far (capSpent), spending this year toward its spend bonuses (milestoneSpent), statement credits enrolled in and free nights used (enrolled), credits used this period (creditUsed), credits or free nights not used at all (skippedCredits), what a free night is worth to the user (nightValues, only if they say), or a welcome bonus to track. Picks replace the saved ones in each choice group you set (other groups are kept) for the current period. Use it when the user picks new categories, such as each quarter on U.S. Bank Cash+. ${ctx.walletUse}`,
      inputSchema: strictInput('update_card', tools.update_card.input),
      outputSchema: WalletChangeSchema,
      annotations: {
        title: 'Update a card',
        ...WRITE,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (args) => tools.update_card.run(args),
  )

  server.registerTool(
    'remove_card',
    {
      title: 'Remove a card',
      description: `Removes a card from the wallet, with its tracked cap usage, bonus progress and yearly spending. Memberships and point values stay, even when the last card goes. Only when the user says they no longer have it or don't want it considered. ${ctx.walletUse}`,
      inputSchema: strictInput('remove_card', tools.remove_card.input),
      outputSchema: WalletChangeSchema,
      annotations: {
        title: 'Remove a card',
        ...WRITE,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (args) => tools.remove_card.run(args),
  )

  server.registerTool(
    'set_memberships',
    {
      title: 'Set memberships',
      description: `Sets the memberships that unlock some cards' rates, such as amazon-prime for Prime Visa's 5% or a Bank of America Preferred Rewards tier, and costco for a Costco membership (so spending answers don't count its cost against Costco Anywhere). Replaces the whole list, so include the ones to keep. It saves them even with no cards saved, and every answer then uses them. With skippedIssuers, it also saves the issuers the user can't or won't get a new card from (Chase over its 5/24 rule), which next-card answers leave out; either can be given alone. ${ctx.walletUse}`,
      inputSchema: strictInput('set_memberships', tools.set_memberships.input),
      outputSchema: WalletChangeSchema,
      annotations: {
        title: 'Set memberships',
        ...WRITE,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (args) => tools.set_memberships.run(args),
  )

  server.registerTool(
    'set_point_values',
    {
      title: 'Set point values',
      description: `Saves what the user's points are worth to them, in cents per point, in their saved wallet; every answer then compares cards at those values unless a valuation profile is asked for. No saved cards are needed. Use it when the user says what their points are worth ("I value Chase points at 1.5¢") or that they transfer points to airlines and hotels (profile points-heavy). Values change only the currencies given; null goes back to earnrate's default. Currencies by id: ${catalog.currencies.map((c) => `${c.id} (${c.name})`).join(', ')}. ${ctx.walletUse}`,
      inputSchema: strictInput(
        'set_point_values',
        tools.set_point_values.input,
      ),
      outputSchema: WalletChangeSchema,
      annotations: {
        title: 'Set point values',
        ...WRITE,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (args) => tools.set_point_values.run(args),
  )
}
