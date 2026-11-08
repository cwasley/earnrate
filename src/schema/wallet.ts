import { z } from 'zod'
import {
  CurrencyId,
  IsoDate,
  KebabId,
  PeriodKey,
  ValueRange,
} from './common.ts'
import {
  CARD_NUMBER_LABEL,
  CARD_NUMBER_REDEMPTION,
  hasCardNumber,
  labelHasCardNumber,
} from './card-number.ts'

const Valuation = z.union([
  z.number().positive(),
  z.strictObject({
    value: z.number().positive().optional(),
    range: ValueRange.optional(),
    redemption: z
      .string()
      .refine((t) => !hasCardNumber(t), CARD_NUMBER_REDEMPTION)
      .optional(),
  }),
])

const CapUsage = z.strictObject({
  period: PeriodKey,
  spent: z.number().nonnegative(), // dollars
})

const CreditUsage = z.strictObject({
  period: PeriodKey,
  used: z.number().nonnegative(), // dollars of credit
})

export const WalletCardSchema = z.strictObject({
  id: KebabId,
  checkout_label: z
    .string()
    .min(1)
    .refine((t) => !labelHasCardNumber(t), CARD_NUMBER_LABEL)
    .optional(),
  // MM-DD: for cardmember_year caps and a fee card's renewal check. The
  // opening date stands in for the renewal check when this isn't set.
  anniversary: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .optional(),
  // The day the account opened, for rates that apply only for a stretch
  // after it (intro_rates). bonus.opened stands in when this isn't set.
  opened: IsoDate.optional(),
  // Keyed by shared cap id, or by rule id for an inline cap.
  cap_usage: z.record(KebabId, CapUsage).default({}),
  chosen: z
    .strictObject({
      period: PeriodKey,
      picks: z.record(KebabId, z.array(KebabId).min(1)),
    })
    .optional(),
  activated: z.array(KebabId).default([]),
  // Keyed by milestone id: every purchase on the card this period.
  milestone_usage: z.record(KebabId, CapUsage).optional(),
  // Merchant credits (the card's `credits`) the cardholder has enrolled in
  // or, for ones that need no enrolling, says they use, by credit id, and
  // free nights (`free_nights`) they say they use; and the dollars of each
  // credit already received this period.
  enrolled: z.array(KebabId).optional(),
  credit_usage: z.record(KebabId, CreditUsage).optional(),
  // Credits and free nights the cardholder doesn't use: left out of the
  // pick, the to-do list and the fee math, even if enrolled.
  skipped_credits: z.array(KebabId).optional(),
  // A welcome bonus in progress. Terms default to the card's published
  // offer; set spend, by, points or dollars when yours was different.
  bonus: z
    .strictObject({
      opened: IsoDate,
      spent: z.number().nonnegative().default(0), // dollars toward it so far
      spend: z.number().nonnegative().optional(),
      by: IsoDate.optional(),
      points: z.number().positive().optional(),
      dollars: z.number().positive().optional(),
    })
    .optional(),
})

// The wallet file's format. A file without `version` is version 1; bump it
// when a change would make older earnrate misread newer files.
export const WALLET_VERSION = 1

export const WalletSchema = z.strictObject({
  version: z.number().int().positive().optional(),
  valuations: z.record(CurrencyId, Valuation).default({}),
  memberships: z.array(KebabId).default([]),
  // Issuers whose new cards the person can't or won't get (Chase over
  // 5/24): left out of next-card answers. Never assumed.
  skipped_issuers: z.array(KebabId).optional(),
  cards: z.array(WalletCardSchema).default([]),
})

export type WalletCard = z.output<typeof WalletCardSchema>
export type Wallet = z.output<typeof WalletSchema>
