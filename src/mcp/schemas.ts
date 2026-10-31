import { z } from 'zod'
import { CapPeriod } from '../schema/card.ts'
import { CardNetwork, Network } from '../schema/common.ts'

// Mirrors the engine's result types. The SDK validates every structured
// result against these, so a drift between the two fails loudly in tests.

const Confidence = z.enum(['high', 'medium', 'low'])
const Channel = z.enum(['online', 'in_store'])

export const MerchantResolutionSchema = z.object({
  input: z.string(),
  merchantId: z.string().nullable(),
  resolvedName: z.string(),
  category: z.string(),
  likelyMcc: z.number().nullable(),
  accepts: z.array(Network).nullable(),
  ambiguity: z
    .object({ mayCodeAs: z.array(z.string()), note: z.string() })
    .nullable(),
  channel: Channel.nullable(),
  confidence: Confidence,
  source: z.enum(['override', 'seed', 'llm', 'caller', 'none']),
  bookedVia: z.array(z.string()),
  inference: z
    .object({
      model: z.string(),
      rationale: z.string(),
      classifiedOn: z.string(),
      cached: z.boolean(),
    })
    .nullable(),
})

const RankedCardSchema = z.object({
  cardId: z.string(),
  cardName: z.string(),
  checkoutLabel: z.string().nullable(),
  matchedRule: z.string().nullable(),
  rate: z.number(),
  currency: z.string(),
  centsPerUnit: z.number(),
  effectiveReturnPct: z.number(),
  earned: z.number().nullable(),
  capped: z.boolean(),
  reasoning: z.array(z.string()),
  warnings: z.array(z.string()),
})

export const RecommendationSchema = z.object({
  decision: z
    .object({
      cardId: z.string(),
      checkoutLabel: z.string().nullable(),
      effectiveReturnPct: z.number(),
      confidence: Confidence,
    })
    .nullable(),
  merchant: MerchantResolutionSchema,
  ranked: z.array(RankedCardSchema),
  excluded: z.array(
    z.object({
      cardId: z.string(),
      cardName: z.string(),
      checkoutLabel: z.string().nullable(),
      network: Network,
      reason: z.string(),
    }),
  ),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  notes: z.array(z.string()),
  sensitivity: z.string().nullable(),
  bonus: z
    .object({
      cardId: z.string(),
      checkoutLabel: z.string().nullable(),
      remaining: z.number(),
      deadline: z.string(),
      daysLeft: z.number(),
      value: z.number().nullable(),
      costHere: z.number().nullable(),
    })
    .nullable(),
})

export const WalletSummarySchema = z.object({
  memberships: z.array(z.string()),
  cards: z.array(
    z.object({
      cardId: z.string(),
      cardName: z.string(),
      checkoutLabel: z.string().nullable(),
      issuer: z.string(),
      network: CardNetwork,
      onlyAt: z.array(z.string()).nullable(),
      bonus: z
        .object({
          cardId: z.string(),
          opened: z.string(),
          spent: z.number(),
          spend: z.number().nullable(),
          deadline: z.string().nullable(),
          remaining: z.number().nullable(),
          daysLeft: z.number().nullable(),
          value: z.number().nullable(),
          state: z.enum(['open', 'met', 'expired', 'incomplete']),
        })
        .nullable(),
      currency: z.string(),
      centsPerUnit: z.number(),
      lastVerified: z.string(),
      verifiedBy: z.string(),
      dataIsStale: z.boolean(),
      rotationGap: z.string().nullable(),
      caps: z.array(
        z.object({
          key: z.string(),
          rules: z.array(z.string()),
          amount: z.number(),
          period: CapPeriod,
          currentPeriod: z.string().nullable(),
          spent: z.number(),
          remaining: z.number().nullable(),
        }),
      ),
      chosen: z
        .object({
          period: z.string(),
          current: z.boolean(),
          picks: z.record(z.string(), z.array(z.string())),
        })
        .nullable(),
      activated: z.array(z.string()),
      anniversary: z.string().nullable(),
    }),
  ),
})

export const RecordResultSchema = z.object({
  recorded: z.boolean(),
  booking: z
    .object({
      cardId: z.string(),
      capKey: z.string(),
      ruleId: z.string(),
      period: z.string(),
      capAmount: z.number(),
      before: z.number(),
      after: z.number(),
    })
    .nullable(),
  bonus: z
    .object({
      cardId: z.string(),
      before: z.number(),
      after: z.number(),
      spend: z.number(),
      deadline: z.string().nullable(),
    })
    .nullable(),
  message: z.string(),
})

export const OfferComparisonSchema = z.object({
  offers: z.array(
    z.object({
      cardId: z.string(),
      cardName: z.string(),
      issuer: z.string(),
      business: z.boolean(),
      currency: z.string(),
      centsPerUnit: z.number(),
      points: z.number().nullable(),
      dollars: z.number().nullable(),
      spend: z.number(),
      months: z.number(),
      validTo: z.string().nullable(),
      note: z.string().nullable(),
      annualFee: z.number().nullable(),
      firstYearFee: z.number().nullable(),
      bonusValue: z.number(),
      firstYearValue: z.number(),
      held: z.boolean(),
      lastVerified: z.string(),
      verifiedBy: z.string(),
    }),
  ),
  withoutOffer: z.array(z.string()),
  notes: z.array(z.string()),
})

export const CardSearchSchema = z.object({
  exact: z.boolean(),
  cards: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      issuer: z.string(),
      network: CardNetwork,
      currency: z.string(),
      annualFee: z.number().nullable(),
      business: z.boolean(),
      onlyAt: z.array(z.string()).nullable(),
      held: z.boolean(),
      choices: z.array(
        z.object({
          id: z.string(),
          pick: z.number(),
          period: z.enum([
            'month',
            'quarter',
            'calendar_year',
            'until_changed',
          ]),
          options: z.array(z.string()),
          default: z.array(z.string()).nullable(),
        }),
      ),
      memberships: z.array(z.string()),
      activation: z.array(z.string()),
      needsAnniversary: z.boolean(),
    }),
  ),
})

export const WalletChangeSchema = z.object({
  message: z.string(),
  created: z.boolean(),
  cardIds: z.array(z.string()),
  memberships: z.array(z.string()),
  notes: z.array(
    z.object({
      kind: z.enum([
        'pick',
        'membership',
        'activation',
        'anniversary',
        'rotation',
      ]),
      text: z.string(),
    }),
  ),
})

const ExcludedCardSchema = z.object({
  cardId: z.string(),
  cardName: z.string(),
  checkoutLabel: z.string().nullable(),
  network: Network,
  reason: z.string(),
})

const Picks = z.record(z.string(), z.array(z.string()))

export const ExplorationSchema = z.object({
  merchant: MerchantResolutionSchema,
  ranked: z.array(
    RankedCardSchema.extend({
      issuer: z.string(),
      network: CardNetwork,
      annualFee: z.number().nullable(),
      firstYearFee: z.number().nullable(),
      picks: Picks,
      requirements: z.object({
        pick: z
          .object({
            choice: z.string(),
            options: z.array(z.string()),
            period: z.string(),
          })
          .nullable(),
        activation: z.string().nullable(),
        membership: z.string().nullable(),
        cap: z
          .object({
            amount: z.number(),
            period: z.string(),
            thenRate: z.number(),
            currency: z.string(),
          })
          .nullable(),
      }),
      conditions: z.array(z.string()),
      evidence: z.object({ quote: z.string(), url: z.string() }).nullable(),
      withMembership: z.array(
        z.object({ membership: z.string(), effectiveReturnPct: z.number() }),
      ),
    }),
  ),
  excluded: z.array(ExcludedCardSchema),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
})

const SimulationSchema = z.object({
  cards: z.array(z.object({ cardId: z.string(), picks: Picks })),
  spend: z.number(),
  rewards: z.number(),
  annualFees: z.number(),
  net: z.number(),
  lines: z.array(
    z.object({
      label: z.string(),
      spend: z.number(),
      earned: z.number(),
      returnPct: z.number(),
      cards: z.array(z.string()),
    }),
  ),
  notes: z.array(z.string()),
})

export const SpendingSimulationSchema = z.object({
  singles: z.array(SimulationSchema),
  pairs: z.array(
    SimulationSchema.extend({ alternatives: z.array(z.string()) }),
  ),
  current: SimulationSchema.nullable(),
  additions: z.array(
    z.object({
      cardId: z.string(),
      picks: Picks,
      extraRewards: z.number(),
      annualFee: z.number(),
      gain: z.number(),
    }),
  ),
})
