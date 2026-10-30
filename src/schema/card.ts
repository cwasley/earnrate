import { z } from 'zod'
import {
  CardNetwork,
  CategoryId,
  CurrencyId,
  IsoDate,
  KebabId,
  Mcc,
} from './common.ts'

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

export const SharedCapSchema = CapSchema.extend({
  id: KebabId,
  // Rotating categories (Freedom Flex): every rule on this cap covers one
  // dated period, and a period with no rule means the issuer's categories
  // aren't in the data yet, not that there's no bonus.
  rotating: z.literal(true).optional(),
})

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
  })
  .refine(hasAny, 'exclude needs categories, merchants or mccs')

export const RuleSchema = z
  .strictObject({
    id: KebabId,
    match: MatchSchema,
    exclude: ExcludeSchema.optional(),
    rate: z.number().nonnegative(), // currency units per dollar
    channel: z.enum(['any', 'online', 'in_store']).default('any'),
    geography: z.enum(['us_only', 'worldwide']).default('worldwide'),
    // Inline cap, or the id of a shared cap in the card's `caps`.
    cap: z.union([CapSchema, KebabId]).optional(),
    requires: z
      .strictObject({
        membership: KebabId.optional(),
        activation: z.boolean().optional(),
      })
      .optional(),
    valid_from: IsoDate.optional(),
    valid_to: IsoDate.optional(),
    // Set when a rule isn't confirmed against the issuer's terms. The engine
    // warns when an unverified rule decides the winner.
    unverified: z.string().optional(),
    note: z.string().optional(),
  })
  .refine(
    (r) => !r.valid_from || !r.valid_to || r.valid_from <= r.valid_to,
    'valid_from must not be after valid_to',
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

export const CardSchema = z
  .strictObject({
    id: KebabId,
    name: z.string().min(1),
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
    annual_fee: z.number().nonnegative().optional(), // dollars
    // When the first year differs, usually a waived fee.
    first_year_fee: z.number().nonnegative().optional(),
    welcome_offer: WelcomeOfferSchema.optional(),
    pools_into: z
      .strictObject({
        currency: CurrencyId,
        when_wallet_has: z.array(KebabId).min(1),
      })
      .optional(),
    caps: z.array(SharedCapSchema).default([]),
    choices: z.array(ChoiceSchema).default([]),
    rules: z.array(RuleSchema).default([]),
    // A short quote from an issuer page for each rule (or `base_rate`). The
    // weekly source check fails a rule whose quote disappears from its page.
    evidence: z
      .array(
        z.strictObject({
          rule: z.string().min(1),
          url: z.url(),
          quote: z.string().min(1),
        }),
      )
      .default([]),
    // Known gaps in this file, surfaced as warnings.
    todo: z.array(z.string()).default([]),
  })
  .refine(
    (c) => (c.network === 'store') === (c.only_at !== undefined),
    'a store card needs only_at, and only a store card can have it',
  )

export type Cap = z.output<typeof CapSchema>
export type SharedCap = z.output<typeof SharedCapSchema>
export type Rule = z.output<typeof RuleSchema>
export type Choice = z.output<typeof ChoiceSchema>
export type WelcomeOffer = z.output<typeof WelcomeOfferSchema>
export type Card = z.output<typeof CardSchema>
