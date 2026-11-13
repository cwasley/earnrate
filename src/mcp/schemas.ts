import { z } from 'zod'
import { CapPeriod, CreditPeriod, MilestoneSchema } from '../schema/card.ts'

const MilestonePeriod = MilestoneSchema.shape.period
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
  source: z.enum(['override', 'seed', 'llm', 'caller', 'category', 'none']),
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
  foreignFee: z.number().nullable(),
  milestoneBonus: z
    .object({ points: z.number(), dollars: z.number() })
    .nullable(),
  credit: z
    .object({
      id: z.string(),
      name: z.string(),
      amount: z.number(),
      month_amounts: z.record(z.string(), z.number()).optional(),
      periodAmount: z.number(),
      period: CreditPeriod,
      enrolled: z.boolean(),
      left: z.number().nullable(),
      until: z.string().nullable(),
      dollars: z.number().nullable(),
    })
    .nullable(),
  capped: z.boolean(),
  reasoning: z.array(z.string()),
  warnings: z.array(z.string()),
})

const IfPayingSchema = z.array(
  z.object({
    cardId: z.string(),
    cardName: z.string(),
    payment: z.string(),
    earn: z.string(),
  }),
)

const RecommendationSchema = z.object({
  decision: z
    .object({
      cardId: z.string(),
      checkoutLabel: z.string().nullable(),
      effectiveReturnPct: z.number(),
      confidence: Confidence,
    })
    .nullable(),
  merchant: MerchantResolutionSchema,
  categoryNote: z.string().nullable(),
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
  // Ways of paying that would put a card at the top, when payment is unknown.
  ifPaying: IfPayingSchema,
})

export const WalletSummarySchema = z.object({
  memberships: z.array(z.string()),
  membershipNames: z.array(z.string()),
  skippedIssuers: z.array(z.object({ id: z.string(), name: z.string() })),
  pointValues: z.array(
    z.object({
      currency: z.string(),
      name: z.string(),
      centsPerUnit: z.number(),
      redemption: z.string().nullable(),
    }),
  ),
  started: z.string().nullable(),
  checklist: z
    .array(
      z.object({
        kind: z.enum([
          'activate',
          'pick',
          'cap',
          'bonus',
          'milestone',
          'rotation',
          'intro',
          'credit',
          'enroll',
          'renewal',
          'change',
        ]),
        cardId: z.string(),
        ref: z.string().optional(),
        text: z.string(),
        due: z.string().nullable(),
        url: z.string().optional(),
      }),
    )
    .optional(),
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
      currencyName: z.string(),
      centsPerUnit: z.number(),
      lastVerified: z.string(),
      verifiedBy: z.string(),
      dataIsStale: z.boolean(),
      rotationGap: z.string().nullable(),
      caps: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          rules: z.array(z.string()),
          amount: z.number(),
          period: CapPeriod,
          currentPeriod: z.string().nullable(),
          until: z.string().nullable(),
          spent: z.number(),
          remaining: z.number().nullable(),
          afterCap: z.string(),
        }),
      ),
      milestones: z.array(
        z.object({
          id: z.string(),
          spend: z.number(),
          period: MilestonePeriod,
          currentPeriod: z.string().nullable(),
          until: z.string().nullable(),
          spent: z.number(),
          tracked: z.boolean(),
          points: z.number().nullable(),
          rewards: z.array(z.string()),
          text: z.string(),
        }),
      ),
      credits: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          amount: z.number(),
          periodAmount: z.number(), // this period's: a month can pay more
          period: CreditPeriod,
          enroll: z.boolean(),
          enrolled: z.boolean(),
          skipped: z.boolean(), // the user doesn't use it: not counted anywhere
          confirmed: z.boolean(), // said in use: counts against the annual fee
          currentPeriod: z.string().nullable(),
          until: z.string().nullable(),
          used: z.number(),
          left: z.number().nullable(),
          tracked: z.boolean(),
          // earnrate can't tell which purchases it pays on: never counted
          // toward one, used only as the user marks it (creditUsed).
          listed: z.boolean(),
          text: z.string(),
        }),
      ),
      // One a year each, after the anniversary; marked used (in enrolled)
      // or not used (skippedCredits) by id, like a credit.
      freeNights: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          points: z.number().nullable(), // the most a night can cost; null without a cap
          value: z.number().nullable(), // dollars at the user's point value: "up to"
          ownValue: z.number().nullable(), // what the user says it's worth, counted instead
          confirmed: z.boolean(), // said in use: counts against the annual fee
          skipped: z.boolean(),
          text: z.string(),
        }),
      ),
      usedCredits: z.number(), // a year, counted against the annual fee
      usedCreditsText: z.string().nullable(),
      chosen: z
        .object({
          period: z.string(),
          periodName: z.string(),
          automatic: z.boolean(),
          current: z.boolean(),
          until: z.string().nullable(),
          picks: z.record(z.string(), z.array(z.string())),
          pickNames: z.record(z.string(), z.array(z.string())),
        })
        .nullable(),
      rates: z.array(z.string()),
      activated: z.array(z.string()),
      toActivate: z.array(z.string()),
      anniversary: z.string().nullable(),
      opened: z.string().nullable(),
      intro: z
        .object({
          state: z.enum(['active', 'ended', 'no-date']),
          until: z.string().nullable(),
          days: z.number(),
        })
        .nullable(),
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
      periodKind: z.enum([
        'month',
        'quarter',
        'calendar_year',
        'cardmember_year',
      ]),
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
  milestones: z.array(
    z.object({
      cardId: z.string(),
      milestoneId: z.string(),
      period: z.string(),
      periodKind: z.enum(['calendar_year', 'cardmember_year']),
      spend: z.number(),
      before: z.number(),
      after: z.number(),
      started: z.boolean(),
    }),
  ),
  credit: z
    .object({
      cardId: z.string(),
      creditId: z.string(),
      name: z.string(),
      period: z.string(),
      periodKind: CreditPeriod,
      amount: z.number(),
      before: z.number(),
      after: z.number(),
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
      varies: z.boolean(), // the amount is the most the issuer shows
      note: z.string().nullable(),
      annualFee: z.number().nullable(),
      firstYearFee: z.number().nullable(),
      ineligible: z.string().nullable(),
      bonusValue: z.number(),
      firstYearValue: z.number(),
      // Statement credits, a year at face value, and the first-year value
      // if all were used. Not ranked on.
      credits: z.number(),
      firstYearValueIfCreditsUsed: z.number(),
      // Its free nights a year from the first anniversary, "up to": not
      // ranked on, and not in the first year.
      freeNights: z.number(),
      // On the user's spending beside their cards; null for a card they hold.
      plan: z
        .object({
          extraRewards: z.number(),
          minimumSpend: z
            .object({ reachable: z.boolean(), weeks: z.number() })
            .nullable(),
          yearOne: z.number(),
          yearTwo: z.number(),
          twoYears: z.number(),
        })
        .nullable(),
      held: z.boolean(),
      lastVerified: z.string(),
      verifiedBy: z.string(),
    }),
  ),
  // Offers on cards that need a membership the user hasn't given, valued for
  // a member, that would have placed among those shown.
  membersOnly: z.array(
    z.object({
      cardId: z.string(),
      cardName: z.string(),
      membership: z.string(),
      twoYears: z.number().nullable(),
      firstYearValue: z.number(),
    }),
  ),
  withoutOffer: z.array(z.string()),
  typical: z.boolean(),
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
      firstYearFee: z.number().nullable(),
      foreignTransactionFee: z.number().nullable(),
      business: z.boolean(),
      onlyAt: z.array(z.string()).nullable(),
      ratesNote: z.string().nullable(),
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
          automatic: z.boolean(),
          options: z.array(z.string()),
          default: z.array(z.string()).nullable(),
        }),
      ),
      memberships: z.array(z.string()),
      requiresMembership: z
        .object({ id: z.string(), name: z.string(), annualFee: z.number() })
        .nullable(),
      activation: z.array(z.string()),
      activationOpens: z.record(z.string(), z.string()), // rule id: the day activation opens
      needsAnniversary: z.boolean(),
      milestones: z.array(
        z.object({
          id: z.string(),
          spend: z.number(),
          period: MilestonePeriod,
          points: z.number().nullable(),
          rewards: z.array(z.string()),
          text: z.string(),
        }),
      ),
      introRates: z.array(
        z.object({ id: z.string(), days: z.number(), text: z.string() }),
      ),
      credits: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          amount: z.number(),
          period: CreditPeriod,
          enroll: z.boolean(),
          listed: z.boolean(), // never counted toward a purchase
          text: z.string(),
        }),
      ),
      freeNights: z.array(
        z.object({
          id: z.string(),
          points: z.number().nullable(), // null without a cap
          value: z.number().nullable(), // dollars, "up to"
          ownValue: z.number().nullable(), // on a card the user holds
          text: z.string(),
        }),
      ),
      // Every cardmember year with nothing to enroll in: counted in yearly
      // figures (simulate_spending, the fee math), never in one purchase's.
      yearlyPoints: z.array(
        z.object({
          id: z.string(),
          points: z.number().nullable(), // a fixed amount a year
          percent: z.number().nullable(), // or a percent of the year's purchases or points
          of: z.enum(['purchases', 'points']).nullable(),
          value: z.number().nullable(), // the fixed amount in dollars
          text: z.string(),
        }),
      ),
      // Null when the search found more cards than it details.
      earning: z.array(z.string()).nullable(),
      // Null without an annual fee. Dollars a month of the mix's spending.
      feeWorth: z
        .object({
          annualFee: z.number(),
          mix: z.array(z.object({ label: z.string(), share: z.number() })),
          everywhere: z.boolean(),
          breakEven: z.number().nullable(),
          stopsAt: z.number().nullable(),
          creditsYearly: z.number().nullable(),
          creditsBreakEven: z.number().nullable(),
          creditsStopAt: z.number().nullable(),
          centsPerUnit: z.number(),
          savedValue: z.boolean(),
          rivals: z.number(),
          transfer: z
            .object({ cents: z.number(), breakEven: z.number().nullable() })
            .nullable(),
          text: z.string(),
        })
        .nullable(),
      // Null when the search found more cards than it details.
      changes: z.array(z.string()).nullable(),
      welcomeOffer: z.string().nullable(),
    }),
  ),
  detailed: z.boolean(), // earning and feeWorth were worked out
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

const ExploreEntrySchema = RankedCardSchema.extend({
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
        automatic: z.boolean(),
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
  needsMembership: z.string().nullable(),
})

export const ExplorationSchema = z.object({
  merchant: MerchantResolutionSchema,
  // About this kind of purchase; shown before the ranking.
  categoryNote: z.string().nullable(),
  // Cards with a statement credit at this store, shown before the ranking.
  credits: z.array(
    z.object({
      cardId: z.string(),
      cardName: z.string(),
      issuer: z.string(),
      network: CardNetwork,
      annualFee: z.number().nullable(),
      firstYearFee: z.number().nullable(),
      creditId: z.string(),
      name: z.string(),
      amount: z.number(),
      period: CreditPeriod,
      enroll: z.boolean(),
      note: z.string().nullable(),
      back: z.string(),
      terms: z.string(),
      earn: z.string(),
      text: z.string(),
      evidence: z.object({ quote: z.string(), url: z.string() }).nullable(),
    }),
  ),
  ranked: z.array(ExploreEntrySchema),
  // Cards that need a membership the user hasn't given, for a member, that
  // would have placed in the ranking shown: name them after it, one line per
  // membership ("If you have a Verizon wireless or Fios account: ...").
  membersOnly: z.array(ExploreEntrySchema),
  excluded: z.array(ExcludedCardSchema),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  // Ways of paying that would put a card at the top, when payment is unknown.
  ifPaying: IfPayingSchema,
})

const SimulationSchema = z.object({
  cards: z.array(z.object({ cardId: z.string(), picks: Picks })),
  spend: z.number(),
  rewards: z.number(),
  annualFees: z.number(),
  memberships: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      annualFee: z.number(),
      cardIds: z.array(z.string()),
    }),
  ),
  membershipFees: z.number(),
  // Credits and free nights the user uses on cards they hold, a year:
  // counted in net.
  heldCredits: z.number(),
  net: z.number(),
  // Credits and free nights on cards not held, a year: not in net.
  otherCredits: z.number(),
  netIfCreditsUsed: z.number(),
  credits: z.array(
    z.object({
      cardId: z.string(),
      yearly: z.number(), // free nights included, at their "up to" value
      creditIds: z.array(z.string()), // credit ids, then free night ids
      names: z.array(z.string()),
      nights: z.number(), // the dollars of yearly from free nights at their cap
      nightIds: z.array(z.string()),
      ownNights: z.number(), // the dollars from nights at the user's own value
      ownNightIds: z.array(z.string()),
      unvaluedNightIds: z.array(z.string()), // no cap and no value given: not counted
      held: z.boolean(),
    }),
  ),
  lines: z.array(
    z.object({
      label: z.string(),
      spend: z.number(),
      earned: z.number(),
      returnPct: z.number(),
      cards: z.array(z.string()),
    }),
  ),
  milestones: z.array(
    z.object({
      cardId: z.string(),
      milestoneId: z.string(),
      points: z.number().nullable(),
      value: z.number(),
    }),
  ),
  // Points each card gives every year with no enrolling: in rewards.
  yearlyPoints: z.array(
    z.object({
      cardId: z.string(),
      yearlyPointsId: z.string(),
      points: z.number(),
      value: z.number(),
    }),
  ),
  // What each card took and earned a year, its milestones and yearly points
  // included.
  byCard: z.array(
    z.object({ cardId: z.string(), spend: z.number(), rewards: z.number() }),
  ),
  notes: z.array(z.string()),
})

export const SpendingSimulationSchema = z.object({
  notes: z.array(z.string()),
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
      credits: z.number(), // its statement credits and free nights, a year: not in gain
      gainIfCreditsUsed: z.number(),
    }),
  ),
  // Cards that need a membership the user hasn't given, for a member, that
  // would have placed among the singles (or additions) shown: net a year, or
  // the gain for an addition.
  membersOnly: z.array(
    z.object({
      cardId: z.string(),
      membership: z.string(),
      net: z.number(),
    }),
  ),
})

export const CheatSheetSchema = z.object({
  scope: z.enum(['wallet', 'all cards']),
  quarter: z.string(),
  date: z.string(),
  rows: z.array(
    z.object({
      label: z.string(),
      cardId: z.string().nullable(),
      cardName: z.string().nullable(),
      effectiveReturnPct: z.number().nullable(),
      matchedRule: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
  notes: z.array(z.string()),
  // From every card: one line per membership the user hasn't given, naming
  // the cards that need it where they'd beat a row's card.
  membersOnly: z.array(z.string()),
  assumptions: z.array(z.string()),
})

export const PurchaseAnswerSchema = RecommendationSchema.extend({
  // Every card earnrate knows, ranked: set when no cards were given.
  allCards: ExplorationSchema.nullable(),
})
