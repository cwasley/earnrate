import { z } from 'zod'
import { CategoryId, KebabId, Mcc, Network } from './common.ts'

// Omitted means unknown, which the engine treats differently from "all networks".
const Accepts = z.array(Network).min(1)

const ChannelOverride = z.strictObject({
  category: CategoryId.optional(),
  likely_mcc: Mcc.optional(),
  accepts: Accepts.optional(),
})

export const MerchantSchema = z.strictObject({
  id: KebabId,
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  domains: z.array(z.string().min(1)).default([]),
  category: CategoryId,
  likely_mcc: Mcc.optional(),
  accepts: Accepts.optional(),
  in_store: ChannelOverride.optional(),
  online: ChannelOverride.optional(),
  // The purchase may not code as `category`, e.g. a restaurant inside a hotel.
  ambiguity: z
    .strictObject({
      may_code_as: z.array(CategoryId).min(1),
      note: z.string().min(1),
    })
    .optional(),
  // Other ways to buy the same thing, e.g. through a card's travel site, that
  // can earn more. Answers mention them when they would.
  booked_via: z.array(KebabId).default([]),
  note: z.string().optional(),
})

export const MerchantsFileSchema = z.array(MerchantSchema)

export type Merchant = z.output<typeof MerchantSchema>
