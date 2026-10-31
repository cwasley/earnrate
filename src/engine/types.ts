import type { Network } from '../schema/common.ts'
import type { z } from 'zod'

export type Channel = 'online' | 'in_store'

export type Purchase = {
  merchant: string
  amount: number | null // dollars; null when unknown
  channel: Channel | null // null when unknown
  date: string // YYYY-MM-DD, decides cap periods, chosen-category quarters and rule windows
  country: string // ISO code; us_only rules need 'US'
}

export type Confidence = 'high' | 'medium' | 'low'

export type MerchantResolution = {
  input: string
  merchantId: string | null
  resolvedName: string
  category: string
  likelyMcc: number | null
  // null means unknown. A resolved merchant without an `accepts` list is
  // assumed to take all major networks.
  accepts: z.infer<typeof Network>[] | null
  ambiguity: { mayCodeAs: string[]; note: string } | null
  channel: Channel | null
  confidence: Confidence
  // 'caller': the category came with the request (an MCP client or --category)
  // for a merchant earnrate doesn't know. 'category': the question was about a
  // kind of purchase ("restaurants"), not a store.
  source: 'override' | 'seed' | 'llm' | 'caller' | 'category' | 'none'
  bookedVia: string[] // merchant ids for other ways to book the same thing
  inference: {
    model: string
    rationale: string
    classifiedOn: string // YYYY-MM-DD
    cached: boolean
  } | null // set only when source is 'llm'
}

export type RankedCard = {
  cardId: string
  cardName: string
  checkoutLabel: string | null
  matchedRule: string | null // null when only the base rate applies
  rate: number // currency units per dollar, blended across a cap when an amount is known
  currency: string // after pooling
  centsPerUnit: number
  effectiveReturnPct: number
  earned: number | null // dollars, when the amount is known
  capped: boolean // the winning rule has a cap
  reasoning: string[]
  warnings: string[]
}

export type ExcludedCard = {
  cardId: string
  cardName: string
  checkoutLabel: string | null
  network: z.infer<typeof Network>
  reason: string // about the merchant, so cards excluded for one reason share it
}

export type Recommendation = {
  decision: {
    cardId: string
    checkoutLabel: string | null
    effectiveReturnPct: number
    confidence: Confidence
  } | null
  merchant: MerchantResolution
  ranked: RankedCard[]
  excluded: ExcludedCard[]
  assumptions: string[]
  warnings: string[]
  notes: string[] // ties and what-ifs that aren't warnings
  sensitivity: string | null
  // Set when an open welcome bonus decides the pick over the best earner.
  bonus: {
    cardId: string
    checkoutLabel: string | null
    remaining: number // dollars of spend still needed
    deadline: string
    daysLeft: number
    value: number | null // dollars, at the wallet's point values
    costHere: number | null // dollars less than the best earner, when the amount is known
  } | null
}

export type RecordedPurchase = {
  cardId: string
  merchant: string
  amount: number
  date: string
  channel: Channel | null
}
