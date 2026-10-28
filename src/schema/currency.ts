import { z } from 'zod'
import { CurrencyId, ValueRange } from './common.ts'

export const CurrencySchema = z.strictObject({
  id: CurrencyId,
  name: z.string().min(1),
  // Default cents per unit earned. Cash back is 1 (a 5% rate earns 5 units per dollar).
  value_cents: z.number().positive(),
  range: ValueRange.optional(),
  // Value per redemption option, for currencies whose worth depends on how
  // they're redeemed. A wallet picks one by key.
  redemptions: z.record(z.string(), z.number().positive()).optional(),
  sources: z.array(z.url()).default([]),
  note: z.string().optional(),
})

export const CurrenciesFileSchema = z.array(CurrencySchema).min(1)

export type Currency = z.output<typeof CurrencySchema>
