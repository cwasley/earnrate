import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../../src/data/load.ts'
import { recommend } from '../../src/engine/recommend.ts'
import { resolveMerchant } from '../../src/merchants/resolve.ts'
import { cheatSheet } from '../../src/engine/cheat-sheet.ts'
import { bookPurchase } from '../../src/engine/record.ts'
import { checklist, checklistCalendar } from '../../src/engine/checklist.ts'
import { ALL_PERSONAL_CARDS, exploreCards } from '../../src/engine/explore.ts'
import { resolveSpendLines, simulateWallet } from '../../src/engine/simulate.ts'
import type {
  Purchase,
  RankedCard,
  Recommendation,
} from '../../src/engine/types.ts'
import { CardSchema } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import { WalletSchema, type Wallet } from '../../src/schema/wallet.ts'
import {
  PROFILES,
  TODAY,
  baseWallet,
  purchase,
  updateCard,
  withProfile,
  type Profile,
} from './fixtures.ts'

const goldenTest = test

const catalog = await loadCatalog()

type Expectation = { winner: string; returnPct: number }

type GoldenCase = {
  name: string
  purchase: Purchase
  wallet?: (w: Wallet) => Wallet
  catalog?: (c: Catalog) => Catalog
  flat: Expectation
  pointsHeavy: Expectation
  check?: (rec: Recommendation, profile: Profile) => void
}

function entry(rec: Recommendation, cardId: string): RankedCard {
  const found = rec.ranked.find((r) => r.cardId === cardId)
  if (!found) throw new Error(`${cardId} is not in the ranked list`)
  return found
}

function expectSome(texts: string[], pattern: RegExp) {
  expect(
    texts.some((t) => pattern.test(t)),
    `no line matches ${String(pattern)} in ${JSON.stringify(texts)}`,
  ).toBe(true)
}

const withoutPrime = (w: Wallet): Wallet => ({ ...w, memberships: [] })

const cases: GoldenCase[] = [
  {
    name: '#1 Whole Foods in-store: BCP at flat values, Gold when points are worth more',
    purchase: purchase('Whole Foods', { amount: 80, channel: 'in_store' }),
    flat: { winner: 'amex-blue-cash-preferred', returnPct: 6 },
    pointsHeavy: { winner: 'amex-gold', returnPct: 6.8 },
    check: (rec, profile) => {
      expectSome(rec.assumptions, /Whole Foods Market codes as .*supermarket/i)
      expectSome(rec.assumptions, /5411/)
      expect(entry(rec, 'chase-prime-visa').effectiveReturnPct).toBeCloseTo(5)
      expect(rec.sensitivity).toMatch(/MR/)
      expect(rec.ranked[0]?.earned).toBeCloseTo(profile === 'flat' ? 4.8 : 5.44)
    },
  },
  {
    name: '#2 Whole Foods with the BCP supermarket cap used up',
    purchase: purchase('Whole Foods', { channel: 'in_store' }),
    wallet: (w) =>
      updateCard(w, 'amex-blue-cash-preferred', (c) => ({
        ...c,
        cap_usage: { 'us-supermarkets': { period: '2026', spent: 6000 } },
      })),
    flat: { winner: 'chase-prime-visa', returnPct: 5 },
    pointsHeavy: { winner: 'amex-gold', returnPct: 6.8 },
    check: (rec) => {
      expect(
        entry(rec, 'amex-blue-cash-preferred').effectiveReturnPct,
      ).toBeCloseTo(1)
    },
  },
  {
    name: '#3a Amazon.com with Prime',
    purchase: purchase('Amazon.com', { channel: 'online' }),
    flat: { winner: 'chase-prime-visa', returnPct: 5 },
    pointsHeavy: { winner: 'chase-prime-visa', returnPct: 5 },
  },
  {
    name: '#3b Amazon.com without Prime: Prime Visa drops to 3%',
    purchase: purchase('Amazon.com', { channel: 'online' }),
    wallet: withoutPrime,
    flat: { winner: 'chase-prime-visa', returnPct: 3 },
    pointsHeavy: { winner: 'chase-prime-visa', returnPct: 3 },
    check: (rec) => {
      expect(entry(rec, 'chase-prime-visa').matchedRule).toBe(
        'amazon-without-prime',
      )
    },
  },
  {
    name: '#4 Costco with no channel: assumed in-store, Visa only',
    purchase: purchase('Costco'),
    flat: { winner: 'chase-freedom-unlimited', returnPct: 1.5 },
    pointsHeavy: { winner: 'chase-freedom-unlimited', returnPct: 2.55 },
    check: (rec) => {
      expectSome(rec.assumptions, /in-store/i)
      const excluded = rec.excluded.map((e) => e.cardId)
      for (const id of [
        'amex-gold',
        'amex-blue-cash-preferred',
        'amex-platinum',
        'sofi-unlimited-2',
      ]) {
        expect(excluded).toContain(id)
      }
      for (const r of rec.ranked) {
        expect(catalog.cards.find((c) => c.id === r.cardId)?.network).toBe(
          'visa',
        )
      }
    },
  },
  ...['Walmart', 'Target'].map((merchant): GoldenCase => ({
    name: `#5 ${merchant}: superstores don't earn supermarket rates`,
    purchase: purchase(merchant, { channel: 'in_store' }),
    flat: { winner: 'sofi-unlimited-2', returnPct: 2 },
    pointsHeavy: { winner: 'chase-freedom-unlimited', returnPct: 2.55 },
    check: (rec) => {
      expect(entry(rec, 'amex-blue-cash-preferred').matchedRule).toBeNull()
      expect(entry(rec, 'amex-gold').matchedRule).toBeNull()
    },
  })),
  {
    name: '#6 Restaurant: Gold, with a sensitivity note',
    purchase: purchase('Chipotle', { channel: 'in_store' }),
    flat: { winner: 'amex-gold', returnPct: 4 },
    pointsHeavy: { winner: 'amex-gold', returnPct: 6.8 },
    check: (rec, profile) => {
      expect(rec.sensitivity).toMatch(profile === 'flat' ? /UR/ : /MR/)
    },
  },
  {
    name: '#7 Gas: three-way tie at flat values goes to the card with upside',
    purchase: purchase('Shell', { channel: 'in_store' }),
    flat: { winner: 'chase-sapphire-preferred', returnPct: 3 },
    pointsHeavy: { winner: 'chase-sapphire-preferred', returnPct: 5.1 },
    check: (rec, profile) => {
      const cashPlus = entry(rec, 'usbank-cash-plus')
      expect(cashPlus.matchedRule).toBe('two-percent')
      expect(cashPlus.effectiveReturnPct).toBeCloseTo(2)
      if (profile === 'flat') {
        expectSome(rec.notes, /Blue Cash Preferred/)
        expectSome(rec.notes, /Best Buy/)
      }
    },
  },
  {
    name: '#8 Netflix: BCP beats Cash+ 5% streaming',
    purchase: purchase('Netflix', { channel: 'online' }),
    flat: { winner: 'amex-blue-cash-preferred', returnPct: 6 },
    pointsHeavy: { winner: 'amex-blue-cash-preferred', returnPct: 6 },
    check: (rec) => {
      expect(entry(rec, 'usbank-cash-plus').effectiveReturnPct).toBeCloseTo(5)
    },
  },
  {
    name: '#9a Comcast with TV/internet/streaming picked on Cash+',
    purchase: purchase('Comcast', { channel: 'online' }),
    flat: { winner: 'usbank-cash-plus', returnPct: 5 },
    pointsHeavy: { winner: 'usbank-cash-plus', returnPct: 5 },
  },
  {
    name: '#9b Comcast with no Cash+ picks',
    purchase: purchase('Comcast', { channel: 'online' }),
    wallet: (w) =>
      updateCard(w, 'usbank-cash-plus', ({ chosen: _chosen, ...c }) => c),
    flat: { winner: 'sofi-unlimited-2', returnPct: 2 },
    pointsHeavy: { winner: 'chase-freedom-unlimited', returnPct: 2.55 },
    check: (rec) => {
      expect(entry(rec, 'usbank-cash-plus').effectiveReturnPct).toBeCloseTo(1)
    },
  },
  {
    name: "#9c Comcast with last quarter's Cash+ picks",
    purchase: purchase('Comcast', { channel: 'online' }),
    wallet: (w) =>
      updateCard(w, 'usbank-cash-plus', (c) =>
        c.chosen ? { ...c, chosen: { ...c.chosen, period: '2026-Q3' } } : c,
      ),
    flat: { winner: 'sofi-unlimited-2', returnPct: 2 },
    pointsHeavy: { winner: 'chase-freedom-unlimited', returnPct: 2.55 },
    check: (rec) => {
      const cashPlus = entry(rec, 'usbank-cash-plus')
      expect(cashPlus.effectiveReturnPct).toBeCloseTo(1)
      expectSome(cashPlus.warnings, /2026-Q3/)
    },
  },
  {
    name: '#10 Unknown local business: best catch-all card, low confidence',
    purchase: purchase("Joe's Hardware Santa Monica", { channel: 'in_store' }),
    flat: { winner: 'sofi-unlimited-2', returnPct: 2 },
    pointsHeavy: { winner: 'chase-freedom-unlimited', returnPct: 2.55 },
    check: (rec) => {
      expect(rec.merchant.source).toBe('none')
      expect(rec.merchant.confidence).toBe('low')
      expect(rec.decision?.confidence).toBe('low')
      expectSome(rec.warnings, /couldn't identify/i)
    },
  },
  {
    name: '#11 Stadium: warns it may not code as dining, and who wins if it does',
    purchase: purchase('Dodger Stadium', { channel: 'in_store' }),
    flat: { winner: 'sofi-unlimited-2', returnPct: 2 },
    pointsHeavy: { winner: 'chase-freedom-unlimited', returnPct: 2.55 },
    check: (rec, profile) => {
      expectSome(rec.warnings, /may code as/i)
      if (profile === 'flat') {
        expectSome(rec.warnings, /restaurants.*Freedom Unlimited/i)
      }
      expect(rec.warnings.join(' ')).not.toMatch(/Gold/)
    },
  },
  {
    name: "#12 Airline's own site: Platinum 5x",
    purchase: purchase('delta.com', { channel: 'online' }),
    flat: { winner: 'amex-platinum', returnPct: 5 },
    pointsHeavy: { winner: 'amex-platinum', returnPct: 8.5 },
    check: (rec, profile) => {
      const v = PROFILES[profile]
      expect(entry(rec, 'amex-gold').effectiveReturnPct).toBeCloseTo(3 * v.MR)
      expect(
        entry(rec, 'chase-sapphire-preferred').effectiveReturnPct,
      ).toBeCloseTo(2 * v.UR)
    },
  },
  {
    name: '#13 Purchase straddling the BCP cap earns a blended rate',
    purchase: purchase('Whole Foods', { amount: 100, channel: 'in_store' }),
    wallet: (w) =>
      updateCard(w, 'amex-blue-cash-preferred', (c) => ({
        ...c,
        cap_usage: { 'us-supermarkets': { period: '2026', spent: 5950 } },
      })),
    flat: { winner: 'chase-prime-visa', returnPct: 5 },
    pointsHeavy: { winner: 'amex-gold', returnPct: 6.8 },
    check: (rec) => {
      const bcp = entry(rec, 'amex-blue-cash-preferred')
      expect(bcp.effectiveReturnPct).toBeCloseTo(3.5)
      expect(bcp.earned).toBeCloseTo(3.5)
      expectSome(bcp.warnings, /cap/i)
    },
  },
  {
    name: '#14 Card data older than 180 days gets a warning',
    purchase: purchase('Whole Foods', { channel: 'in_store' }),
    catalog: (c) => ({
      ...c,
      cards: c.cards.map((card) =>
        card.id === 'amex-blue-cash-preferred'
          ? { ...card, last_verified: '2026-01-01' }
          : card,
      ),
    }),
    flat: { winner: 'amex-blue-cash-preferred', returnPct: 6 },
    pointsHeavy: { winner: 'amex-gold', returnPct: 6.8 },
    check: (rec) => {
      expectSome(
        entry(rec, 'amex-blue-cash-preferred').warnings,
        /last verified/i,
      )
    },
  },
  ...['Comcast', 'AMC'].map((merchant): GoldenCase => ({
    name: `#15 ${merchant}: the Cash+ combined cap is shared across both picks`,
    purchase: purchase(merchant, { amount: 100, channel: 'in_store' }),
    wallet: (w) =>
      updateCard(w, 'usbank-cash-plus', (c) => ({
        ...c,
        cap_usage: {
          'five-percent-combined': { period: '2026-Q4', spent: 1950 },
        },
      })),
    flat: { winner: 'usbank-cash-plus', returnPct: 3 },
    pointsHeavy: { winner: 'usbank-cash-plus', returnPct: 3 },
  })),
  {
    name: '#18a Freedom Unlimited pools into UR when Sapphire Preferred is held',
    purchase: purchase('Etsy', { channel: 'online' }),
    flat: { winner: 'sofi-unlimited-2', returnPct: 2 },
    pointsHeavy: { winner: 'chase-freedom-unlimited', returnPct: 2.55 },
    check: (rec) => {
      expect(entry(rec, 'chase-freedom-unlimited').currency).toBe('UR')
    },
  },
  {
    name: '#18b Without Sapphire Preferred, Freedom Unlimited is plain cash back',
    purchase: purchase('Etsy', { channel: 'online' }),
    wallet: (w) => ({
      ...w,
      cards: w.cards.filter((c) => c.id !== 'chase-sapphire-preferred'),
    }),
    flat: { winner: 'sofi-unlimited-2', returnPct: 2 },
    pointsHeavy: { winner: 'sofi-unlimited-2', returnPct: 2 },
    check: (rec) => {
      expect(entry(rec, 'chase-freedom-unlimited').currency).toBe('cash')
    },
  },
]

describe('golden cases', () => {
  for (const c of cases) {
    for (const profile of ['flat', 'pointsHeavy'] as const) {
      goldenTest(`${c.name} [${profile}]`, () => {
        const wallet = withProfile(
          (c.wallet ?? ((w) => w))(baseWallet()),
          profile,
        )
        const cat = (c.catalog ?? ((x) => x))(catalog)
        const rec = recommend(cat, wallet, c.purchase)
        const want = c[profile]

        expect(rec.decision?.cardId).toBe(want.winner)
        expect(rec.decision?.effectiveReturnPct).toBeCloseTo(want.returnPct)
        expect(rec.ranked[0]?.cardId).toBe(want.winner)
        c.check?.(rec, profile)
      })
    }
  }
})

describe('golden cases with state', () => {
  goldenTest(
    '#16 Recording $6,000 at Whole Foods on BCP flips the winner',
    () => {
      const wallet = withProfile(baseWallet(), 'flat')
      const wholeFoods = purchase('Whole Foods', { channel: 'in_store' })
      expect(recommend(catalog, wallet, wholeFoods).decision?.cardId).toBe(
        'amex-blue-cash-preferred',
      )

      const after = bookPurchase(catalog, wallet, {
        cardId: 'amex-blue-cash-preferred',
        merchant: 'Whole Foods',
        amount: 6000,
        date: TODAY,
        channel: 'in_store',
      }).wallet
      const bcp = after.cards.find((c) => c.id === 'amex-blue-cash-preferred')
      expect(bcp?.cap_usage['us-supermarkets']).toEqual({
        period: '2026',
        spent: 6000,
      })
      expect(recommend(catalog, after, wholeFoods).decision?.cardId).toBe(
        'chase-prime-visa',
      )
    },
  )

  goldenTest(
    '#15c Spend recorded at a movie theater drains the cap for TV/internet too',
    () => {
      const wallet = withProfile(baseWallet(), 'flat')
      const after = bookPurchase(catalog, wallet, {
        cardId: 'usbank-cash-plus',
        merchant: 'AMC',
        amount: 1950,
        date: TODAY,
        channel: 'in_store',
      }).wallet
      const rec = recommend(
        catalog,
        after,
        purchase('Comcast', { amount: 100, channel: 'online' }),
      )
      expect(entry(rec, 'usbank-cash-plus').effectiveReturnPct).toBeCloseTo(3)
    },
  )
})

describe('#19 rotating categories missing from the data', () => {
  const withFlex = (w: Wallet): Wallet => ({
    ...w,
    cards: [
      ...w.cards,
      {
        id: 'chase-freedom-flex',
        checkout_label: 'Freedom Flex',
        cap_usage: {},
        activated: ['q1-2027-grocery', 'q1-2027-streaming'],
      },
    ],
  })

  goldenTest(
    '#19a a quarter with no rotating categories on file gets a warning',
    () => {
      const wallet = withProfile(withFlex(baseWallet()), 'flat')
      const rec = recommend(
        catalog,
        wallet,
        purchase('Kroger', { channel: 'in_store', date: '2027-04-10' }),
      )
      expectSome(
        rec.warnings,
        /Freedom Flex's rotating categories for 2027-Q2 aren't in earnrate's data yet/,
      )
    },
  )

  goldenTest(
    '#19b a quarter whose categories are on file has no warning',
    () => {
      const wallet = withProfile(withFlex(baseWallet()), 'flat')
      const rec = recommend(
        catalog,
        wallet,
        purchase('Kroger', { channel: 'in_store', date: '2027-02-10' }),
      )
      expect(entry(rec, 'chase-freedom-flex').rate).toBe(5)
      expect(rec.warnings.join('\n')).not.toMatch(/rotating/)
    },
  )

  goldenTest('#19c a wallet without a rotating card has no warning', () => {
    const rec = recommend(
      catalog,
      withProfile(baseWallet(), 'flat'),
      purchase('Kroger', { channel: 'in_store', date: '2027-04-10' }),
    )
    expect(rec.warnings.join('\n')).not.toMatch(/rotating/)
  })
})

describe('#17 every card has a known network', () => {
  test('a card file without a network is rejected', () => {
    const card = catalog.cards.find((c) => c.id === 'sofi-unlimited-2')
    const { network: _network, ...withoutNetwork } = card ?? {}
    expect(CardSchema.safeParse(withoutNetwork).success).toBe(false)
  })
})

describe('#20 periods roll over', () => {
  const bcpCapUsed = (period: string) => (w: Wallet) =>
    updateCard(w, 'amex-blue-cash-preferred', (c) => ({
      ...c,
      cap_usage: { 'us-supermarkets': { period, spent: 6000 } },
    }))
  const wholeFoodsOn = (date: string) =>
    purchase('Whole Foods', { channel: 'in_store', date })

  goldenTest("#20a last year's BCP supermarket spending doesn't count", () => {
    const wallet = withProfile(bcpCapUsed('2025')(baseWallet()), 'flat')
    const rec = recommend(catalog, wallet, wholeFoodsOn(TODAY))
    expect(rec.decision?.cardId).toBe('amex-blue-cash-preferred')
    expect(rec.decision?.effectiveReturnPct).toBeCloseTo(6)
  })

  goldenTest('#20b a full BCP cap still applies on December 31', () => {
    const wallet = withProfile(bcpCapUsed('2026')(baseWallet()), 'flat')
    const rec = recommend(catalog, wallet, wholeFoodsOn('2026-12-31'))
    expect(rec.decision?.cardId).toBe('chase-prime-visa')
    expect(entry(rec, 'amex-blue-cash-preferred').effectiveReturnPct).toBe(1)
  })

  goldenTest('#20c and resets on January 1', () => {
    const wallet = withProfile(bcpCapUsed('2026')(baseWallet()), 'flat')
    const rec = recommend(catalog, wallet, wholeFoodsOn('2027-01-01'))
    expect(rec.decision?.cardId).toBe('amex-blue-cash-preferred')
    expect(rec.decision?.effectiveReturnPct).toBeCloseTo(6)
  })

  const withCustomCash =
    (period: string, spent: number) =>
    (w: Wallet): Wallet => ({
      ...w,
      cards: [
        ...w.cards,
        {
          id: 'citi-custom-cash',
          activated: [],
          cap_usage: { 'top-category': { period, spent } },
          chosen: {
            period: '2026-10',
            picks: { 'top-category': ['gas-stations'] },
          },
        },
      ],
    })

  goldenTest(
    "#20d Custom Cash's monthly cap: last month's spend doesn't count",
    () => {
      const wallet = withProfile(
        withCustomCash('2026-09', 500)(baseWallet()),
        'flat',
      )
      const rec = recommend(
        catalog,
        wallet,
        purchase('Shell', { channel: 'in_store' }),
      )
      expect(rec.decision?.cardId).toBe('citi-custom-cash')
      expect(rec.decision?.effectiveReturnPct).toBeCloseTo(5)
    },
  )

  goldenTest(
    '#20e a purchase crossing the Custom Cash cap blends 5% and 1%',
    () => {
      const wallet = withProfile(
        withCustomCash('2026-10', 450)(baseWallet()),
        'flat',
      )
      const rec = recommend(
        catalog,
        wallet,
        purchase('Shell', { amount: 100, channel: 'in_store' }),
      )
      const customCash = entry(rec, 'citi-custom-cash')
      expect(customCash.effectiveReturnPct).toBeCloseTo(3)
      expect(customCash.earned).toBeCloseTo(3)
      expectSome(customCash.warnings, /only \$50 is left/)
      expect(rec.decision?.cardId).toBe('chase-sapphire-preferred')
    },
  )
})

describe('#21 Freedom Flex activation', () => {
  const withFlex =
    (activated: string[]) =>
    (w: Wallet): Wallet => ({
      ...w,
      cards: [
        ...w.cards,
        { id: 'chase-freedom-flex', cap_usage: {}, activated },
      ],
    })
  const krogerOn = (date: string) =>
    purchase('Kroger', { channel: 'in_store', date })

  goldenTest(
    '#21a not activated: earns 1x, with the activation deadline',
    () => {
      const wallet = withProfile(withFlex([])(baseWallet()), 'pointsHeavy')
      const rec = recommend(catalog, wallet, krogerOn(TODAY))
      expect(rec.decision?.cardId).toBe('amex-gold')
      const flex = entry(rec, 'chase-freedom-flex')
      expect(flex.matchedRule).toBeNull()
      expectSome(flex.warnings, /Activate this bonus .* by Dec 14, 2026/)
    },
  )

  goldenTest(
    '#21b activated: 5x UR beats Gold when points are worth more',
    () => {
      const wallet = withProfile(
        withFlex(['q4-2026-grocery'])(baseWallet()),
        'pointsHeavy',
      )
      const rec = recommend(catalog, wallet, krogerOn(TODAY))
      expect(rec.decision?.cardId).toBe('chase-freedom-flex')
      expect(rec.decision?.effectiveReturnPct).toBeCloseTo(
        5 * PROFILES.pointsHeavy.UR,
      )
    },
  )

  goldenTest(
    '#21c activated: Walmart is excluded from the grocery bonus',
    () => {
      const wallet = withProfile(
        withFlex(['q4-2026-grocery'])(baseWallet()),
        'pointsHeavy',
      )
      const rec = recommend(
        catalog,
        wallet,
        purchase('Walmart', { channel: 'in_store' }),
      )
      expect(entry(rec, 'chase-freedom-flex').matchedRule).toBeNull()
    },
  )

  goldenTest(
    '#21d activated before the deadline: earns 5x to the end of the quarter',
    () => {
      const wallet = withProfile(
        withFlex(['q4-2026-grocery'])(baseWallet()),
        'pointsHeavy',
      )
      for (const date of ['2026-12-20', '2026-12-31']) {
        const rec = recommend(catalog, wallet, krogerOn(date))
        expect(entry(rec, 'chase-freedom-flex').matchedRule).toBe(
          'q4-2026-grocery',
        )
      }
    },
  )

  goldenTest(
    '#21e past the deadline: no nudge to activate by a date that has passed',
    () => {
      const wallet = withProfile(withFlex([])(baseWallet()), 'pointsHeavy')
      const rec = recommend(catalog, wallet, krogerOn('2026-12-20'))
      const flex = entry(rec, 'chase-freedom-flex')
      expect(flex.matchedRule).toBeNull()
      expect(flex.warnings.join(' ')).not.toMatch(/Activate this bonus/)
      expectSome(flex.warnings, /needed activating by Dec 14, 2026/)
    },
  )
})

describe('#22 abroad', () => {
  goldenTest(
    "#22 U.S.-only Whole Foods and supermarket rates don't apply in London",
    () => {
      for (const profile of ['flat', 'pointsHeavy'] as const) {
        for (const wallet of [baseWallet(), withoutPrime(baseWallet())]) {
          const rec = recommend(
            catalog,
            withProfile(wallet, profile),
            purchase('Whole Foods', { channel: 'in_store', country: 'GB' }),
          )
          const bcp = entry(rec, 'amex-blue-cash-preferred')
          const gold = entry(rec, 'amex-gold')
          const prime = entry(rec, 'chase-prime-visa')
          expect(bcp.matchedRule).toBeNull()
          // 1% base, less Amex's 2.7% foreign transaction fee.
          expect(bcp.effectiveReturnPct).toBeCloseTo(1 - 2.7)
          expect(gold.matchedRule).toBeNull()
          expect(gold.effectiveReturnPct).toBeCloseTo(PROFILES[profile].MR)
          expect(prime.matchedRule).toBeNull()
          expect(prime.effectiveReturnPct).toBeCloseTo(1)
        }
      }
    },
  )
})

goldenTest(
  '#22b Whole Foods in the U.S. without Prime: Prime Visa earns 3%',
  () => {
    const rec = recommend(
      catalog,
      withProfile(withoutPrime(baseWallet()), 'flat'),
      purchase('Whole Foods', { channel: 'in_store' }),
    )
    const prime = entry(rec, 'chase-prime-visa')
    expect(prime.matchedRule).toBe('whole-foods-without-prime')
    expect(prime.effectiveReturnPct).toBeCloseTo(3)
  },
)

describe('#23 spend milestones', () => {
  // IHG One Rewards: "Earn 10,000 bonus points after you spend $15,000 on
  // purchases each calendar year." 3x at restaurants, 2x elsewhere, IHG
  // points at 0.5¢ by default.
  const IHG = 'chase-ihg-one-rewards'
  const withIhg =
    (milestoneUsage?: Record<string, { period: string; spent: number }>) =>
    (w: Wallet): Wallet => ({
      ...w,
      cards: [
        ...w.cards,
        {
          id: IHG,
          cap_usage: {},
          activated: [],
          ...(milestoneUsage ? { milestone_usage: milestoneUsage } : {}),
        },
      ],
    })
  const dinner = (overrides: Partial<Purchase> = {}) =>
    purchase('Chipotle', { amount: 100, channel: 'in_store', ...overrides })
  const flat = (w: Wallet) => withProfile(w, 'flat')

  goldenTest(
    '#23a a purchase that crosses $15,000 earns the 10,000 points on top of its rate',
    () => {
      const wallet = flat(
        withIhg({ 'spend-15k': { period: '2026', spent: 14950 } })(
          baseWallet(),
        ),
      )
      const rec = recommend(catalog, wallet, dinner())
      expect(rec.decision?.cardId).toBe(IHG)
      const ihg = entry(rec, IHG)
      expect(ihg.rate).toBe(3)
      expect(ihg.effectiveReturnPct).toBeCloseTo(1.5)
      expect(ihg.earned).toBeCloseTo(1.5)
      expect(ihg.milestoneBonus).toEqual({ points: 10000, dollars: 50 })
      expect(rec.decision?.effectiveReturnPct).toBeCloseTo(1.5)
      expectSome(
        ihg.reasoning,
        /This purchase reaches the \$15,000 calendar-year spend: 10,000 bonus points, worth about \$50/,
      )
      expectSome(rec.assumptions, /\$14,950.*2026/)
    },
  )

  goldenTest('#23b reaching the threshold exactly counts', () => {
    const wallet = flat(
      withIhg({ 'spend-15k': { period: '2026', spent: 14900 } })(baseWallet()),
    )
    const rec = recommend(catalog, wallet, dinner())
    expect(rec.decision?.cardId).toBe(IHG)
    expect(entry(rec, IHG).milestoneBonus?.points).toBe(10000)
  })

  goldenTest(
    "#23c a purchase that doesn't cross it earns only its rate",
    () => {
      for (const spent of [10000, 15000]) {
        const wallet = flat(
          withIhg({ 'spend-15k': { period: '2026', spent } })(baseWallet()),
        )
        const rec = recommend(catalog, wallet, dinner())
        expect(rec.decision?.cardId).toBe('amex-gold')
        const ihg = entry(rec, IHG)
        expect(ihg.effectiveReturnPct).toBeCloseTo(1.5)
        expect(ihg.earned).toBeCloseTo(1.5)
        expect(ihg.reasoning.join(' ')).not.toMatch(/bonus points/)
      }
    },
  )

  goldenTest("#23d last year's tracked spend doesn't count", () => {
    const wallet = flat(
      withIhg({ 'spend-15k': { period: '2025', spent: 14950 } })(baseWallet()),
    )
    const rec = recommend(catalog, wallet, dinner())
    expect(rec.decision?.cardId).toBe('amex-gold')
    expect(entry(rec, IHG).effectiveReturnPct).toBeCloseTo(1.5)
  })

  goldenTest(
    '#23e with no tracking, or no amount, the answer is unchanged',
    () => {
      const untracked = recommend(
        catalog,
        flat(withIhg()(baseWallet())),
        dinner(),
      )
      expect(untracked.decision?.cardId).toBe('amex-gold')
      expect(entry(untracked, IHG).effectiveReturnPct).toBeCloseTo(1.5)

      const tracked = flat(
        withIhg({ 'spend-15k': { period: '2026', spent: 14950 } })(
          baseWallet(),
        ),
      )
      const noAmount = recommend(catalog, tracked, dinner({ amount: null }))
      expect(noAmount.decision?.cardId).toBe('amex-gold')
      expect(entry(noAmount, IHG).effectiveReturnPct).toBeCloseTo(1.5)
    },
  )

  goldenTest('#23f recording a purchase adds to the milestone spend', () => {
    const wallet = flat(
      withIhg({ 'spend-15k': { period: '2026', spent: 14900 } })(baseWallet()),
    )
    const booked = bookPurchase(catalog, wallet, {
      cardId: IHG,
      merchant: 'Chipotle',
      amount: 200,
      date: TODAY,
      channel: 'in_store',
    })
    const held = booked.wallet.cards.find((c) => c.id === IHG)
    expect(held?.milestone_usage?.['spend-15k']).toEqual({
      period: '2026',
      spent: 15100,
    })
    const next = recommend(catalog, booked.wallet, dinner())
    expect(entry(next, IHG).effectiveReturnPct).toBeCloseTo(1.5)
  })

  goldenTest(
    '#23g simulate_spending counts the points at $20,000 a year, not at $10,000',
    () => {
      const ihgOnly = WalletSchema.parse({ cards: [{ id: IHG }] })
      const yearOf = (dollars: number) =>
        simulateWallet(
          catalog,
          ihgOnly,
          resolveSpendLines(catalog, [
            { merchant: null, category: 'other', monthly: dollars / 12 },
          ]),
          '2027-01-01',
        )
      const twenty = yearOf(20000)
      expect(twenty.rewards).toBeCloseTo(250)
      expectSome(
        twenty.notes,
        /\$15,000 calendar-year spend for 10,000 bonus points/,
      )
      const ten = yearOf(10000)
      expect(ten.rewards).toBeCloseTo(100)
      expect(ten.notes.join(' ')).not.toMatch(/bonus points/)
    },
  )
})

describe('#24 foreign transaction fees', () => {
  // From the issuers' fee tables: Freedom Unlimited and Double Cash charge
  // 3% abroad, Blue Cash Preferred 2.7%; SoFi, Sapphire Preferred, Gold,
  // Platinum and Atmos Summit charge none.
  const etsy = (country: string) =>
    purchase('Etsy', { amount: 100, channel: 'online', country })

  goldenTest(
    '#24a in London, Freedom Unlimited earns the most but loses to its 3% fee',
    () => {
      const rec = recommend(
        catalog,
        withProfile(baseWallet(), 'pointsHeavy'),
        etsy('GB'),
      )
      expect(rec.decision?.cardId).toBe('sofi-unlimited-2')
      expect(rec.decision?.effectiveReturnPct).toBeCloseTo(2)
      const cfu = entry(rec, 'chase-freedom-unlimited')
      expect(cfu.rate).toBe(1.5)
      expect(cfu.effectiveReturnPct).toBeCloseTo(1.5 * 1.7 - 3)
      expect(cfu.foreignFee).toBe(3)
      expectSome(rec.assumptions, /outside the U\.S\./)
    },
  )

  goldenTest(
    '#24b a card with a fee says what it nets; one without, nothing',
    () => {
      const rec = recommend(
        catalog,
        withProfile(baseWallet(), 'pointsHeavy'),
        etsy('GB'),
      )
      expect(entry(rec, 'chase-freedom-unlimited').warnings).toContain(
        'Charges a 3% foreign transaction fee here, so it nets -0.45%.',
      )
      expect(entry(rec, 'amex-blue-cash-preferred').warnings.join(' ')).toMatch(
        /Charges a 2\.7% foreign transaction fee here, so it nets -1\.7%\./,
      )
      expect(entry(rec, 'sofi-unlimited-2').warnings.join(' ')).not.toMatch(
        /foreign transaction/,
      )
      expect(entry(rec, 'sofi-unlimited-2').foreignFee).toBeNull()
    },
  )

  goldenTest('#24c the same purchase in the U.S. keeps its answer', () => {
    const rec = recommend(
      catalog,
      withProfile(baseWallet(), 'pointsHeavy'),
      etsy('US'),
    )
    expect(rec.decision?.cardId).toBe('chase-freedom-unlimited')
    expect(rec.decision?.effectiveReturnPct).toBeCloseTo(2.55)
    expect(rec.ranked.every((r) => r.foreignFee === null)).toBe(true)
    expect(rec.assumptions.join(' ')).not.toMatch(/outside the U\.S\./)
  })

  goldenTest(
    "#24d Atmos Summit's 3x on foreign purchases applies only abroad",
    () => {
      const summit = WalletSchema.parse({
        cards: [{ id: 'bank-of-america-atmos-rewards-summit' }],
      })
      const abroad = entry(
        recommend(catalog, summit, etsy('FR')),
        'bank-of-america-atmos-rewards-summit',
      )
      expect(abroad.matchedRule).toBe('foreign-purchases')
      expect(abroad.rate).toBe(3)
      expect(abroad.foreignFee).toBeNull()
      const home = entry(
        recommend(catalog, summit, etsy('US')),
        'bank-of-america-atmos-rewards-summit',
      )
      expect(home.matchedRule).toBeNull()
      expect(home.rate).toBe(1)
    },
  )

  goldenTest('#24e the cheat sheet has an Abroad line, net of fees', () => {
    const sheet = cheatSheet(catalog, withProfile(baseWallet(), 'flat'), TODAY)
    expect(sheet.rows.find((r) => r.label === 'Abroad')).toMatchObject({
      cardId: 'sofi-unlimited-2',
      effectiveReturnPct: 2,
    })

    const allCharge = WalletSchema.parse({
      cards: [
        { id: 'chase-freedom-unlimited' },
        { id: 'amex-blue-cash-preferred' },
      ],
    })
    const abroad = cheatSheet(catalog, allCharge, TODAY).rows.find(
      (r) => r.label === 'Abroad',
    )
    expect(abroad?.cardId).toBe('chase-freedom-unlimited')
    expect(abroad?.effectiveReturnPct).toBeCloseTo(1.5 - 3)
    expect(abroad?.note).toMatch(
      /^Every card here charges a foreign transaction fee abroad; this one costs the least\./,
    )
  })
})

describe('#25 streaming bonuses follow each issuer’s list', () => {
  const wallet = WalletSchema.parse({
    cards: [
      { id: 'amex-blue-cash-preferred' },
      { id: 'chase-united-quest' },
      { id: 'chase-ihg-one-rewards' },
    ],
  })
  const ruleAt = (merchant: string, cardId: string) =>
    entry(recommend(catalog, wallet, purchase(merchant)), cardId).matchedRule

  goldenTest('#25a Showtime: on Chase’s list, not on Amex’s', () => {
    expect(ruleAt('Showtime', 'amex-blue-cash-preferred')).toBeNull()
    expect(ruleAt('Showtime', 'chase-united-quest')).toBe('streaming')
    expect(ruleAt('Showtime', 'chase-ihg-one-rewards')).toBe(
      'streaming-through-2026',
    )
  })

  goldenTest('#25b Starz and Audible: on Amex’s list, not on Chase’s', () => {
    for (const merchant of ['Starz', 'Audible']) {
      expect(ruleAt(merchant, 'amex-blue-cash-preferred')).toBe('us-streaming')
      expect(ruleAt(merchant, 'chase-united-quest')).toBeNull()
      expect(ruleAt(merchant, 'chase-ihg-one-rewards')).toBeNull()
    }
  })

  goldenTest(
    '#25c IHG’s bills rate still covers internet and utilities',
    () => {
      expect(ruleAt('Comcast', 'chase-ihg-one-rewards')).toBe(
        'bills-through-2026',
      )
    },
  )
})

goldenTest(
  "#26 BJ's alone is the warehouse club; the restaurant keeps its names",
  () => {
    const id = (q: string) => resolveMerchant(catalog, q, null).merchantId
    for (const q of ['BJs', "BJ's", 'BJ’s', 'bjs'])
      expect(id(q)).toBe('bjs-wholesale-club')
    expect(id("BJ's Restaurant")).toBe('bjs-restaurant')
    expect(id('bjs brewhouse')).toBe('bjs-restaurant')
    expect(id('bjs gas')).toBe('bjs-gas')
  },
)

describe('#26 new cards', () => {
  const wallet = (cards: object[]) =>
    withProfile(WalletSchema.parse({ cards }), 'flat')

  goldenTest('#26a Hilton Surpass earns 12x at Hilton, 4.8% at 0.4¢', () => {
    const rec = recommend(
      catalog,
      wallet([{ id: 'amex-hilton-honors-surpass' }, { id: 'amex-gold' }]),
      purchase('Hilton', { amount: 200, channel: 'in_store' }),
    )
    expect(rec.decision?.cardId).toBe('amex-hilton-honors-surpass')
    const surpass = entry(rec, 'amex-hilton-honors-surpass')
    expect(surpass.rate).toBe(12)
    expect(surpass.effectiveReturnPct).toBeCloseTo(4.8)
    expect(entry(rec, 'amex-gold').effectiveReturnPct).toBeCloseTo(1)
  })

  goldenTest(
    "#26b Bonvoy Bevy's 4x stops at $15,000 of restaurants and supermarkets",
    () => {
      const rec = recommend(
        catalog,
        wallet([
          {
            id: 'amex-marriott-bonvoy-bevy',
            cap_usage: {
              'dining-and-supermarkets': { period: '2026', spent: 14950 },
            },
          },
        ]),
        purchase('Chipotle', { amount: 100, channel: 'in_store' }),
      )
      const bevy = entry(rec, 'amex-marriott-bonvoy-bevy')
      expect(bevy.rate).toBeCloseTo(3)
      expect(bevy.effectiveReturnPct).toBeCloseTo(1.5)
    },
  )

  goldenTest('#26c Delta SkyMiles Platinum earns 3x at Delta, Gold 2x', () => {
    const delta = purchase('Delta', { amount: 400, channel: 'online' })
    const platinum = recommend(
      catalog,
      wallet([{ id: 'amex-delta-skymiles-platinum' }]),
      delta,
    )
    expect(entry(platinum, 'amex-delta-skymiles-platinum').rate).toBe(3)
    expect(platinum.decision?.effectiveReturnPct).toBeCloseTo(3)
    const gold = recommend(
      catalog,
      wallet([{ id: 'amex-delta-skymiles-gold' }]),
      delta,
    )
    expect(entry(gold, 'amex-delta-skymiles-gold').rate).toBe(2)
  })

  goldenTest(
    "#26d Discover it: Q4 2026's 5% at restaurants once activated, 1% before",
    () => {
      const dinner = purchase('Chipotle', { channel: 'in_store' })
      const activated = recommend(
        catalog,
        wallet([
          { id: 'discover-it-cash-back', activated: ['q4-2026-restaurants'] },
        ]),
        dinner,
      )
      expect(activated.decision?.effectiveReturnPct).toBeCloseTo(5)
      const not = entry(
        recommend(catalog, wallet([{ id: 'discover-it-cash-back' }]), dinner),
        'discover-it-cash-back',
      )
      expect(not.effectiveReturnPct).toBeCloseTo(1)
      expectSome(not.warnings, /Activate this bonus/)
      const nextYear = recommend(
        catalog,
        wallet([{ id: 'discover-it-cash-back' }]),
        purchase('Chipotle', { channel: 'in_store', date: '2027-01-15' }),
      )
      expectSome(nextYear.warnings, /rotating categories for 2027-Q1/)
    },
  )

  goldenTest('#26e Quicksilver earns 1.5% everywhere else', () => {
    const rec = recommend(
      catalog,
      wallet([{ id: 'capital-one-quicksilver' }]),
      purchase("Joe's Hardware Santa Monica", { channel: 'in_store' }),
    )
    expect(rec.decision?.effectiveReturnPct).toBeCloseTo(1.5)
  })
})

describe('#27 new cards', () => {
  const wallet = (cards: object[], memberships: string[] = []) =>
    withProfile(WalletSchema.parse({ cards, memberships }), 'flat')

  goldenTest("#27a Altitude Go's 4x dining stops at $2,000 a quarter", () => {
    const dinner = purchase('Chipotle', { amount: 100, channel: 'in_store' })
    const fresh = entry(
      recommend(catalog, wallet([{ id: 'usbank-altitude-go' }]), dinner),
      'usbank-altitude-go',
    )
    expect(fresh.rate).toBe(4)
    expect(fresh.effectiveReturnPct).toBeCloseTo(4)
    const nearCap = entry(
      recommend(
        catalog,
        wallet([
          {
            id: 'usbank-altitude-go',
            cap_usage: { dining: { period: '2026-Q4', spent: 1950 } },
          },
        ]),
        dinner,
      ),
      'usbank-altitude-go',
    )
    expect(nearCap.effectiveReturnPct).toBeCloseTo(2.5)
  })

  goldenTest(
    '#27b Premium Rewards earns 2x on dining, 3x with Preferred Honors',
    () => {
      const dinner = purchase('Chipotle', { amount: 50, channel: 'in_store' })
      const plain = recommend(
        catalog,
        wallet([{ id: 'bank-of-america-premium-rewards' }]),
        dinner,
      )
      expect(plain.decision?.effectiveReturnPct).toBeCloseTo(2)
      const honors = recommend(
        catalog,
        wallet(
          [{ id: 'bank-of-america-premium-rewards' }],
          ['bofa-rewards-preferred-honors'],
        ),
        dinner,
      )
      expect(honors.decision?.effectiveReturnPct).toBeCloseTo(3)
    },
  )

  goldenTest(
    "#27c Business Gold's 4x needs restaurants in its top two categories",
    () => {
      const dinner = purchase('Chipotle', { amount: 60, channel: 'in_store' })
      const picked = recommend(
        catalog,
        wallet([
          {
            id: 'amex-business-gold',
            chosen: {
              period: '2026-10',
              picks: { 'top-two': ['us-restaurants', 'transit'] },
            },
          },
        ]),
        dinner,
      )
      expect(entry(picked, 'amex-business-gold').rate).toBe(4)
      const notPicked = recommend(
        catalog,
        wallet([
          {
            id: 'amex-business-gold',
            chosen: {
              period: '2026-10',
              picks: { 'top-two': ['us-advertising', 'transit'] },
            },
          },
        ]),
        dinner,
      )
      expect(entry(notPicked, 'amex-business-gold').rate).toBe(1)
    },
  )

  goldenTest(
    "#27d Citi Strata's Self-Select Category starts on streaming",
    () => {
      const rec = recommend(
        catalog,
        wallet([{ id: 'citi-strata' }]),
        purchase('Netflix', { amount: 20, channel: 'online' }),
      )
      expect(entry(rec, 'citi-strata').rate).toBe(3)
    },
  )
})

describe('#28 first-year rates', () => {
  const wallet = (cards: object[], memberships: string[] = []) =>
    withProfile(WalletSchema.parse({ cards, memberships }), 'flat')
  const discover = (extra: object = {}) => ({
    id: 'discover-it-cash-back',
    activated: ['q4-2026-restaurants'],
    ...extra,
  })
  const customized = (extra: object = {}) => ({
    id: 'bank-of-america-customized-cash-rewards',
    chosen: { period: '2026', picks: { 'three-percent': ['dining'] } },
    ...extra,
  })
  const dinner = purchase('Chipotle', { amount: 100, channel: 'in_store' })

  goldenTest(
    '#28a Discover it inside Cashback Match: every rate doubles, named with its end date',
    () => {
      const rec = recommend(
        catalog,
        wallet([discover({ opened: '2026-03-04' })]),
        dinner,
      )
      const it = entry(rec, 'discover-it-cash-back')
      expect(it.rate).toBeCloseTo(10)
      expect(it.earned).toBeCloseTo(10)
      expectSome(
        it.reasoning,
        /^10% cash back in your first year, through Mar 3, 2027; 5% cash back after that\./,
      )
      const hardware = entry(
        recommend(
          catalog,
          wallet([discover({ opened: '2026-03-04' })]),
          purchase("Joe's Hardware Santa Monica", { channel: 'in_store' }),
        ),
        'discover-it-cash-back',
      )
      expect(hardware.rate).toBeCloseTo(2)
      expectSome(hardware.reasoning, /^2% cash back, its base rate\./)
    },
  )

  goldenTest(
    '#28b Discover it: past the $1,500 quarterly cap the doubled 1% applies',
    () => {
      const rec = recommend(
        catalog,
        wallet([discover({ opened: '2026-03-04' })]),
        purchase('Chipotle', { amount: 2000, channel: 'in_store' }),
      )
      // $1,500 at 10%, $500 at 2%.
      expect(entry(rec, 'discover-it-cash-back').rate).toBeCloseTo(8)
    },
  )

  goldenTest(
    '#28c Discover it after its first 365 days, and on the last day of them',
    () => {
      const last = recommend(
        catalog,
        wallet([discover({ opened: '2025-12-31' })]),
        purchase('Chipotle', { channel: 'in_store', date: '2026-12-30' }),
      )
      expect(entry(last, 'discover-it-cash-back').rate).toBeCloseTo(10)
      const after = recommend(
        catalog,
        wallet([discover({ opened: '2025-12-31' })]),
        purchase('Chipotle', { channel: 'in_store', date: '2026-12-31' }),
      )
      const it = entry(after, 'discover-it-cash-back')
      expect(it.rate).toBeCloseTo(5)
      expect(it.reasoning.join(' ')).not.toMatch(/first year/)
      expect(after.assumptions.join(' ')).not.toMatch(/first-year rate/)
    },
  )

  goldenTest(
    '#28d Discover it with no opening date: standard rates, and the date is asked for',
    () => {
      const rec = recommend(catalog, wallet([discover()]), dinner)
      expect(entry(rec, 'discover-it-cash-back').rate).toBeCloseTo(5)
      expectSome(
        rec.assumptions,
        /^A first-year rate may apply on Discover it Cash Back Credit Card: 10% cash back here in an account's first year, instead of the 5% cash back it's ranked at\. Give the card's opening date if it opened in the last year\.$/,
      )
    },
  )

  goldenTest("#28e a welcome bonus's opening date counts too", () => {
    const rec = recommend(
      catalog,
      wallet([discover({ bonus: { opened: '2026-09-01', spent: 100 } })]),
      dinner,
    )
    expect(entry(rec, 'discover-it-cash-back').rate).toBeCloseTo(10)
  })

  goldenTest(
    '#28f Customized Cash inside its first year: 6% in the choice category',
    () => {
      const rec = recommend(
        catalog,
        wallet([customized({ opened: '2026-03-04' })]),
        dinner,
      )
      const it = entry(rec, 'bank-of-america-customized-cash-rewards')
      expect(it.rate).toBeCloseTo(6)
      expectSome(
        it.reasoning,
        /^6% cash back in your first year, through Mar 3, 2027; 3% cash back after that\./,
      )
      const grocery = recommend(
        catalog,
        wallet([customized({ opened: '2026-03-04' })]),
        purchase('Safeway', { channel: 'in_store' }),
      )
      expect(
        entry(grocery, 'bank-of-america-customized-cash-rewards').rate,
      ).toBeCloseTo(2)
    },
  )

  goldenTest(
    '#28g Customized Cash: the extra 3% gets no BofA Rewards bonus',
    () => {
      const rec = recommend(
        catalog,
        wallet([customized({ opened: '2026-03-04' })], ['bofa-rewards-member']),
        dinner,
      )
      // 3% × 1.1 + 3%.
      expect(
        entry(rec, 'bank-of-america-customized-cash-rewards').rate,
      ).toBeCloseTo(6.3)
    },
  )

  goldenTest(
    '#28h Customized Cash: the extra 3% stays inside the $2,500 quarterly cap',
    () => {
      const rec = recommend(
        catalog,
        wallet([
          customized({
            opened: '2026-03-04',
            cap_usage: {
              'three-and-two-percent-combined': {
                period: '2026-Q4',
                spent: 2400,
              },
            },
          }),
        ]),
        purchase('Chipotle', { amount: 200, channel: 'in_store' }),
      )
      // $100 at 6%, $100 at 1%.
      expect(
        entry(rec, 'bank-of-america-customized-cash-rewards').rate,
      ).toBeCloseTo(3.5)
    },
  )

  goldenTest('#28i Customized Cash after its first year: 3%', () => {
    const rec = recommend(
      catalog,
      wallet([customized({ opened: '2025-10-01' })]),
      dinner,
    )
    const it = entry(rec, 'bank-of-america-customized-cash-rewards')
    expect(it.rate).toBeCloseTo(3)
    expect(rec.assumptions.join(' ')).not.toMatch(/first-year rate/)
  })

  goldenTest(
    '#28j Customized Cash with no opening date: 3%, and the date is asked for',
    () => {
      const rec = recommend(catalog, wallet([customized()]), dinner)
      expect(
        entry(rec, 'bank-of-america-customized-cash-rewards').rate,
      ).toBeCloseTo(3)
      expectSome(
        rec.assumptions,
        /^A first-year rate may apply on Bank of America Customized Cash Rewards Credit Card: 6% cash back here/,
      )
    },
  )

  goldenTest(
    "#28k no date line for a first-year rate that wouldn't change the pick",
    () => {
      const rec = recommend(
        catalog,
        wallet([customized(), { id: 'citi-double-cash' }]),
        purchase('Safeway', { channel: 'in_store' }),
      )
      expect(rec.assumptions.join(' ')).not.toMatch(/first-year rate/)
    },
  )
})

describe('#29 new cards', () => {
  const wallet = (cards: object[]) =>
    withProfile(WalletSchema.parse({ cards }), 'flat')

  goldenTest(
    '#29a Hilton Honors Business: 12x at Hilton, 5x elsewhere to $100,000 a year, then 3x',
    () => {
      const hilton = entry(
        recommend(
          catalog,
          wallet([{ id: 'amex-hilton-honors-business' }]),
          purchase('Hilton', { amount: 300, channel: 'in_store' }),
        ),
        'amex-hilton-honors-business',
      )
      expect(hilton.rate).toBe(12)
      expect(hilton.effectiveReturnPct).toBeCloseTo(4.8)
      const hardware = purchase("Joe's Hardware Santa Monica", {
        amount: 100,
        channel: 'in_store',
      })
      const fresh = entry(
        recommend(
          catalog,
          wallet([{ id: 'amex-hilton-honors-business' }]),
          hardware,
        ),
        'amex-hilton-honors-business',
      )
      expect(fresh.rate).toBe(5)
      expect(fresh.effectiveReturnPct).toBeCloseTo(2)
      const straddling = entry(
        recommend(
          catalog,
          wallet([
            {
              id: 'amex-hilton-honors-business',
              cap_usage: {
                'everyday-purchases': { period: '2026', spent: 99950 },
              },
            },
          ]),
          hardware,
        ),
        'amex-hilton-honors-business',
      )
      expect(straddling.effectiveReturnPct).toBeCloseTo(1.6)
    },
  )

  goldenTest(
    '#29b JetBlue Plus: 6x at JetBlue, 2x at supermarkets, 1x at Walmart',
    () => {
      const card = (merchant: string) =>
        entry(
          recommend(
            catalog,
            wallet([{ id: 'barclays-jetblue-plus' }]),
            purchase(merchant, { amount: 100, channel: 'in_store' }),
          ),
          'barclays-jetblue-plus',
        )
      expect(card('JetBlue').rate).toBe(6)
      expect(card('Safeway').rate).toBe(2)
      expect(card('Walmart').rate).toBe(1)
    },
  )

  goldenTest(
    '#29c Spark Cash Plus: 5% on hotels through Capital One Business Travel, 2% elsewhere',
    () => {
      const card = (merchant: string) =>
        entry(
          recommend(
            catalog,
            wallet([{ id: 'capital-one-spark-cash-plus' }]),
            purchase(merchant, { amount: 500, channel: 'online' }),
          ),
          'capital-one-spark-cash-plus',
        ).effectiveReturnPct
      expect(card('Capital One Business Travel hotel')).toBeCloseTo(5)
      expect(card('Hilton')).toBeCloseTo(2)
    },
  )

  goldenTest(
    '#29d Delta SkyMiles Blue: 2x at restaurants, 1x at supermarkets',
    () => {
      const card = (merchant: string) =>
        entry(
          recommend(
            catalog,
            wallet([{ id: 'amex-delta-skymiles-blue' }]),
            purchase(merchant, { amount: 50, channel: 'in_store' }),
          ),
          'amex-delta-skymiles-blue',
        ).rate
      expect(card('Chipotle')).toBe(2)
      expect(card('Delta')).toBe(2)
      expect(card('Safeway')).toBe(1)
    },
  )

  goldenTest(
    '#29e Bilt Palladium earns 2x everywhere, 4x on Bilt Travel hotels',
    () => {
      const card = (merchant: string) =>
        entry(
          recommend(
            catalog,
            wallet([{ id: 'bilt-palladium' }]),
            purchase(merchant, { amount: 200, channel: 'online' }),
          ),
          'bilt-palladium',
        ).rate
      expect(card('Hotel through Bilt Travel')).toBe(4)
      expect(card("Joe's Hardware Santa Monica")).toBe(2)
    },
  )
})

describe('#30 merchant statement credits', () => {
  const lululemon = (amount: number | null = 100) =>
    purchase('Lululemon', { amount, channel: 'in_store' })
  const wallet = (platinum: object = {}) =>
    withProfile(
      WalletSchema.parse({
        cards: [
          { id: 'amex-platinum', ...platinum },
          { id: 'citi-double-cash' },
        ],
      }),
      'flat',
    )
  const enrolled = (used?: number) => ({
    enrolled: ['lululemon'],
    ...(used === undefined
      ? {}
      : { credit_usage: { lululemon: { period: '2026-Q4', used } } }),
  })

  goldenTest(
    '#30a Lululemon with no wallet: the credit group first, then the ranking by rate',
    () => {
      const r = exploreCards(
        catalog,
        {
          merchant: 'Lululemon',
          category: null,
          amount: null,
          channel: null,
          date: TODAY,
        },
        { filters: ALL_PERSONAL_CARDS, memberships: [], valuations: {} },
      )
      expect(r.credits).toHaveLength(1)
      expect(r.credits[0]).toMatchObject({
        cardId: 'amex-platinum',
        creditId: 'lululemon',
        amount: 75,
        period: 'quarter',
        enroll: true,
        text: '$75 back each quarter, then 1x Amex Membership Rewards',
      })
      expect(r.credits[0]?.evidence?.quote).toMatch(/\$75 in statement credits/)
      expect(r.credits[0]?.text).not.toMatch(/%/)
      expect(r.ranked[0]?.cardId).not.toBe('amex-platinum')
      const platinum = r.ranked.find((e) => e.cardId === 'amex-platinum')
      expect(platinum?.effectiveReturnPct).toBeCloseTo(1)
      expect(platinum?.credit).toBeNull()
      const clothing = exploreCards(
        catalog,
        {
          merchant: null,
          category: 'clothing',
          amount: null,
          channel: null,
          date: TODAY,
        },
        { filters: ALL_PERSONAL_CARDS, memberships: [], valuations: {} },
      )
      expect(clothing.credits).toEqual([])
    },
  )

  goldenTest(
    '#30b enrolled, with an amount: Platinum wins with the credit dollars counted',
    () => {
      const rec = recommend(catalog, wallet(enrolled()), lululemon())
      expect(rec.decision?.cardId).toBe('amex-platinum')
      const it = entry(rec, 'amex-platinum')
      expect(it.effectiveReturnPct).toBeCloseTo(1)
      expect(it.earned).toBeCloseTo(1)
      expect(it.credit).toMatchObject({ dollars: 75, left: 75, enrolled: true })
      expectSome(it.reasoning, /^\$75 back from its Lululemon credit/)
    },
  )

  goldenTest('#30c not enrolled: shown, says enroll first, never wins', () => {
    const rec = recommend(catalog, wallet(), lululemon())
    expect(rec.decision?.cardId).toBe('citi-double-cash')
    const it = entry(rec, 'amex-platinum')
    expect(it.credit).toMatchObject({ enrolled: false, dollars: 0 })
    expectSome(it.reasoning, /enroll first/)
  })

  goldenTest('#30d used up this quarter: the rate decides again', () => {
    const rec = recommend(catalog, wallet(enrolled(75)), lululemon())
    expect(rec.decision?.cardId).toBe('citi-double-cash')
    const it = entry(rec, 'amex-platinum')
    expect(it.credit).toMatchObject({ left: 0, dollars: 0 })
    expectSome(
      it.reasoning,
      /used up this quarter; it renews after Dec 31, 2026/,
    )
    const nextQuarter = recommend(
      catalog,
      wallet(enrolled(75)),
      purchase('Lululemon', { amount: 100, date: '2027-01-02' }),
    )
    expect(entry(nextQuarter, 'amex-platinum').credit?.dollars).toBe(75)
  })

  goldenTest(
    '#30e a purchase that straddles what is left uses only the rest, and recording it uses it up',
    () => {
      const w = wallet(enrolled(40))
      const rec = recommend(catalog, w, lululemon())
      const it = entry(rec, 'amex-platinum')
      expect(rec.decision?.cardId).toBe('amex-platinum')
      expect(it.credit?.dollars).toBe(35)
      expectSome(it.reasoning, /^\$35 back .*all that's left this quarter/)
      const booked = bookPurchase(catalog, w, {
        cardId: 'amex-platinum',
        merchant: 'Lululemon',
        amount: 100,
        date: TODAY,
        channel: 'in_store',
      })
      expect(booked.credit).toMatchObject({
        creditId: 'lululemon',
        period: '2026-Q4',
        before: 40,
        after: 75,
      })
      const after = recommend(catalog, booked.wallet, lululemon())
      expect(after.decision?.cardId).toBe('citi-double-cash')
      const notEnrolled = bookPurchase(catalog, wallet(), {
        cardId: 'amex-platinum',
        merchant: 'Lululemon',
        amount: 100,
        date: TODAY,
        channel: 'in_store',
      })
      expect(notEnrolled.credit).toBeNull()
    },
  )

  goldenTest(
    '#30f with no amount the credit and what is left show beside the ranking',
    () => {
      const rec = recommend(catalog, wallet(enrolled(40)), lululemon(null))
      expect(rec.decision?.cardId).toBe('citi-double-cash')
      const it = entry(rec, 'amex-platinum')
      expect(it.credit).toMatchObject({ left: 35, dollars: null })
      expectSome(it.reasoning, /\$35 left this quarter/)
    },
  )

  goldenTest(
    '#30g Gold at Dunkin: 4x at restaurants plus the monthly $7',
    () => {
      const rec = recommend(
        catalog,
        withProfile(
          WalletSchema.parse({
            cards: [
              { id: 'amex-gold', enrolled: ['dunkin'] },
              { id: 'citi-double-cash' },
            ],
          }),
          'flat',
        ),
        purchase("Dunkin'", { amount: 5, channel: 'in_store' }),
      )
      const it = entry(rec, 'amex-gold')
      expect(rec.decision?.cardId).toBe('amex-gold')
      expect(it.rate).toBe(4)
      expect(it.credit).toMatchObject({ dollars: 5, left: 7, period: 'month' })
    },
  )

  goldenTest(
    '#30h the to-do list: use what is left by the period end, or enroll',
    () => {
      const items = checklist(catalog, wallet(enrolled(40)), TODAY)
      const use = items.find((i) => i.kind === 'credit')
      expect(use).toMatchObject({
        cardId: 'amex-platinum',
        ref: 'lululemon',
        due: '2026-12-31',
        text: 'Use your $75 Lululemon credit on The Platinum Card from American Express by Dec 31, 2026: $35 left.',
      })
      const ics = checklistCalendar(items, '20261024T000000Z')
      expect(ics).toContain('UID:credit-amex-platinum-lululemon-2026-12-31')
      const usedUp = checklist(catalog, wallet(enrolled(75)), TODAY)
      expect(usedUp.some((i) => i.kind === 'credit')).toBe(false)
      const todo = checklist(catalog, wallet(), TODAY)
      expect(todo.find((i) => i.kind === 'enroll')).toMatchObject({
        text: "Enroll in The Platinum Card from American Express's Lululemon credit with the issuer, then mark it enrolled.",
        due: null,
      })
    },
  )

  goldenTest(
    '#30i the cheat sheet and simulations leave credits out and say so',
    () => {
      const sheet = cheatSheet(catalog, wallet(enrolled()), TODAY)
      expect(sheet.assumptions.join(' ')).toMatch(
        /Merchant statement credits .* are left out/,
      )
    },
  )
})
