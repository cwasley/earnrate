import { describe, expect, test } from 'vitest'
import { loadCatalog, type Catalog } from '../../src/data/load.ts'
import { recommend } from '../../src/engine/recommend.ts'
import { recordPurchase } from '../../src/engine/record.ts'
import type {
  Purchase,
  RankedCard,
  Recommendation,
} from '../../src/engine/types.ts'
import { CardSchema } from '../../src/schema/card.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
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

      const after = recordPurchase(catalog, wallet, {
        cardId: 'amex-blue-cash-preferred',
        merchant: 'Whole Foods',
        amount: 6000,
        date: TODAY,
        channel: 'in_store',
      })
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
      const after = recordPurchase(catalog, wallet, {
        cardId: 'usbank-cash-plus',
        merchant: 'AMC',
        amount: 1950,
        date: TODAY,
        channel: 'in_store',
      })
      const rec = recommend(
        catalog,
        after,
        purchase('Comcast', { amount: 100, channel: 'online' }),
      )
      expect(entry(rec, 'usbank-cash-plus').effectiveReturnPct).toBeCloseTo(3)
    },
  )
})

describe('#17 every card has a known network', () => {
  test('a card file without a network is rejected', () => {
    const card = catalog.cards.find((c) => c.id === 'sofi-unlimited-2')
    const { network: _network, ...withoutNetwork } = card ?? {}
    expect(CardSchema.safeParse(withoutNetwork).success).toBe(false)
  })
})
