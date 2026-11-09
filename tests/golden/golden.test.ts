import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../../src/data/load.ts'
import { walletProblems } from '../../src/data/integrity.ts'
import { recommend } from '../../src/engine/recommend.ts'
import { cardInfo } from '../../src/engine/setup.ts'
import type { Spending } from '../../src/engine/renewal.ts'
import { resolveMerchant } from '../../src/merchants/resolve.ts'
import { catalogCheatSheet, cheatSheet } from '../../src/engine/cheat-sheet.ts'
import { bookPurchase } from '../../src/engine/record.ts'
import { checklist, checklistCalendar } from '../../src/engine/checklist.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  topOf,
} from '../../src/engine/explore.ts'
import { formatExploration } from '../../src/format/explore.ts'
import { formatCatalogSimulation } from '../../src/format/explore.ts'
import { compareOffers } from '../../src/engine/offers.ts'
import { minimumSpendText } from '../../src/engine/text.ts'
import { withSkippedIssuers } from '../../src/engine/wallet-change.ts'
import {
  resolveSpendLines,
  simulateAdditions,
  simulateCatalog,
  simulateWallet,
  spendLineFor,
  typicalSpendLines,
} from '../../src/engine/simulate.ts'
import type {
  Purchase,
  RankedCard,
  Recommendation,
} from '../../src/engine/types.ts'
import { CardSchema, type PaymentMethod } from '../../src/schema/card.ts'
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
      expectSome(hardware.reasoning, /^1% cash back, its base rate\./)
      expectSome(
        hardware.reasoning,
        /^2% cash back in your first year, through Mar 3, 2027; 1% cash back after that\.$/,
      )
      const unactivated = entry(
        recommend(
          catalog,
          wallet([discover({ opened: '2026-03-04', activated: [] })]),
          dinner,
        ),
        'discover-it-cash-back',
      )
      expectSome(
        unactivated.warnings,
        /^Activate this bonus with the issuer \(it's free\) by Dec 31, 2026 to earn 10% cash back here/,
      )
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

describe('#30 how a purchase is paid', () => {
  const wallet = (cards: object[]) =>
    withProfile(WalletSchema.parse({ cards }), 'flat')
  const PAYPAL = 'paypal-cashback-mastercard'
  const APPLE = 'apple-card'
  const rateAt = (
    cardId: string,
    merchant: string,
    extra: Partial<Omit<Purchase, 'merchant'>> = {},
  ) =>
    entry(
      recommend(
        catalog,
        wallet([{ id: cardId }]),
        purchase(merchant, { amount: 100, ...extra }),
      ),
      cardId,
    )

  goldenTest(
    '#30a PayPal Cashback: 3% through PayPal checkout online, 1.5% otherwise',
    () => {
      const checkout = rateAt(PAYPAL, 'etsy.com', { payment: 'paypal' })
      expect(checkout.rate).toBe(3)
      expect(checkout.earned).toBeCloseTo(3)
      expect(checkout.matchedRule).toBe('paypal-checkout')
      expect(rateAt(PAYPAL, 'Etsy', { payment: 'paypal' }).rate).toBe(3)
      expect(rateAt(PAYPAL, 'etsy.com', { payment: 'card' }).rate).toBe(1.5)
      expect(
        rateAt(PAYPAL, 'Target', { payment: 'paypal', channel: 'in_store' })
          .rate,
      ).toBe(1.5)
    },
  )

  goldenTest(
    '#30b PayPal Cashback with the payment unknown: 1.5%, and the 3% is an assumption line',
    () => {
      const rec = recommend(
        catalog,
        wallet([{ id: PAYPAL }, { id: 'citi-double-cash' }]),
        purchase('etsy.com', { amount: 100 }),
      )
      expect(rec.decision?.cardId).toBe('citi-double-cash')
      expect(entry(rec, PAYPAL).rate).toBe(1.5)
      expect(rec.assumptions).toContain(
        "Through PayPal checkout, PayPal Cashback Mastercard would earn 3% cash back here, instead of the 1.5% cash back it's ranked at. Say how you're paying to count it.",
      )
      const told = recommend(
        catalog,
        wallet([{ id: PAYPAL }, { id: 'citi-double-cash' }]),
        purchase('etsy.com', { amount: 100, payment: 'paypal' }),
      )
      expect(told.decision?.cardId).toBe(PAYPAL)
      expectSome(
        told.assumptions,
        /^Counts this as paid through PayPal checkout/,
      )
      expect(told.assumptions.join(' ')).not.toMatch(/would earn/)
    },
  )

  goldenTest(
    '#30c Apple Card: 2% with Apple Pay, 1% with the card, never Apple Pay by assumption',
    () => {
      const grocery = (payment?: Purchase['payment']) =>
        rateAt(APPLE, 'Safeway', {
          channel: 'in_store',
          ...(payment === undefined ? {} : { payment }),
        }).rate
      expect(grocery()).toBe(1)
      expect(grocery(null)).toBe(1)
      expect(grocery('card')).toBe(1)
      expect(grocery('google-pay')).toBe(1)
      expect(grocery('apple-pay')).toBe(2)
    },
  )

  goldenTest(
    '#30d Apple Card: 3% at Apple however it is paid, 3% at Nike and Walgreens only with Apple Pay',
    () => {
      expect(rateAt(APPLE, 'Apple Store').rate).toBe(3)
      expect(rateAt(APPLE, 'Apple Store', { payment: 'card' }).rate).toBe(3)
      expect(rateAt(APPLE, 'Nike', { payment: 'apple-pay' }).rate).toBe(3)
      expect(rateAt(APPLE, 'Walgreens', { payment: 'apple-pay' }).rate).toBe(3)
      expect(rateAt(APPLE, 'Nike', { payment: 'card' }).rate).toBe(1)
      // The merchant 3% is U.S. only; abroad, Apple Pay earns 2% with no fee.
      const abroad = rateAt(APPLE, 'Nike', {
        payment: 'apple-pay',
        country: 'FR',
      })
      expect(abroad.rate).toBe(2)
      expect(abroad.effectiveReturnPct).toBe(2)
      expect(abroad.foreignFee).toBeNull()
    },
  )

  goldenTest(
    '#30e the Apple Pay line appears only where it would change the pick or raise the winner',
    () => {
      const cards = wallet([{ id: APPLE }, { id: 'citi-double-cash' }])
      const nike = recommend(catalog, cards, purchase('Nike'))
      expect(nike.decision?.cardId).toBe('citi-double-cash')
      expect(nike.assumptions).toContain(
        "With Apple Pay, Apple Card would earn 3% cash back here, instead of the 1% cash back it's ranked at. Say how you're paying to count it.",
      )
      // 2% with Apple Pay only ties Double Cash's 2%.
      const grocery = recommend(catalog, cards, purchase('Safeway'))
      expect(grocery.assumptions.join(' ')).not.toMatch(/Apple Pay/)
      const alone = recommend(
        catalog,
        wallet([{ id: APPLE }]),
        purchase('Safeway'),
      )
      expectSome(alone.assumptions, /^With Apple Pay, Apple Card would earn 2%/)
    },
  )

  goldenTest(
    '#30f a rule can exclude a way of paying: it still applies when the payment is unknown',
    () => {
      const card = CardSchema.parse({
        id: 'test-no-paypal',
        name: 'Test No PayPal',
        issuer: 'chase',
        network: 'visa',
        currency: 'cash',
        last_verified: TODAY,
        verified_by: 'test',
        source_urls: ['https://example.com/'],
        base_rate: 1,
        foreign_transaction_fee: 0,
        rules: [
          {
            id: 'dining',
            match: { categories: ['dining'] },
            exclude: { payment: ['paypal'] },
            rate: 4,
          },
        ],
      })
      const withCard = { ...catalog, cards: [...catalog.cards, card] }
      const rate = (payment: PaymentMethod | null) =>
        entry(
          recommend(
            withCard,
            wallet([{ id: card.id }]),
            purchase('Chipotle', { payment }),
          ),
          card.id,
        ).rate
      expect(rate(null)).toBe(4)
      expect(rate('apple-pay')).toBe(4)
      expect(rate('paypal')).toBe(1)
    },
  )

  goldenTest(
    '#30g the cheat sheet and simulations use rates without a way of paying, and say so',
    () => {
      const cards = wallet([{ id: APPLE }, { id: PAYPAL }])
      const sheet = cheatSheet(catalog, cards, TODAY)
      expect(sheet.notes).toContain(
        "Rates with Apple Pay or through PayPal checkout (Apple Card and PayPal Cashback Mastercard) aren't counted: this ranks each card by what it earns however you pay.",
      )
      expect(
        sheet.rows.find((r) => r.label === 'Groceries')?.effectiveReturnPct,
      ).toBe(1.5)
      const year = simulateWallet(
        catalog,
        wallet([{ id: APPLE }]),
        resolveSpendLines(catalog, [
          { merchant: null, category: 'grocery.supermarket', monthly: 100 },
        ]),
        '2027-01-01',
      )
      expect(year.rewards).toBeCloseTo(12)
      expectSome(
        year.notes,
        /^Rates with Apple Pay \(Apple Card\) aren't counted/,
      )
    },
  )
})

describe('#31 credit union and fintech cards', () => {
  const wallet = (cards: object[], memberships: string[] = []) =>
    withProfile(WalletSchema.parse({ cards, memberships }), 'flat')
  const rateAt = (cardId: string, merchant: string) =>
    entry(
      recommend(
        catalog,
        wallet([{ id: cardId }]),
        purchase(merchant, { amount: 100, channel: 'in_store' }),
      ),
      cardId,
    ).rate

  goldenTest(
    '#31a Caltech EFCU Platinum Mastercard earns nothing, but has no foreign transaction fee',
    () => {
      const cards = wallet([
        { id: 'caltech-efcu-platinum-mastercard' },
        { id: 'citi-double-cash' },
      ])
      const etsy = (country: string) =>
        purchase('Etsy', { amount: 100, channel: 'online', country })
      const home = recommend(catalog, cards, etsy('US'))
      expect(home.decision?.cardId).toBe('citi-double-cash')
      expect(home.decision?.effectiveReturnPct).toBeCloseTo(2)
      expect(entry(home, 'caltech-efcu-platinum-mastercard').rate).toBe(0)
      const abroad = recommend(catalog, cards, etsy('GB'))
      expect(abroad.decision?.cardId).toBe('caltech-efcu-platinum-mastercard')
      expect(abroad.decision?.effectiveReturnPct).toBeCloseTo(0)
      expect(entry(abroad, 'citi-double-cash').effectiveReturnPct).toBeCloseTo(
        2 - 3,
      )
    },
  )

  goldenTest(
    '#31b Smartly: 2% without a tier, 3% at the 50% tier on the first $10,000 a billing cycle',
    () => {
      const etsy = purchase('Etsy', { amount: 100, channel: 'online' })
      const smartly = (cards: object[], memberships: string[] = []) =>
        entry(
          recommend(catalog, wallet(cards, memberships), etsy),
          'usbank-smartly',
        ).effectiveReturnPct
      expect(smartly([{ id: 'usbank-smartly' }])).toBeCloseTo(2)
      expect(
        smartly([{ id: 'usbank-smartly' }], ['usbank-smartly-50']),
      ).toBeCloseTo(3)
      const nearCap = [
        {
          id: 'usbank-smartly',
          cap_usage: {
            'smartly-earning-bonus': { period: '2026-10', spent: 9950 },
          },
        },
      ]
      expect(smartly(nearCap, ['usbank-smartly-50'])).toBeCloseTo(
        (50 * 3 + 50 * 2) / 100,
      )
    },
  )

  goldenTest(
    '#31c Verizon Visa: 4% on gas, supermarkets, dining and Verizon devices; 1% on the Verizon bill',
    () => {
      expect(rateAt('verizon-visa-card', 'Shell')).toBe(4)
      expect(rateAt('verizon-visa-card', 'Safeway')).toBe(4)
      expect(rateAt('verizon-visa-card', 'Chipotle')).toBe(4)
      expect(rateAt('verizon-visa-card', 'Verizon store')).toBe(4)
      expect(rateAt('verizon-visa-card', 'Verizon')).toBe(1)
    },
  )

  goldenTest(
    '#31d Navy Federal More Rewards: 3X at supermarkets, gas and restaurants, 1X at Walmart',
    () => {
      expect(rateAt('navy-federal-more-rewards-amex', 'Safeway')).toBe(3)
      expect(rateAt('navy-federal-more-rewards-amex', 'Shell')).toBe(3)
      expect(rateAt('navy-federal-more-rewards-amex', 'Chipotle')).toBe(3)
      expect(rateAt('navy-federal-more-rewards-amex', 'Walmart')).toBe(1)
    },
  )

  goldenTest(
    '#31e Venmo: 3% on dining and at movie theaters, 1% at supermarkets',
    () => {
      expect(rateAt('venmo-credit-card', 'Chipotle')).toBe(3)
      expect(rateAt('venmo-credit-card', 'AMC Theatres')).toBe(3)
      expect(rateAt('venmo-credit-card', 'Safeway')).toBe(1)
    },
  )
})

describe('#32 merchant statement credits', () => {
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
    '#32a Lululemon with no wallet: the credit group first, then the ranking by rate',
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
    '#32b enrolled, with an amount: Platinum wins with the credit dollars counted',
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

  goldenTest('#32c not enrolled: shown, says enroll first, never wins', () => {
    const rec = recommend(catalog, wallet(), lululemon())
    expect(rec.decision?.cardId).toBe('citi-double-cash')
    const it = entry(rec, 'amex-platinum')
    expect(it.credit).toMatchObject({ enrolled: false, dollars: 0 })
    expectSome(it.reasoning, /enroll first/)
  })

  goldenTest('#32d used up this quarter: the rate decides again', () => {
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
    '#32e a purchase that straddles what is left uses only the rest, and recording it uses it up',
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
    '#32f with no amount the credit and what is left show beside the ranking',
    () => {
      const rec = recommend(catalog, wallet(enrolled(40)), lululemon(null))
      expect(rec.decision?.cardId).toBe('citi-double-cash')
      const it = entry(rec, 'amex-platinum')
      expect(it.credit).toMatchObject({ left: 35, dollars: null })
      expectSome(it.reasoning, /\$35 left this quarter/)
    },
  )

  goldenTest(
    '#32g Gold at Dunkin: 4x at restaurants plus the monthly $7',
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
    '#32h the to-do list: use what is left by the period end, or enroll',
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
      const enroll = todo.filter((i) => i.kind === 'enroll')
      expect(enroll).toHaveLength(2)
      expect(enroll.every((i) => i.due === null)).toBe(true)
      expect(enroll[0]?.text).toMatch(
        /^Do you use The Platinum Card from American Express' Uber, Uber One, Walmart\+ membership and CLEAR credits\? Say which you use and they count against the annual fee\.$/,
      )
      expect(enroll[1]?.text).toMatch(
        /^Enroll in The Platinum Card from American Express' Lululemon, Resy, .* and YouTube TV credits with the issuer, then mark them enrolled\.$/,
      )
    },
  )

  goldenTest('#32i the cheat sheet leaves credits out and says so', () => {
    const sheet = cheatSheet(catalog, wallet(enrolled()), TODAY)
    expect(sheet.assumptions.join(' ')).toMatch(
      /Statement credits .* are left out/,
    )
  })
})

describe('#33 merchant credits across issuers', () => {
  const wallet = (cards: object[]) =>
    withProfile(WalletSchema.parse({ cards }), 'flat')
  const everyCard = (merchant: string) =>
    exploreCards(
      catalog,
      { merchant, category: null, amount: null, channel: null, date: TODAY },
      { filters: ALL_PERSONAL_CARDS, memberships: [], valuations: {} },
    )

  goldenTest(
    '#33a Hilton Surpass: $50 a quarter at any Hilton brand, Hampton Inn included, with no enrollment',
    () => {
      const rec = recommend(
        catalog,
        wallet([{ id: 'amex-hilton-honors-surpass' }]),
        purchase('Hampton Inn', { amount: 180 }),
      )
      expect(entry(rec, 'amex-hilton-honors-surpass').credit).toMatchObject({
        id: 'hilton',
        amount: 50,
        period: 'quarter',
        enrolled: true,
        dollars: 50,
        until: '2026-12-31',
      })
    },
  )

  goldenTest(
    '#33b Sapphire Reserve: $300 of travel each cardmember year, and the rest of a $400 flight earns only points',
    () => {
      const reserve = { id: 'chase-sapphire-reserve', anniversary: '03-01' }
      const rec = recommend(
        catalog,
        wallet([reserve]),
        purchase('Delta', { amount: 400 }),
      )
      expect(entry(rec, 'chase-sapphire-reserve').credit).toMatchObject({
        id: 'travel',
        dollars: 300,
        left: 300,
        until: '2027-02-28',
      })
      const used = recommend(
        catalog,
        wallet([
          {
            ...reserve,
            credit_usage: { travel: { period: '2026', used: 300 } },
          },
        ]),
        purchase('Delta', { amount: 400 }),
      )
      expect(entry(used, 'chase-sapphire-reserve').credit?.dollars).toBe(0)
      const noAnniversary = recommend(
        catalog,
        wallet([{ id: 'chase-sapphire-reserve' }]),
        purchase('Delta', { amount: 400 }),
      )
      expect(
        entry(noAnniversary, 'chase-sapphire-reserve').credit,
      ).toMatchObject({ left: null, dollars: 0 })
    },
  )

  goldenTest(
    '#33c United Quest: $8 a month on rideshare once opted in, by category',
    () => {
      const ride = purchase('Uber', { amount: 25 })
      const opted = recommend(
        catalog,
        wallet([{ id: 'chase-united-quest', enrolled: ['rideshare'] }]),
        ride,
      )
      expect(entry(opted, 'chase-united-quest').credit).toMatchObject({
        id: 'rideshare',
        dollars: 8,
        period: 'month',
      })
      const not = recommend(
        catalog,
        wallet([{ id: 'chase-united-quest' }]),
        ride,
      )
      expect(entry(not, 'chase-united-quest').credit).toMatchObject({
        enrolled: false,
        dollars: 0,
      })
    },
  )

  goldenTest(
    '#33d Venture X: the $300 Capital One Travel credit on a hotel booked there',
    () => {
      const rec = recommend(
        catalog,
        wallet([{ id: 'capital-one-venture-x', anniversary: '06-15' }]),
        purchase('Hotel through Capital One Travel', { amount: 500 }),
      )
      expect(entry(rec, 'capital-one-venture-x').credit).toMatchObject({
        id: 'capital-one-travel',
        dollars: 300,
        until: '2027-06-14',
      })
    },
  )

  goldenTest(
    '#33e Resy with no wallet: every card with a Resy credit, most per year first',
    () => {
      expect(everyCard('Resy').credits.map((c) => [c.cardId, c.back])).toEqual([
        ['amex-platinum', '$100 back each quarter'],
        ['amex-delta-skymiles-reserve', '$20 back each month'],
        ['amex-delta-skymiles-platinum', '$10 back each month'],
        ['amex-gold', '$50 back each half year'],
      ])
    },
  )

  goldenTest(
    '#33f Uber with no wallet: Uber Cash and the credits that name Uber, never as a percent',
    () => {
      const credits = everyCard('Uber').credits
      expect(credits[0]).toMatchObject({
        cardId: 'amex-platinum',
        creditId: 'uber-cash',
        enroll: false,
        text: '$15 back each month, then 1x Amex Membership Rewards',
      })
      const cards = credits.map((c) => c.cardId)
      expect(cards).toEqual(
        expect.arrayContaining(['amex-gold', 'amex-delta-skymiles-gold']),
      )
      expect(cards).not.toContain('chase-united-explorer')
      for (const c of credits) expect(c.text).not.toMatch(/%/)
    },
  )
})

describe('#34 statement credits against the annual fee', () => {
  const gold = (fields: object = {}) =>
    WalletSchema.parse({ cards: [{ id: 'amex-gold', ...fields }] })
  const typical = typicalSpendLines(catalog)
  const options = {
    filters: ALL_PERSONAL_CARDS,
    memberships: [],
    valuations: {},
    start: TODAY,
  }

  goldenTest(
    '#34a a held card: the credits you use come off its fee, and it says which',
    () => {
      const { current } = simulateAdditions(
        catalog,
        gold({ enrolled: ['dunkin', 'uber-cash'] }),
        typical,
        options,
      )
      expect(current.heldCredits).toBe(204)
      expect(current.net).toBeCloseTo(current.rewards + 204 - 325)
      expect(current.otherCredits).toBe(0)
      expect(current.notes).toContain(
        "Amex Gold's credits you use (Dunkin' and Uber) count against its fee: $204 a year.",
      )
    },
  )

  goldenTest(
    '#34b a card you do not hold: ranked without its credits, with them shown apart',
    () => {
      const { singles } = simulateCatalog(catalog, typical, options)
      const it = singles.find((s) => s.cards[0]?.cardId === 'amex-gold')
      expect(it?.heldCredits).toBe(0)
      expect(it?.net).toBeCloseTo((it?.rewards ?? 0) - 325)
      expect(it?.otherCredits).toBe(424)
      expect(it?.netIfCreditsUsed).toBeCloseTo((it?.net ?? 0) + 424)
      expect(it?.credits).toEqual([
        {
          cardId: 'amex-gold',
          yearly: 424,
          creditIds: ['dunkin', 'uber-cash', 'dining', 'resy'],
          names: ["Dunkin'", 'Uber', 'Grubhub', 'Resy'],
          nights: 0,
          nightIds: [],
          ownNights: 0,
          ownNightIds: [],
          unvaluedNightIds: [],
          held: false,
        },
      ])
    },
  )

  goldenTest(
    '#34c a credit you do not use: off the to-do list, out of the pick and the fee',
    () => {
      const skipped = gold({
        enrolled: ['resy'],
        skipped_credits: ['dunkin', 'dining', 'resy'],
        credit_usage: { 'uber-cash': { period: '2026-10', used: 4 } },
      })
      const before = checklist(
        catalog,
        gold({
          enrolled: ['resy'],
          credit_usage: { 'uber-cash': { period: '2026-10', used: 4 } },
        }),
        TODAY,
      )
      expect(before.map((i) => i.kind)).toEqual(
        expect.arrayContaining(['enroll', 'credit']),
      )
      expect(before.filter((i) => i.kind === 'credit')).toHaveLength(2)
      const after = checklist(catalog, skipped, TODAY)
      expect(after.some((i) => i.kind === 'enroll')).toBe(false)
      expect(after.filter((i) => i.kind === 'credit')).toEqual([
        expect.objectContaining({ ref: 'uber-cash' }),
      ])
      const rec = recommend(
        catalog,
        skipped,
        purchase('Resy', { amount: 80, channel: 'in_store' }),
      )
      expect(entry(rec, 'amex-gold').credit).toBeNull()
      const sim = simulateWallet(catalog, skipped, typical, TODAY, [
        'amex-gold',
      ])
      expect(sim.heldCredits).toBe(120)
    },
  )

  goldenTest(
    '#34d welcome offers rank on the first two years and add the credits apart',
    () => {
      const { offers } = compareOffers(
        catalog,
        { valuations: {}, memberships: [], cards: [] },
        { kind: 'any', business: false, noAnnualFee: false, includeHeld: true },
        TODAY,
      )
      const it = offers.find((o) => o.cardId === 'amex-gold')
      expect(it?.credits).toBe(424)
      expect(it?.firstYearValueIfCreditsUsed).toBeCloseTo(
        (it?.firstYearValue ?? 0) + 424,
      )
      const values = offers
        .filter((o) => o.ineligible === null)
        .map((o) => o.plan?.twoYears ?? -Infinity)
      expect(values).toEqual([...values].sort((a, b) => b - a))
    },
  )
})

describe('#35 terms with a size or a date', () => {
  const cardById = (c: Catalog, id: string) => {
    const card = c.cards.find((x) => x.id === id)
    if (!card) throw new Error(`no ${id}`)
    return card
  }
  const only = (id: string) =>
    withProfile(WalletSchema.parse({ cards: [{ id }] }), 'flat')

  goldenTest(
    '#35a Amex Business Platinum: 2X on one purchase of $5,000 or more, and says so without an amount',
    () => {
      const at = (amount: number | null) =>
        entry(
          recommend(
            catalog,
            only('amex-business-platinum'),
            purchase('Staples', { amount, channel: 'in_store' }),
          ),
          'amex-business-platinum',
        )
      expect(at(6_000).rate).toBe(2)
      expect(at(5_000).rate).toBe(2)
      expect(at(4_999).rate).toBe(1)
      const unknown = recommend(
        catalog,
        only('amex-business-platinum'),
        purchase('Staples', { channel: 'in_store' }),
      )
      expect(entry(unknown, 'amex-business-platinum').rate).toBe(1)
      expectSome(
        unknown.assumptions,
        /^On a purchase of \$5,000 or more, The Business Platinum Card from American Express would earn 2x Amex Membership Rewards here, instead of the 1x Amex Membership Rewards it's ranked at\. Give the amount to count it\.$/,
      )
    },
  )

  goldenTest(
    "#35b Citi Strata Premier's hotel benefit pays only on a stay of $500 or more",
    () => {
      const stay = (amount: number) =>
        entry(
          recommend(
            catalog,
            only('citi-strata-premier'),
            purchase('citi travel hotel', { amount }),
          ),
          'citi-strata-premier',
        )
      expect(stay(600).credit).toMatchObject({ dollars: 100 })
      const small = stay(300)
      expect(small.credit).toMatchObject({ dollars: 0 })
      expectSome(
        small.reasoning,
        /needs a purchase of \$500 or more, so it doesn't count here\.$/,
      )
      const listed = exploreCards(
        catalog,
        {
          merchant: 'citi travel hotel',
          category: null,
          amount: null,
          channel: null,
          date: TODAY,
        },
        { filters: ALL_PERSONAL_CARDS, memberships: [], valuations: {} },
      ).credits.find((c) => c.cardId === 'citi-strata-premier')
      expect(listed?.text).toBe(
        '$100 back each calendar year with a purchase of $500 or more, then 10x Citi ThankYou points',
      )
    },
  )

  goldenTest(
    "#35c Sapphire Reserve's Lyft credit stops after Sep 30, 2027",
    () => {
      const ride = (date: string) =>
        entry(
          recommend(
            catalog,
            only('chase-sapphire-reserve'),
            purchase('Lyft', { amount: 20, date }),
          ),
          'chase-sapphire-reserve',
        )
      expect(ride('2027-09-15').credit).toMatchObject({ dollars: 10 })
      expect(ride('2027-10-05').credit).toBeNull()
    },
  )

  goldenTest(
    "#35d IHG's 2027 spend bonuses are listed with their start date",
    () => {
      const business = cardInfo(
        catalog,
        cardById(catalog, 'chase-ihg-one-rewards-business'),
        null,
        TODAY,
      )
      expect(business.milestones.map((m) => m.text)).toContain(
        '$50,000 calendar-year spend for Diamond Elite status starting Jan 1, 2027',
      )
      const personal = cardInfo(
        catalog,
        cardById(catalog, 'chase-ihg-one-rewards'),
        null,
        TODAY,
      )
      expect(personal.milestones.map((m) => m.text)).toContain(
        '$5,000 calendar-year spend for a 4th Reward Night free on four-night award stays starting Jan 1, 2027',
      )
    },
  )
})

describe('#36 the renewal check', () => {
  const wallet = (cards: object[]) =>
    withProfile(WalletSchema.parse({ cards }), 'flat')
  const renewals = (w: Wallet, today: string, spending?: Spending) =>
    checklist(catalog, w, today, undefined, undefined, spending).filter(
      (i) => i.kind === 'renewal',
    )
  const platinum = (fields: object = {}) =>
    wallet([
      { id: 'amex-platinum', anniversary: '12-01', ...fields },
      { id: 'citi-double-cash' },
    ])

  goldenTest(
    '#36a a card short of its fee says by how much, from the wallet without it',
    () => {
      const [item] = renewals(
        platinum({ enrolled: ['lululemon'] }),
        '2026-11-07',
      )
      expect(item).toMatchObject({ cardId: 'amex-platinum', due: '2026-12-01' })
      expect(item?.text).toMatch(
        /^The Platinum Card from American Express renews around Dec 1, 2026 \(\$895 fee\)\. At typical spending, it earns about .+ (than|as) your other cards would, plus \$300 in credits you use: about \$[\d,]+ a year short of the fee\. Check with American Express before the fee posts\.$/,
      )
    },
  )

  goldenTest('#36b a card well ahead of its fee gets one short line', () => {
    const [item] = renewals(
      wallet([
        { id: 'amex-blue-cash-preferred', anniversary: '11-25' },
        { id: 'citi-double-cash' },
      ]),
      '2026-11-07',
      {
        lines: resolveSpendLines(catalog, [
          spendLineFor(catalog, 'groceries', 1_000),
        ]),
        typical: false,
      },
    )
    expect(item?.text).toMatch(
      /^American Express Blue Cash Preferred Card renews around Nov 25, 2026 \(\$95 fee\): it's paying for itself, about \$[\d,]+ a year ahead after the fee\.$/,
    )
  })

  goldenTest(
    '#36c it shows from 30 days before the anniversary to 15 after',
    () => {
      const w = platinum()
      expect(renewals(w, '2026-10-31')).toHaveLength(0)
      expect(renewals(w, '2026-11-01')).toHaveLength(1)
      expect(renewals(w, '2026-12-16')).toHaveLength(1)
      expect(renewals(w, '2026-12-17')).toHaveLength(0)
    },
  )

  goldenTest(
    '#36d the opening date stands in for the anniversary, but not in the first months',
    () => {
      expect(
        renewals(wallet([{ id: 'amex-platinum' }]), '2026-11-07'),
      ).toHaveLength(0)
      expect(
        renewals(
          wallet([{ id: 'amex-platinum', opened: '2024-11-20' }]),
          '2026-11-07',
        )[0]?.due,
      ).toBe('2026-11-20')
      expect(
        renewals(
          wallet([{ id: 'amex-platinum', opened: '2026-11-01' }]),
          '2026-11-07',
        ),
      ).toHaveLength(0)
    },
  )

  goldenTest(
    '#36e the first renewal after a lower first-year fee says so',
    () => {
      const [item] = renewals(
        wallet([
          { id: 'amex-blue-cash-preferred', opened: '2025-11-20' },
          { id: 'citi-double-cash' },
        ]),
        '2026-11-07',
      )
      expect(item?.text).toContain('($95 fee, up from $0 the first year)')
    },
  )

  goldenTest(
    '#36f a card held alone is weighed against the best no-fee card, and your own spending says so',
    () => {
      const [item] = renewals(
        wallet([{ id: 'chase-sapphire-preferred', anniversary: '11-10' }]),
        '2026-11-07',
        {
          lines: resolveSpendLines(catalog, [
            spendLineFor(catalog, 'dining', 50),
          ]),
          typical: false,
        },
      )
      expect(item?.text).toMatch(
        /\. On your spending, it earns about \$[\d,]+ a year (more|less) than U\.S\. Bank Altitude Go would: about \$[\d,]+ a year short of the fee\. Check with Chase before the fee posts\.$/,
      )
      expect(item?.text).not.toMatch(/your other cards/)
    },
  )

  goldenTest(
    '#36h a saved card earnrate no longer lists is skipped, not an error',
    () => {
      const w = withProfile(
        {
          ...WalletSchema.parse({
            cards: [{ id: 'amex-platinum', anniversary: '12-01' }],
          }),
          cards: [
            ...WalletSchema.parse({
              cards: [{ id: 'amex-platinum', anniversary: '12-01' }],
            }).cards,
            { id: 'retired-card', cap_usage: {}, activated: [] },
          ],
        },
        'flat',
      )
      expect(renewals(w, '2026-11-07')).toHaveLength(1)
    },
  )

  goldenTest(
    '#36i a credit confirmed by recorded use counts, like one marked used',
    () => {
      const text = (fields: object) =>
        renewals(
          wallet([
            { id: 'capital-one-venture-x', anniversary: '11-20', ...fields },
            { id: 'citi-double-cash' },
          ]),
          '2026-11-07',
        )[0]?.text
      const used = text({
        credit_usage: { 'capital-one-travel': { period: '2026', used: 120 } },
      })
      const marked = text({ enrolled: ['capital-one-travel'] })
      expect(used).toContain('plus $300 in credits you use')
      expect(used).toBe(marked)
    },
  )

  goldenTest(
    "#36j an anniversary that isn't a date gets no renewal, and the wallet check flags it",
    () => {
      const w = wallet([{ id: 'amex-gold', anniversary: '13-45' }])
      expect(renewals(w, '2026-11-07')).toHaveLength(0)
      expect(walletProblems(w, catalog)).toContain(
        "wallet card amex-gold: anniversary '13-45' isn't a date",
      )
    },
  )

  goldenTest('#36g no-fee cards never get one', () => {
    expect(
      renewals(
        wallet([{ id: 'citi-double-cash', anniversary: '11-10' }]),
        '2026-11-07',
      ),
    ).toHaveLength(0)
  })
})

describe('#37 the next-card planner', () => {
  const ANY = {
    kind: 'any' as const,
    business: false,
    noAnnualFee: false,
    includeHeld: false,
  }
  const plan = (w: object, spending?: Spending) =>
    compareOffers(
      catalog,
      withProfile(WalletSchema.parse(w), 'flat'),
      ANY,
      TODAY,
      spending,
    )
  const find = (r: ReturnType<typeof plan>, id: string) => {
    const o = r.offers.find((x) => x.cardId === id)
    if (!o) throw new Error(`${id} isn't offered`)
    return o
  }

  goldenTest(
    '#37a each offer is ranked on its first two years: what it adds, plus the bonus in year one, less each year’s fee',
    () => {
      const r = plan({ cards: [{ id: 'citi-double-cash' }] })
      const eligible = r.offers.filter((o) => o.ineligible === null)
      const totals = eligible.map((o) => o.plan?.twoYears ?? -Infinity)
      expect(totals).toEqual([...totals].sort((a, b) => b - a))
      const csp = find(r, 'chase-sapphire-preferred')
      const p = csp.plan
      if (!p) throw new Error('no plan')
      expect(p.yearOne).toBeCloseTo(
        p.extraRewards + csp.bonusValue - (csp.firstYearFee ?? 0),
      )
      expect(p.yearTwo).toBeCloseTo(p.extraRewards - (csp.annualFee ?? 0))
      expect(p.twoYears).toBeCloseTo(p.yearOne + p.yearTwo)
      expectSome(
        r.notes,
        /^Ranked on the first two years together: what each card adds to your cards on typical U\.S\. spending/,
      )
    },
  )

  goldenTest(
    "#37b a minimum spend that doesn't fit leaves the bonus out of year one, and says so",
    () => {
      const small: Spending = {
        lines: resolveSpendLines(catalog, [
          spendLineFor(catalog, 'groceries', 200),
        ]),
        typical: false,
      }
      const r = plan({ cards: [] }, small)
      const csp = find(r, 'chase-sapphire-preferred')
      expect(csp.plan?.minimumSpend).toMatchObject({ reachable: false })
      expect(csp.plan?.yearOne).toBeCloseTo(
        (csp.plan?.extraRewards ?? 0) - (csp.firstYearFee ?? 0),
      )
      expect(
        minimumSpendText(
          csp.spend,
          csp.months,
          csp.plan?.minimumSpend ?? { reachable: true, weeks: 0 },
          false,
        ),
      ).toMatch(
        /^The \$[\d,]+ minimum in \d+ months is more than your spending, so the bonus isn't counted\.$/,
      )
      const reachable = find(plan({ cards: [] }), 'chase-sapphire-preferred')
      expect(reachable.plan?.minimumSpend?.reachable).toBe(true)
      expect(reachable.plan?.minimumSpend?.weeks).toBeGreaterThan(0)
    },
  )

  goldenTest(
    '#37c skipped issuers are left out, saved or for one answer, and the notes say so',
    () => {
      const saved = plan({ cards: [], skipped_issuers: ['chase'] })
      expect(saved.offers.some((o) => o.issuer === 'chase')).toBe(false)
      expectSome(saved.notes, /^Leaves out cards from Chase, as you asked\.$/)
      expect(plan({ cards: [] }).offers.some((o) => o.issuer === 'chase')).toBe(
        true,
      )
      const w = withSkippedIssuers(catalog, WalletSchema.parse({}), ['chse'])
      expect(w.ok || w.error).toMatch(
        /^No card earnrate knows is from 'chse'\./,
      )
    },
  )

  goldenTest(
    '#37d skipped issuers also leave "would another card help?"',
    () => {
      const w = withProfile(
        WalletSchema.parse({
          cards: [{ id: 'citi-double-cash' }],
          skipped_issuers: ['chase', 'amex'],
        }),
        'flat',
      )
      const { additions } = simulateAdditions(
        catalog,
        w,
        typicalSpendLines(catalog),
        {
          filters: ALL_PERSONAL_CARDS,
          memberships: [],
          valuations: w.valuations,
          start: TODAY,
        },
      )
      const issuers = new Set(
        additions.map(
          (a) => catalog.cards.find((c) => c.id === a.cardId)?.issuer,
        ),
      )
      expect(issuers.has('chase')).toBe(false)
      expect(issuers.has('amex')).toBe(false)
      expect(issuers.has('citi')).toBe(true)
    },
  )
})

describe('#38 yearly free nights', () => {
  const ihg = (fields: object = {}) =>
    withProfile(
      WalletSchema.parse({
        cards: [
          {
            id: 'chase-ihg-one-rewards-premier',
            anniversary: '11-15',
            ...fields,
          },
          { id: 'citi-double-cash' },
        ],
      }),
      'flat',
    )
  const renewal = (w: Wallet) =>
    checklist(catalog, w, TODAY).find((i) => i.kind === 'renewal')
  const both = ['chase-ihg-one-rewards-premier', 'citi-double-cash']

  goldenTest(
    "#38a until the cardholder says they use it, the night doesn't offset the fee, and the check says what it would",
    () => {
      expect(renewal(ihg())?.text).toMatch(
        /^IHG One Rewards Premier Credit Card renews around Nov 15, 2026 \(\$150 fee\)\. At typical spending, it earns about \$\d+ a year more than your other cards would: about \$\d+ a year short of the fee\. Its anniversary free night \(up to \$250\) isn't counted until you say you use it; with it, up to about \$\d+ a year ahead\. Check with Chase before the fee posts\.$/,
      )
    },
  )

  goldenTest(
    '#38b once used, the night counts at its cap times the point value, and the check names it when it tips the result',
    () => {
      const w = ihg({ enrolled: ['anniversary-night'] })
      expect(renewal(w)?.text).toMatch(
        /, plus up to \$250 for its anniversary free night: about \$\d+ a year ahead after the fee, but only with the free night at its full value\.$/,
      )
      const lines = typicalSpendLines(catalog)
      expect(simulateWallet(catalog, w, lines, TODAY, both).heldCredits).toBe(
        250,
      )
      const valued = {
        ...w,
        valuations: { ...w.valuations, 'ihg-points': 0.7 },
      }
      expect(
        simulateWallet(catalog, valued, lines, TODAY, both).heldCredits,
      ).toBe(350)
    },
  )

  goldenTest(
    "#38c a night the cardholder doesn't use counts nowhere and isn't asked about",
    () => {
      const w = ihg({ skipped_credits: ['anniversary-night'] })
      expect(renewal(w)?.text).not.toMatch(/free night/)
      expect(
        checklist(catalog, w, TODAY).some((i) =>
          i.text.startsWith('Do you use'),
        ),
      ).toBe(false)
    },
  )

  goldenTest(
    "#38d the planner shows a card's free night apart, from year two, never in the ranking",
    () => {
      const { offers } = compareOffers(
        catalog,
        withProfile(
          WalletSchema.parse({ cards: [{ id: 'citi-double-cash' }] }),
          'flat',
        ),
        {
          kind: 'any',
          business: false,
          noAnnualFee: false,
          includeHeld: false,
        },
        TODAY,
      )
      const it = offers.find(
        (o) => o.cardId === 'chase-ihg-one-rewards-premier',
      )
      expect(it?.freeNights).toBe(250)
      expect(it?.credits).toBe(120)
      expect(it?.firstYearValueIfCreditsUsed).toBeCloseTo(
        (it?.firstYearValue ?? 0) + 120,
      )
      expect(it?.plan?.yearTwo).toBeCloseTo((it?.plan?.extraRewards ?? 0) - 150)
    },
  )
})

describe('#39 cards that need a membership, when every card is ranked', () => {
  const GATED = new Set(
    catalog.cards.filter((c) => c.requires_membership).map((c) => c.id),
  )
  const options = (memberships: string[] = []) => ({
    filters: ALL_PERSONAL_CARDS,
    memberships,
    valuations: {},
  })
  const groceries = (memberships: string[] = []) =>
    exploreCards(
      catalog,
      {
        merchant: null,
        category: 'grocery.supermarket',
        amount: null,
        channel: null,
        date: TODAY,
      },
      options(memberships),
    )

  goldenTest(
    '#39a groceries with no wallet: Verizon Visa ranks apart, named after the ranking',
    () => {
      const r = groceries()
      expect(r.ranked.some((e) => GATED.has(e.cardId))).toBe(false)
      const verizon = r.membersOnly.find(
        (e) => e.cardId === 'verizon-visa-card',
      )
      expect(verizon?.effectiveReturnPct).toBe(4)
      expect(verizon?.needsMembership).toBe('verizon-account')
      const text = formatExploration(topOf(r, 10), catalog, true)
      expect(text).toContain(
        'If you have a Verizon wireless or Fios account: Verizon Visa Card, 4%.',
      )
      expect(text).toContain(
        'Assumes no memberships (like Amazon Prime). Cards and rates that need one are listed separately.',
      )
      expect(text.indexOf('If you have')).toBeGreaterThan(text.indexOf(' 1. '))
    },
  )

  goldenTest(
    '#39b a card that needs a membership is named only where it would have placed',
    () => {
      const top3 = topOf(groceries(), 3)
      expect(top3.membersOnly.map((e) => e.cardId)).toEqual([
        'verizon-visa-card',
      ])
      const top1 = topOf(groceries(), 1)
      expect(top1.membersOnly).toEqual([])
    },
  )

  goldenTest(
    '#39c with the membership given, Verizon Visa ranks normally and no line names it',
    () => {
      const r = groceries(['verizon-account'])
      const ids = r.ranked.map((e) => e.cardId)
      expect(ids.indexOf('verizon-visa-card')).toBe(2)
      expect(r.membersOnly.some((e) => e.cardId === 'verizon-visa-card')).toBe(
        false,
      )
      expect(formatExploration(topOf(r, 10), catalog, true)).not.toMatch(
        /If you have a Verizon/,
      )
    },
  )

  goldenTest(
    '#39d simulate_spending with no spending: no membership card in singles or pairs without the membership',
    () => {
      const sim = simulateCatalog(catalog, typicalSpendLines(catalog), {
        ...options(),
        start: TODAY,
      })
      const gated = (s: { cards: { cardId: string }[] }) =>
        s.cards.some((c) => GATED.has(c.cardId))
      expect(sim.singles.some(gated)).toBe(false)
      expect(sim.pairs.some(gated)).toBe(false)
      expect(sim.membersOnly.map((s) => s.cards[0]?.cardId)).toContain(
        'verizon-visa-card',
      )
      expect(formatCatalogSimulation(sim, catalog, false)).toMatch(
        /^If you have a Verizon wireless or Fios account: Verizon Visa Card, \$\d+ a year\.$/m,
      )
      const member = simulateCatalog(catalog, typicalSpendLines(catalog), {
        ...options(['verizon-account']),
        start: TODAY,
      })
      expect(member.singles[0]?.cards[0]?.cardId).toBe('verizon-visa-card')
    },
  )

  goldenTest(
    '#39e at Costco, buying there implies the membership: Costco Anywhere still ranks',
    () => {
      const r = exploreCards(
        catalog,
        {
          merchant: 'Costco',
          category: null,
          amount: null,
          channel: null,
          date: TODAY,
        },
        options(),
      )
      expect(r.ranked[0]?.cardId).toBe('citi-costco-anywhere-visa')
      expect(r.membersOnly.some((e) => e.needsMembership === 'costco')).toBe(
        false,
      )
      const sheet = catalogCheatSheet(catalog, TODAY, options())
      expect(sheet.rows.find((row) => row.label === 'Costco')?.cardId).toBe(
        'citi-costco-anywhere-visa',
      )
      const gas = sheet.rows.find((row) => row.label === 'Gas')
      expect(gas?.cardId).not.toBe('sams-club-mastercard')
      expect(sheet.membersOnly).toContain(
        "If you have a Sam's Club membership: Sam's Club Mastercard, 5% for gas.",
      )
      const withCostco = simulateCatalog(
        catalog,
        [
          ...typicalSpendLines(catalog),
          ...resolveSpendLines(catalog, [spendLineFor(catalog, 'Costco', 300)]),
        ],
        { ...options(), start: TODAY },
      )
      expect(
        withCostco.singles.some(
          (s) => s.cards[0]?.cardId === 'citi-costco-anywhere-visa',
        ),
      ).toBe(true)
    },
  )

  goldenTest('#39f a card the user names, or holds, ranks normally', () => {
    const named = recommend(
      catalog,
      withProfile(
        WalletSchema.parse({
          cards: [{ id: 'verizon-visa-card' }, { id: 'citi-double-cash' }],
        }),
        'flat',
      ),
      purchase('Safeway', { amount: 100, channel: 'in_store' }),
    )
    expect(named.decision?.cardId).toBe('verizon-visa-card')
    expect(named.decision?.effectiveReturnPct).toBe(4)
    const holder = WalletSchema.parse({
      cards: [{ id: 'verizon-visa-card' }],
    })
    const additions = simulateAdditions(
      catalog,
      holder,
      typicalSpendLines(catalog),
      { ...options(), start: TODAY },
    )
    expect(additions.membersOnly.map((a) => a.cardId)).not.toContain(
      'verizon-visa-card',
    )
    expect(additions.current.cards[0]?.cardId).toBe('verizon-visa-card')
  })

  goldenTest('#39g the next-card planner names a membership card apart', () => {
    const r = compareOffers(
      catalog,
      withProfile(WalletSchema.parse({}), 'flat'),
      { kind: 'any', business: false, noAnnualFee: false, includeHeld: false },
      TODAY,
    )
    expect(r.offers.some((o) => GATED.has(o.cardId))).toBe(false)
    expect(r.membersOnly.map((o) => o.cardId)).toContain('verizon-visa-card')
    const member = compareOffers(
      catalog,
      withProfile(
        WalletSchema.parse({ memberships: ['verizon-account'] }),
        'flat',
      ),
      { kind: 'any', business: false, noAnnualFee: false, includeHeld: false },
      TODAY,
    )
    expect(member.offers.map((o) => o.cardId)).toContain('verizon-visa-card')
  })
})
