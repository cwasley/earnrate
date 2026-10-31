import { describe, expect, test } from 'vitest'
import { loadCatalog, type Catalog } from '../src/data/load.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  idealHolding,
  type ExploreOptions,
  type ExploreQuery,
} from '../src/engine/explore.ts'
import { VALUATION_PROFILES } from '../src/engine/profiles.ts'
import {
  resolveSpendLines,
  simulateAdditions,
  simulateCatalog,
  simulateWallet,
  type SimulateOptions,
} from '../src/engine/simulate.ts'
import { CardSchema } from '../src/schema/card.ts'
import { WalletSchema } from '../src/schema/wallet.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()

const casual: ExploreOptions = {
  filters: ALL_PERSONAL_CARDS,
  memberships: [],
  valuations: {},
}

const query = (q: Partial<ExploreQuery>): ExploreQuery => ({
  merchant: null,
  category: null,
  amount: null,
  channel: null,
  date: TODAY,
  ...q,
})

const top = (q: Partial<ExploreQuery>, options = casual) =>
  exploreCards(catalog, query(q), options).ranked

const ids = (q: Partial<ExploreQuery>, options = casual) =>
  top(q, options).map((e) => e.cardId)

describe('best cards for a purchase', () => {
  test('supermarkets: Blue Cash Preferred at flat values, Gold when points are worth more', () => {
    const flat = top({ category: 'grocery.supermarket' })
    expect(flat[0]?.cardId).toBe('amex-blue-cash-preferred')
    expect(flat[0]?.effectiveReturnPct).toBe(6)
    expect(flat[0]?.conditions).toEqual([
      'Up to $6,000 a calendar year at this rate, then 1% cash back.',
    ])
    expect(flat[0]?.evidence?.url).toMatch(/americanexpress\.com/)

    const heavy = top(
      { category: 'grocery.supermarket' },
      { ...casual, valuations: VALUATION_PROFILES['points-heavy'] },
    )
    expect(heavy[0]?.cardId).toBe('amex-gold')
    expect(heavy[0]?.effectiveReturnPct).toBeCloseTo(6.8)
  })

  test("a rotating category counts once it's activated, and says so", () => {
    const flex = top({ category: 'grocery.supermarket' }).find(
      (e) => e.cardId === 'chase-freedom-flex',
    )
    expect(flex?.effectiveReturnPct).toBe(5)
    expect(flex?.conditions[0]).toBe(
      'Needs activating with the issuer ("q4-2026-grocery").',
    )
  })

  test('a choice card is ranked with the pick that covers the purchase', () => {
    const cashPlus = top({ category: 'dining.fast_food' }).find(
      (e) => e.cardId === 'usbank-cash-plus',
    )
    expect(cashPlus?.effectiveReturnPct).toBe(5)
    expect(cashPlus?.picks).toEqual({ 'five-percent': ['fast-food'] })
    expect(cashPlus?.conditions).toEqual([
      'Needs "fast-food" as its five-percent pick (picked each quarter).',
      'Up to $2,000 a quarter at this rate, then 1% cash back.',
    ])
  })

  test('membership rates are listed separately unless the person has it', () => {
    const [prime] = top({ merchant: 'amazon' })
    expect(prime?.cardId).toBe('chase-prime-visa')
    expect(prime?.effectiveReturnPct).toBe(3)
    expect(prime?.withMembership).toEqual([
      { membership: 'amazon-prime', effectiveReturnPct: 5 },
    ])

    const [member] = top(
      { merchant: 'amazon' },
      { ...casual, memberships: ['amazon-prime'] },
    )
    expect(member?.effectiveReturnPct).toBe(5)
    expect(member?.withMembership).toEqual([])
    expect(member?.conditions).toEqual(['Needs amazon-prime.'])
  })

  test('filters: no annual fee, issuer, closed cards and business cards', () => {
    const noFee = ids(
      { category: 'grocery.supermarket' },
      { ...casual, filters: { ...ALL_PERSONAL_CARDS, noAnnualFee: true } },
    )
    expect(noFee).not.toContain('amex-blue-cash-preferred')
    expect(noFee[0]).toBe('chase-freedom-flex')

    const chase = ids(
      { category: 'dining' },
      { ...casual, filters: { ...ALL_PERSONAL_CARDS, issuer: 'chase' } },
    )
    expect(
      chase.every(
        (id) => catalog.cards.find((c) => c.id === id)?.issuer === 'chase',
      ),
    ).toBe(true)

    expect(ids({ category: 'dining' })).not.toContain('citi-custom-cash')
    expect(
      ids(
        { category: 'dining' },
        { ...casual, filters: { ...ALL_PERSONAL_CARDS, includeClosed: true } },
      ),
    ).toContain('citi-custom-cash')

    const business = ids(
      { category: 'dining' },
      { ...casual, filters: { ...ALL_PERSONAL_CARDS, business: true } },
    )
    expect(business.length).toBeGreaterThan(0)
    expect(
      business.every((id) => catalog.cards.find((c) => c.id === id)?.business),
    ).toBe(true)
  })

  test("cards a merchant doesn't take are excluded, and store cards appear only at their store", () => {
    const costco = exploreCards(catalog, query({ merchant: 'costco' }), casual)
    expect(costco.ranked.every((e) => e.network === 'visa')).toBe(true)
    expect(costco.excluded.some((e) => e.network === 'amex')).toBe(true)
    expect(ids({ category: 'dining' })).not.toContain(
      'td-bank-target-circle-card',
    )
    expect(ids({ merchant: 'target' })).toContain('td-bank-target-circle-card')
  })

  test('says what it assumed about the merchant and the cards', () => {
    const r = exploreCards(catalog, query({ merchant: 'whole foods' }), casual)
    expect(r.assumptions[0]).toMatch(
      /^Assumes Whole Foods Market codes as supermarkets/,
    )
    expect(r.assumptions).toContain(
      'Assumes no memberships (like Amazon Prime). Rates that need one are listed separately.',
    )
    const unknown = exploreCards(
      catalog,
      query({ merchant: 'zzz unknown shop' }),
      casual,
    )
    expect(unknown.warnings[0]).toMatch(/^Couldn't identify "zzz unknown shop"/)
  })
})

const card = (id: string, extra: object) =>
  CardSchema.parse({
    id,
    name: `Test ${id}`,
    issuer: 'test',
    network: 'visa',
    currency: 'cash',
    last_verified: '2026-10-01',
    verified_by: 'test',
    source_urls: ['https://example.com/terms'],
    base_rate: 1,
    annual_fee: 0,
    ...extra,
  })

const testCatalog = (cards: ReturnType<typeof card>[]): Catalog => ({
  ...catalog,
  cards,
})

const options: SimulateOptions = {
  filters: ALL_PERSONAL_CARDS,
  memberships: [],
  valuations: {},
  start: TODAY,
}

describe('a year of spending', () => {
  test('a calendar-year cap resets in January (Blue Cash Preferred, $700 a month at supermarkets)', () => {
    const lines = resolveSpendLines(catalog, [
      { merchant: null, category: 'grocery.supermarket', monthly: 700 },
    ])
    const bcp = catalog.cards.find((c) => c.id === 'amex-blue-cash-preferred')
    if (!bcp) throw new Error('missing card')
    const sim = simulateWallet(
      catalog,
      WalletSchema.parse({ cards: [idealHolding(bcp, TODAY)] }),
      lines,
      TODAY,
    )
    // Oct–Dec 2026: $2,100 at 6%. 2027 through September: $6,000 at 6%, $300 at 1%.
    expect(sim.rewards).toBe(489)
    expect(sim.annualFees).toBe(95)
    expect(sim.net).toBe(394)
    expect(sim.notes).toContain(
      "American Express Blue Cash Preferred Card's fee is $0 the first year; the yearly figure uses the $95 that follows.",
    )
  })

  test("rotating quarters that aren't in the data count at base rates, with a note", () => {
    const lines = resolveSpendLines(catalog, [
      { merchant: null, category: 'grocery.supermarket', monthly: 700 },
    ])
    const flex = catalog.cards.find((c) => c.id === 'chase-freedom-flex')
    if (!flex) throw new Error('missing card')
    const sim = simulateWallet(
      catalog,
      WalletSchema.parse({ cards: [idealHolding(flex, TODAY)] }),
      lines,
      TODAY,
    )
    // Q4 2026 and Q1 2027: $1,500 at 5% and $600 at 1% each. Q2–Q3 2027: 1%.
    expect(sim.rewards).toBe(204)
    expect(sim.notes[0]).toMatch(
      /2027-Q2, 2027-Q3 aren't in earnrate's data yet/,
    )
  })

  test('spend moves to the next best card once a cap runs out', () => {
    const cat = testCatalog([
      card('capped-five', {
        rules: [
          {
            id: 'dining',
            match: { categories: ['dining'] },
            rate: 5,
            cap: { amount: 500, period: 'quarter', then_rate: 1 },
          },
        ],
      }),
      card('flat-two', { base_rate: 2 }),
    ])
    const lines = resolveSpendLines(cat, [
      { merchant: null, category: 'dining', monthly: 300 },
    ])
    const sim = simulateWallet(
      cat,
      WalletSchema.parse({
        cards: [{ id: 'capped-five' }, { id: 'flat-two' }],
      }),
      lines,
      '2026-01-10',
    )
    // Each quarter: $500 at 5%, then $400 at 2%.
    expect(sim.rewards).toBe(4 * (25 + 8))
    expect(sim.lines[0]?.cards).toEqual(['capped-five', 'flat-two'])
  })

  test('picks are chosen for the spending, up to the number allowed', () => {
    const cat = testCatalog([
      card('picker', {
        choices: [
          {
            id: 'bonus',
            pick: 1,
            period: 'quarter',
            options: { dining: ['dining'], gas: ['gas'], phone: ['phone'] },
          },
        ],
        rules: [{ id: 'bonus', match: { choice: 'bonus' }, rate: 4 }],
      }),
    ])
    const lines = resolveSpendLines(cat, [
      { merchant: null, category: 'dining', monthly: 100 },
      { merchant: null, category: 'gas', monthly: 300 },
    ])
    const { singles } = simulateCatalog(cat, lines, options)
    expect(singles[0]?.cards[0]?.picks).toEqual({ bonus: ['gas'] })
    expect(singles[0]?.rewards).toBe(12 * (300 * 0.04 + 100 * 0.01))
  })

  test('annual fees come off, and the best pair splits the spending', () => {
    const cat = testCatalog([
      card('dining-fee', {
        annual_fee: 50,
        rules: [{ id: 'dining', match: { categories: ['dining'] }, rate: 4 }],
      }),
      card('gas-free', {
        rules: [{ id: 'gas', match: { categories: ['gas'] }, rate: 3 }],
      }),
      card('flat', { base_rate: 1.5 }),
    ])
    const lines = resolveSpendLines(cat, [
      { merchant: null, category: 'dining', monthly: 200 },
      { merchant: null, category: 'gas', monthly: 100 },
    ])
    const { singles, pairs } = simulateCatalog(cat, lines, options)
    expect(singles.map((s) => [s.cards[0]?.cardId, s.net])).toEqual([
      ['gas-free', 24 + 36],
      ['dining-fee', 96 + 12 - 50],
      ['flat', 54],
    ])
    expect(pairs[0]?.cards.map((c) => c.cardId).sort()).toEqual([
      'dining-fee',
      'gas-free',
    ])
    expect(pairs[0]?.net).toBe(96 + 36 - 50)
  })

  test('pairs that differ only by an interchangeable card fold into one', () => {
    const cat = testCatalog([
      card('dining-five', {
        rules: [{ id: 'dining', match: { categories: ['dining'] }, rate: 5 }],
      }),
      card('flat-a', { base_rate: 2 }),
      card('flat-b', { base_rate: 2 }),
    ])
    const lines = resolveSpendLines(cat, [
      { merchant: null, category: 'dining', monthly: 100 },
      { merchant: null, category: 'other', monthly: 100 },
    ])
    const { pairs } = simulateCatalog(cat, lines, options)
    expect(pairs).toHaveLength(2)
    expect(pairs[0]?.cards.map((c) => c.cardId)).toEqual([
      'dining-five',
      'flat-a',
    ])
    expect(pairs[0]?.alternatives).toEqual(['flat-b'])
    expect(pairs[0]?.net).toBe(12 * (5 + 2))
  })

  test('what adding a card to a wallet would gain, after its fee', () => {
    const cat = testCatalog([
      card('held-flat', { base_rate: 1.5 }),
      card('dining-fee', {
        annual_fee: 50,
        rules: [{ id: 'dining', match: { categories: ['dining'] }, rate: 4 }],
      }),
      card('gas-free', {
        rules: [{ id: 'gas', match: { categories: ['gas'] }, rate: 3 }],
      }),
    ])
    const lines = resolveSpendLines(cat, [
      { merchant: null, category: 'dining', monthly: 200 },
      { merchant: null, category: 'gas', monthly: 100 },
    ])
    const wallet = WalletSchema.parse({ cards: [{ id: 'held-flat' }] })
    const r = simulateAdditions(cat, wallet, lines, options)
    expect(r.current.rewards).toBe(54)
    expect(r.additions.map((a) => [a.cardId, a.extraRewards, a.gain])).toEqual([
      ['gas-free', 18, 18],
      ['dining-fee', 60, 10],
    ])
  })
})
