import { z } from 'zod'
import { ALL_PERSONAL_CARDS } from '../engine/explore.ts'
import { profileText, VALUATION_PROFILES } from '../engine/profiles.ts'
import { knownMemberships } from '../engine/setup.ts'
import type { CardInput } from '../engine/wallet-change.ts'
import { PaymentMethod } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import { IsoDate } from '../schema/common.ts'
import { COUNTRY_CODE } from '../schema/common.ts'
import type { Wallet } from '../schema/wallet.ts'

export const Merchant = z
  .string()
  .min(1)
  .describe(
    'Merchant name or web address as the user would say it or see it, e.g. "Whole Foods" or "delta.com", or a kind of place, e.g. "restaurants" or "gas station".',
  )

export const ChannelInput = z
  .enum(['online', 'in_store'])
  .optional()
  .describe(
    'How the purchase is made. Omit if unknown; the answer says what it assumed.',
  )

export const DateInput = IsoDate.optional().describe(
  'Purchase date, YYYY-MM-DD. Defaults to today.',
)

export const CountryInput = z
  .string()
  .regex(COUNTRY_CODE, 'Use a two-letter country code, like US or FR.')
  .optional()
  .describe(
    'Where the purchase is made, as a two-letter country code (FR, GB, JP). Pass it when the user is paying abroad or in another currency: abroad, cards are ranked after their foreign transaction fees. Default US.',
  )

export const PaymentInput = PaymentMethod.optional().describe(
  "How the purchase is paid, only when the user says: card (the card itself or its number), apple-pay, google-pay or paypal (PayPal checkout). Optional; omit it when unknown, and never assume Apple Pay. Some rates need one (Apple Card's 2% with Apple Pay, PayPal Cashback's 3% through PayPal checkout), and the answer's assumptions say when paying another way would change the pick.",
)

export const CardId = z
  .string()
  .min(1)
  .describe('The card id from search_cards, e.g. chase-sapphire-preferred.')

// The filters every catalog-wide answer takes.
const OfferFilters = {
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
}

const NamedCard = z.object({
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
  enrolled: z
    .array(z.string())
    .optional()
    .describe(
      "Statement credits the user has enrolled in with the issuer, as credit ids from search_cards. A credit that needs enrolling counts only when it's here. Ask; never assume.",
    ),
  skippedCredits: z
    .array(z.string())
    .optional()
    .describe(
      "Statement credit ids the user says they don't use. They don't count toward a pick or against the card's annual fee.",
    ),
  opened: z
    .string()
    .optional()
    .describe(
      'The day the account opened (YYYY-MM-DD), for a card with a first-year rate. Optional; without it the card is ranked at its standard rates.',
    ),
})
export type NamedCard = z.infer<typeof NamedCard>

const cardFields = {
  checkoutLabel: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      'How the card appears at checkout or in a browser wallet, e.g. "Amex Gold". Optional; null goes back to the card\'s own name.',
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
  opened: IsoDate.nullable()
    .optional()
    .describe(
      'Optional: the day the account opened, YYYY-MM-DD. Only for cards with a first-year rate (search_cards lists it), which applies only while a purchase falls in the window; without a date the card is ranked at its standard rates. Ask the user; never guess or assume a card is new. null removes it.',
    ),
  activated: z
    .array(z.string())
    .optional()
    .describe(
      'Rule ids the user has activated with the issuer, such as rotating categories. Replaces the current list.',
    ),
  capSpent: z
    .record(z.string(), z.number().nonnegative())
    .optional()
    .describe(
      'Dollars already spent this period on a capped bonus, for a card the user starts tracking partway through: cap key (as list_wallet shows it) → dollars, e.g. {"five-percent-quarterly": 400}. Ask; recorded purchases add to it from then on.',
    ),
  milestoneSpent: z
    .record(z.string(), z.number().nonnegative())
    .optional()
    .describe(
      'Dollars already spent on the card this year, for its spend bonuses (bonuses after a yearly spending total, as search_cards lists them): milestone id → dollars, e.g. {"spend-15k": 9000}. Every purchase on the card counts, so give each milestone the same total. Ask; recorded purchases add to it from then on.',
    ),
  enrolled: z
    .array(z.string())
    .optional()
    .describe(
      "Statement credit ids the user has enrolled in with the issuer, or, for a credit that needs no enrolling, says they use (search_cards and list_wallet list each card's credits, e.g. \"lululemon\" on Amex Platinum). A credit that needs enrolling counts in answers only once it's here, and any credit counts against the annual fee only once it's here (or has been used). Replaces the current list. Ask; never assume.",
    ),
  creditUsed: z
    .record(z.string(), z.number().nonnegative())
    .optional()
    .describe(
      'Dollars of a statement credit already received this period: credit id → dollars, e.g. {"lululemon": 40}. Ask; recorded purchases add to it from then on.',
    ),
  skippedCredits: z
    .array(z.string())
    .optional()
    .describe(
      "Statement credit ids the user doesn't use, e.g. [\"dunkin\"] on Amex Gold. They're left out of picks, the to-do list and the annual-fee math; every other credit on the card counts against its fee once it's in enrolled (or, for one that needs no enrolling, has been used). Replaces the current list; [] counts them all again.",
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
export const CardChange = z.object({ cardId: CardId, ...cardFields })

// Drops keys whose value is undefined, which optional zod fields produce and
// exactOptionalPropertyTypes won't accept.
export function defined<T extends object>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> }
}

export function cardInput({
  cardId,
  bonus,
  ...rest
}: z.infer<typeof CardChange>): CardInput {
  return {
    id: cardId,
    ...defined(rest),
    ...(bonus === undefined ? {} : { bonus: bonus && defined(bonus) }),
  }
}

// Inputs that list the catalog's categories, issuers and memberships.
export function makeInputs(catalog: Catalog) {
  // A parent with subcategories and no merchant codes of its own ("Grocery")
  // isn't something a purchase codes as, so it's left out.
  const categories = catalog.categories.filter(
    (c) =>
      c.mccs.length > 0 ||
      !catalog.categories.some((k) => k.id.startsWith(`${c.id}.`)),
  )
  const categoryIds = categories.map((c) => c.id) as [string, ...string[]]
  const categoryList = categories.map((c) => `${c.id} (${c.name})`).join(', ')
  const membershipIds = knownMemberships(catalog) as [string, ...string[]]
  const issuers = [...new Set(catalog.cards.map((c) => c.issuer))].sort() as [
    string,
    ...string[],
  ]

  const CategoryInput = z
    .enum(categoryIds)
    .optional()
    .describe(
      `Only for a merchant earnrate may not know, and only if you're confident what kind of business it is: its spending category, e.g. grocery.supermarket for a supermarket, dining for a restaurant, gas for a gas station. Ignored when earnrate knows the merchant. Leave it out if unsure. Categories: ${categoryList}.`,
    )
  // record_purchase can't skip an unknown merchant's caps, so it asks.
  const RecordCategoryInput = CategoryInput.describe(
    `For a merchant earnrate doesn't know, its spending category, e.g. dining for a restaurant: without one the purchase isn't recorded, since its caps can't be told. If nobody knows, other records it toward a welcome bonus without touching any cap. Ignored when earnrate knows the merchant. Categories: ${categoryList}.`,
  )
  const CatalogCategory = z
    .enum(categoryIds)
    .describe(`A spending category: ${categoryList}.`)
  const Memberships = z.array(z.enum(membershipIds))
  const NamedCards = z
    .array(NamedCard)
    .optional()
    .describe(
      "Cards the user named in this conversation, to answer for just those cards without saving anything. Leave out to use the user's saved wallet if they have one; with neither, the answer covers every card earnrate knows.",
    )
  const NamedMemberships = Memberships.optional().describe(
    "Memberships the user has, such as amazon-prime or costco, when they're named in the conversation rather than saved.",
  )
  const CatalogFilters = {
    ...OfferFilters,
    issuer: z.enum(issuers).optional().describe("Only this issuer's cards."),
    memberships: Memberships.optional().describe(
      "Memberships the user has, such as amazon-prime or costco. Rates that need one they don't have are listed separately; a card that needs one (Costco Anywhere) says so.",
    ),
    valuation: z
      .enum(['flat', 'points-heavy'])
      .optional()
      .describe(
        `Instead of the user's saved point values (or earnrate's defaults): flat, points at their cash-out value, ${profileText('flat')}; or points-heavy, ${profileText('points-heavy')}, for people who transfer points to airlines and hotels.`,
      ),
  }
  const AllMemberships = Memberships.describe(
    `Every membership the user has. Known: ${membershipIds.join(', ')}.`,
  )

  return {
    CategoryInput,
    RecordCategoryInput,
    CatalogCategory,
    NamedCards,
    NamedMemberships,
    OfferFilters,
    CatalogFilters,
    AllMemberships,
  }
}

type FilterArgs = {
  kind?: 'any' | 'cash' | 'points' | undefined
  noAnnualFee?: boolean | undefined
  business?: boolean | undefined
  issuer?: string | undefined
  memberships?: string[] | undefined
  valuation?: 'flat' | 'points-heavy' | undefined
}

// The catalog filters as exploreCards and simulate take them. Memberships or
// a valuation profile asked for win over the user's saved ones.
export const settings = (
  args: FilterArgs,
  saved: Pick<Wallet, 'valuations' | 'memberships'> = {
    valuations: {},
    memberships: [],
  },
) => ({
  filters: {
    ...ALL_PERSONAL_CARDS,
    kind: args.kind ?? 'any',
    noAnnualFee: args.noAnnualFee ?? false,
    business: args.business ?? false,
    issuer: args.issuer ?? null,
  },
  memberships: args.memberships ?? saved.memberships,
  valuations: args.valuation
    ? VALUATION_PROFILES[args.valuation]
    : saved.valuations,
})
