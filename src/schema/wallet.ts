import { z } from 'zod'
import {
  CurrencyId,
  IsoDate,
  KebabId,
  PeriodKey,
  ValueRange,
} from './common.ts'

const Valuation = z.union([
  z.number().positive(),
  z.strictObject({
    value: z.number().positive().optional(),
    range: ValueRange.optional(),
    redemption: z.string().optional(),
  }),
])

const CapUsage = z.strictObject({
  period: PeriodKey,
  spent: z.number().nonnegative(), // dollars
})

export const WalletCardSchema = z.strictObject({
  id: KebabId,
  checkout_label: z.string().min(1).optional(),
  // MM-DD, needed only for cardmember_year caps.
  anniversary: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .optional(),
  // Keyed by shared cap id, or by rule id for an inline cap.
  cap_usage: z.record(KebabId, CapUsage).default({}),
  chosen: z
    .strictObject({
      period: PeriodKey,
      picks: z.record(KebabId, z.array(KebabId).min(1)),
    })
    .optional(),
  activated: z.array(KebabId).default([]),
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

export const WalletSchema = z.strictObject({
  valuations: z.record(CurrencyId, Valuation).default({}),
  memberships: z.array(KebabId).default([]),
  cards: z.array(WalletCardSchema).min(1),
})

export type WalletCard = z.output<typeof WalletCardSchema>
export type Wallet = z.output<typeof WalletSchema>
