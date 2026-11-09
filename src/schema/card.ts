import { z } from 'zod'
import {
  CardNetwork,
  CategoryId,
  CurrencyId,
  IsoDate,
  KebabId,
  Mcc,
} from './common.ts'

// Evidence for the welcome offer's terms, which change more often than any
// rate and are worse stale than missing.
export const OFFER_RULES: ReadonlySet<string> = new Set([
  'welcome_offer',
  'not_with',
  'first_year_fee',
])

// `month` stands in for a billing cycle, which earnrate can't see.
export const CapPeriod = z.enum([
  'month',
  'quarter',
  'calendar_year',
  'cardmember_year',
])

export const CapSchema = z.strictObject({
  amount: z.number().positive(), // dollars of spend per period
  period: CapPeriod,
  then_rate: z.number().nonnegative(),
})

// A bonus paid once a period after a spending total, rather than per dollar
// ("10,000 bonus points after you spend $15,000 on purchases each calendar
// year"). Every purchase on the card counts. Only `points` is valued;
// `rewards` (status, night credits, free nights) is shown, never valued.
export const MilestoneSchema = z
  .strictObject({
    id: KebabId,
    spend: z.number().positive(), // dollars of purchases in the period
    period: z.enum(['calendar_year', 'cardmember_year']),
    points: z.number().positive().optional(), // in the card's currency
    rewards: z.array(z.string().min(1)).min(1).optional(),
    // The day the issuer starts it, for one announced ahead: spending counts
    // from then.
    valid_from: IsoDate.optional(),
    note: z.string().optional(),
  })
  .refine(
    (m) => m.points !== undefined || m.rewards !== undefined,
    'a milestone needs points, rewards or both',
  )

export const SharedCapSchema = CapSchema.extend({
  id: KebabId,
  // Rotating categories (Freedom Flex): every rule on this cap covers one
  // dated period, and a period with no rule means the issuer's categories
  // aren't in the data yet, not that there's no bonus.
  rotating: z.literal(true).optional(),
})

// How a purchase is paid, for rates that depend on it: Apple Card's 2% with
// Apple Pay, PayPal Cashback's 3% through PayPal checkout. `card` is the card
// itself or its number, not a phone wallet or PayPal. Unknown unless the
// person says, so a rule that requires one never applies by assumption.
export const PaymentMethod = z.enum([
  'card',
  'apple-pay',
  'google-pay',
  'paypal',
])
export type PaymentMethod = z.output<typeof PaymentMethod>

const hasAny = (m: Record<string, unknown[] | string | true | undefined>) =>
  Object.values(m).some((v) => v === true || (v !== undefined && v.length > 0))

// Kinds combine with AND, values within a kind with OR: `{ merchants:
// [lyft], categories: [transit] }` is a Lyft purchase that codes as transit.
export const MatchSchema = z
  .strictObject({
    categories: z.array(CategoryId).optional(),
    merchants: z.array(KebabId).optional(),
    mccs: z.array(Mcc).optional(),
    // Id of a card choice slot; matches whatever the wallet picked for it.
    choice: KebabId.optional(),
    // Every purchase, for "2x on everything up to a cap" style rules.
    any: z.literal(true).optional(),
  })
  .refine(hasAny, 'match needs categories, merchants, mccs, choice or any')

export const ExcludeSchema = z
  .strictObject({
    categories: z.array(CategoryId).optional(),
    merchants: z.array(KebabId).optional(),
    mccs: z.array(Mcc).optional(),
    payment: z.array(PaymentMethod).optional(),
  })
  .refine(hasAny, 'exclude needs categories, merchants, mccs or payment')

export const RuleSchema = z
  .strictObject({
    id: KebabId,
    match: MatchSchema,
    exclude: ExcludeSchema.optional(),
    rate: z.number().nonnegative(), // currency units per dollar
    channel: z.enum(['any', 'online', 'in_store']).default('any'),
    // A purchase is foreign when its country isn't the U.S.
    geography: z
      .enum(['us_only', 'foreign_only', 'worldwide'])
      .default('worldwide'),
    // Only a purchase of at least this many dollars. Unknown without an
    // amount, so then it never applies by assumption.
    min_amount: z.number().positive().optional(),
    // Inline cap, or the id of a shared cap in the card's `caps`.
    cap: z.union([CapSchema, KebabId]).optional(),
    requires: z
      .strictObject({
        membership: KebabId.optional(),
        activation: z.boolean().optional(),
        payment: PaymentMethod.optional(),
      })
      .optional(),
    valid_from: IsoDate.optional(),
    valid_to: IsoDate.optional(),
    // The issuer's last day to activate a bonus that needs it.
    activate_by: IsoDate.optional(),
    // Set when a rule isn't confirmed against the issuer's terms. The engine
    // warns when an unverified rule decides the winner.
    unverified: z.string().optional(),
    note: z.string().optional(),
  })
  .refine(
    (r) => !r.valid_from || !r.valid_to || r.valid_from <= r.valid_to,
    'valid_from must not be after valid_to',
  )
  .refine(
    (r) => r.activate_by === undefined || r.requires?.activation === true,
    'activate_by needs requires.activation',
  )

// The public sign-up bonus on the issuer's page. Offers vary by person and
// channel, so a wallet can override it.
export const WelcomeOfferSchema = z
  .strictObject({
    // Exactly one: points in the card's currency, or dollars for cash back
    // and statement credits.
    points: z.number().positive().optional(),
    dollars: z.number().positive().optional(),
    spend: z.number().nonnegative(), // dollars of purchases required
    months: z.number().int().positive(), // from account opening
    valid_to: IsoDate.optional(), // when the issuer says the offer ends
    // The issuer shows each applicant their own amount ("as high as"), or
    // the page showed different offers on different visits. The amount
    // above is then the most it shows.
    varies: z.literal(true).optional(),
    // Other cards whose holders the issuer says can't get this offer
    // (Southwest's personal cards, Blue Cash Everyday with Preferred).
    not_with: z.array(KebabId).min(1).optional(),
    note: z.string().optional(),
  })
  .refine(
    (o) => (o.points === undefined) !== (o.dollars === undefined),
    'a welcome offer needs points or dollars, not both',
  )

export const ChoiceSchema = z.strictObject({
  id: KebabId,
  pick: z.number().int().positive(),
  // `until_changed`: the pick carries over until the cardholder changes it,
  // so a pick made in an earlier period is still current.
  period: z.enum(['month', 'quarter', 'calendar_year', 'until_changed']),
  // The issuer applies the bonus to the options with the most spending each
  // period (Citi Custom Cash). A wallet's pick is the one the cardholder
  // expects, and wording never says the cardholder picks.
  automatic: z.literal(true).optional(),
  // Option ids that apply when the wallet hasn't picked, e.g. Bilt's dining.
  default: z.array(KebabId).min(1).optional(),
  // Option id → what that option covers: a list of categories; or, when the
  // issuer publishes the only qualifying stores, `{ merchants: [...] }`; or,
  // for "online shopping" picks, `{ channel: online, exclude: [...] }`, any
  // online purchase outside the excluded categories.
  options: z.record(
    KebabId,
    z.union([
      z
        .array(CategoryId)
        .min(1)
        .transform((categories) => ({
          categories,
          merchants: [] as string[],
          online: null,
        })),
      z
        .strictObject({ merchants: z.array(KebabId).min(1) })
        .transform(({ merchants }) => ({
          categories: [] as string[],
          merchants,
          online: null,
        })),
      z
        .strictObject({
          channel: z.literal('online'),
          exclude: z.array(CategoryId).default([]),
        })
        .transform(({ exclude }) => ({
          categories: [] as string[],
          merchants: [] as string[],
          online: { exclude },
        })),
    ]),
  ),
})

// Counted from the opening day. With `rules`, it changes only those rules'
// rates, inside their caps; past a cap they earn what they always do.
// Without, it changes every rate on the card, past caps included.
export const IntroRateSchema = z
  .strictObject({
    id: KebabId,
    days: z.number().int().positive(),
    rules: z.array(KebabId).min(1).optional(),
    multiply: z.number().positive().optional(),
    add: z.number().positive().optional(), // currency units per dollar
    note: z.string().optional(),
  })
  .refine(
    (i) => (i.multiply === undefined) !== (i.add === undefined),
    'an intro rate needs multiply or add, not both',
  )

// Separate from earn rates: the purchase still earns the card's rate on its
// whole amount, and the credit comes on top. `half_year` runs January to June
// and July to December.
export const CreditPeriod = z.enum([...CapPeriod.options, 'half_year'])

export const CreditSchema = z.strictObject({
  id: KebabId,
  match: z
    .strictObject({
      merchants: z.array(KebabId).min(1).optional(),
      categories: z.array(CategoryId).min(1).optional(),
    })
    .refine(
      (m) => (m.merchants === undefined) !== (m.categories === undefined),
      'a credit matches merchants or categories, not both',
    ),
  amount: z.number().positive(), // dollars of credit per period
  period: CreditPeriod,
  // The cardholder must enroll with the issuer before it pays.
  enroll: z.literal(true).optional(),
  // It pays only on a purchase of at least this many dollars.
  min_amount: z.number().positive().optional(),
  // The issuer's last day for it. Past it the credit counts nowhere, and a
  // year's worth counts only the periods that start by then.
  valid_to: IsoDate.optional(),
  note: z.string().optional(),
})

// A free night the issuer gives once each cardmember year, around the
// account anniversary, with no spending needed (IHG's Anniversary Free
// Night). One entry is one certificate a year. Nights earned by spending
// are milestone `rewards` instead.
export const FreeNightSchema = z.strictObject({
  id: KebabId,
  // The most a night can cost, in the card's own currency: its value is
  // this at the person's point value, said as "up to". Without a cap (any
  // standard room) it's valued only at what the cardholder says it's worth.
  points: z.number().int().positive().optional(),
  note: z.string().optional(),
})

const HexColor = z.string().regex(/^#[0-9a-f]{6}$/)

export const CardSchema = z
  .strictObject({
    id: KebabId,
    name: z.string().min(1),
    // A name that fits one line of the Wallet pass's strip (24 characters),
    // for cards whose name is longer: "AAdvantage Platinum".
    short_name: z.string().min(1).max(24).optional(),
    // The card face's main color, roughly, for earnrate's drawing of the
    // card. Never the issuer's card art.
    color: HexColor.optional(),
    issuer: z.string().min(1),
    network: CardNetwork,
    // Merchant ids a store card works at. Required for, and only for, `store`.
    only_at: z.array(KebabId).min(1).optional(),
    currency: CurrencyId,
    last_verified: IsoDate,
    // Who last checked the rules against source_urls, e.g. claude or collin.
    verified_by: z.string().min(1),
    source_urls: z.array(z.url()).min(1),
    base_rate: z.number().nonnegative(),
    business: z.boolean().default(false),
    // When the issuer stopped taking applications; cardholders keep earning.
    applications_closed: IsoDate.optional(),
    annual_fee: z.number().nonnegative().optional(), // dollars
    // When the first year differs, usually a waived fee.
    first_year_fee: z.number().nonnegative().optional(),
    // Percent of each purchase outside the U.S.; 0 when there's none. null
    // only when no issuer page states it, with a todo saying so.
    foreign_transaction_fee: z.number().nonnegative().nullable(),
    welcome_offer: WelcomeOfferSchema.optional(),
    // A paid membership (data/memberships.yaml) the card can't be had
    // without, Costco's for Costco Anywhere. Its fee counts like an annual
    // fee for anyone not already paying it.
    requires_membership: KebabId.optional(),
    pools_into: z
      .strictObject({
        currency: CurrencyId,
        when_wallet_has: z.array(KebabId).min(1),
      })
      .optional(),
    caps: z.array(SharedCapSchema).default([]),
    choices: z.array(ChoiceSchema).default([]),
    rules: z.array(RuleSchema).default([]),
    milestones: z.array(MilestoneSchema).default([]),
    intro_rates: z.array(IntroRateSchema).default([]),
    credits: z.array(CreditSchema).default([]),
    // Wallets mark these used or skipped by id beside credits, so the two
    // lists share one id space.
    free_nights: z.array(FreeNightSchema).default([]),
    // A short quote from an issuer page for each rule (or `base_rate`, or a
    // credit's id). The weekly source check fails a rule whose quote
    // disappears from its page.
    evidence: z
      .array(
        z
          .strictObject({
            rule: z.string().min(1),
            url: z.url(),
            quote: z.string().min(1),
            // Set only after seeing the quote in a popup the page builds on
            // click from its embedded data; other quotes must be in its text.
            in_popup: z.literal(true).optional(),
            // Offer quotes (OFFER_RULES) must be in the text the page shows,
            // since issuers leave old offers in hidden markup. Set only after
            // seeing the quote in a section of the current page that opens on
            // click (an accordion or overlay of offer details, a closed tab).
            in_collapsed: z.literal(true).optional(),
          })
          .refine(
            (e) => e.in_collapsed !== true || OFFER_RULES.has(e.rule),
            'in_collapsed is only for offer quotes; other quotes already match hidden text',
          ),
      )
      .default([]),
    // Known gaps in this file, surfaced as warnings.
    todo: z.array(z.string()).default([]),
  })
  .refine(
    (c) => (c.network === 'store') === (c.only_at !== undefined),
    'a store card needs only_at, and only a store card can have it',
  )
  .refine(
    (c) =>
      !c.free_nights.some((n) => c.credits.some((x) => x.id === n.id)) &&
      new Set(c.free_nights.map((n) => n.id)).size === c.free_nights.length,
    'free night ids must differ from each other and from credit ids',
  )

export type Cap = z.output<typeof CapSchema>
export type Rule = z.output<typeof RuleSchema>
export type Choice = z.output<typeof ChoiceSchema>
export type Card = z.output<typeof CardSchema>
export type Milestone = z.output<typeof MilestoneSchema>
export type IntroRate = z.output<typeof IntroRateSchema>
export type Credit = z.output<typeof CreditSchema>
export type FreeNight = z.output<typeof FreeNightSchema>
