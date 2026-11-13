import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { periodEnd, periodKey } from '../src/engine/periods.ts'
import { recommend } from '../src/engine/recommend.ts'
import type { RankedCard, Recommendation } from '../src/engine/types.ts'
import {
  normalizeMerchantName,
  resolveMerchant,
  resolvePlace,
} from '../src/merchants/resolve.ts'
import { CardSchema } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { WalletSchema, type Wallet } from '../src/schema/wallet.ts'
import { purchase } from './golden/fixtures.ts'

const realCatalog = await loadCatalog()

const testCard = CardSchema.parse({
  id: 'test-discover',
  name: 'Test Discover Card',
  issuer: 'test',
  network: 'discover',
  currency: 'cash',
  last_verified: '2026-10-01',
  verified_by: 'test',
  source_urls: ['https://example.com/terms'],
  base_rate: 3,
  foreign_transaction_fee: 0,
  rules: [
    {
      id: 'activate-me',
      match: { categories: ['dining'] },
      rate: 5,
      requires: { activation: true },
    },
    {
      id: 'holiday',
      match: { categories: ['department_store'] },
      rate: 6,
      valid_from: '2026-11-01',
      valid_to: '2026-12-31',
    },
    {
      id: 'us-gas',
      match: { categories: ['gas'] },
      rate: 4,
      geography: 'us_only',
    },
    {
      id: 'online-electronics',
      match: { categories: ['electronics'] },
      rate: 4,
      channel: 'online',
    },
    {
      id: 'travel',
      match: { categories: ['travel'] },
      rate: 5,
      cap: { amount: 1000, period: 'cardmember_year', then_rate: 1 },
    },
  ],
})

const catalog: Catalog = {
  ...realCatalog,
  cards: [...realCatalog.cards, testCard],
}

function wallet(card: Record<string, unknown> = {}): Wallet {
  return WalletSchema.parse({
    cards: [{ id: 'test-discover', ...card }, { id: 'sofi-unlimited-2' }],
  })
}

function testEntry(rec: Recommendation): RankedCard {
  const found = rec.ranked.find((r) => r.cardId === 'test-discover')
  if (!found) throw new Error('test card missing')
  return found
}

describe('merchant lookup', () => {
  test('normalizes case, punctuation, protocol and paths', () => {
    expect(normalizeMerchantName('https://www.Delta.com/flights/123')).toBe(
      'delta.com',
    )
    expect(normalizeMerchantName("Trader Joe's")).toBe('trader joes')
  })

  test('matches a longer input that starts with a known name', () => {
    const r = resolveMerchant(
      catalog,
      'Whole Foods Market #10234 Santa Monica',
      null,
    )
    expect(r.merchantId).toBe('whole-foods')
    expect(r.source).toBe('override')
  })

  test('regional supermarkets resolve by any common name', () => {
    for (const name of [
      'Stater Bros',
      'stater brothers',
      'Stater Bros. Markets #164',
    ]) {
      expect(resolveMerchant(catalog, name, null)).toMatchObject({
        merchantId: 'stater-bros',
        category: 'grocery.supermarket',
      })
    }
  })

  test('falls back to the seed table, then to unknown', () => {
    expect(resolveMerchant(catalog, 'sweetgreen', null).source).toBe('seed')
    const unknown = resolveMerchant(catalog, 'Tiny Bookshop', null)
    expect(unknown.source).toBe('none')
    expect(unknown.category).toBe('other')
    expect(unknown.accepts).toBeNull()
  })

  test('applies channel-specific acceptance', () => {
    expect(resolveMerchant(catalog, 'Costco', 'in_store').accepts).toEqual([
      'visa',
    ])
    expect(resolveMerchant(catalog, 'Costco', 'online').accepts).toEqual([
      'visa',
      'mastercard',
    ])
  })

  test('a web address with no channel is taken as online', () => {
    const r = resolveMerchant(catalog, 'Costco.com', null)
    expect(r.channel).toBe('online')
    expect(r.accepts).toEqual(['visa', 'mastercard'])
    expect(resolveMerchant(catalog, 'Costco', null).channel).toBe('in_store')
  })

  test('says so when it assumes online from a web address', () => {
    const rec = recommend(catalog, wallet(), purchase('costco.com'))
    expect(rec.assumptions.join(' ')).toMatch(/online purchase/)
    expect(rec.excluded.map((e) => e.network)).toEqual(['discover'])
  })
})

describe('periods', () => {
  test('months stand in for billing cycles', () => {
    expect(periodKey('month', '2026-10-24', null)).toBe('2026-10')
  })

  test('quarters and calendar years', () => {
    expect(periodKey('quarter', '2026-10-24', null)).toBe('2026-Q4')
    expect(periodKey('quarter', '2026-03-31', null)).toBe('2026-Q1')
    expect(periodKey('calendar_year', '2026-10-24', null)).toBe('2026')
  })

  test('a cardmember year is keyed by the year it started', () => {
    expect(periodKey('cardmember_year', '2026-10-24', '03-15')).toBe('2026')
    expect(periodKey('cardmember_year', '2026-02-01', '03-15')).toBe('2025')
    expect(periodKey('cardmember_year', '2026-02-01', null)).toBeNull()
  })

  test('months, quarters and calendar years end where they always did', () => {
    expect(periodEnd('month', '2026-02', null)).toBe('2026-02-28')
    expect(periodEnd('month', '2028-02', null)).toBe('2028-02-29')
    expect(periodEnd('month', '2026-12', null)).toBe('2026-12-31')
    expect(periodEnd('quarter', '2026-Q1', null)).toBe('2026-03-31')
    expect(periodEnd('quarter', '2026-Q4', null)).toBe('2026-12-31')
    expect(periodEnd('calendar_year', '2026', '03-15')).toBe('2026-12-31')
  })

  test('a cardmember year ends the day before the next anniversary', () => {
    expect(periodEnd('cardmember_year', '2026', '03-15')).toBe('2027-03-14')
    expect(periodEnd('cardmember_year', '2026', '01-01')).toBe('2026-12-31')
    expect(periodEnd('cardmember_year', '2027', '03-01')).toBe('2028-02-29')
    expect(periodEnd('cardmember_year', '2026', '02-29')).toBe('2027-02-28')
    expect(periodEnd('cardmember_year', '2026', null)).toBeNull()
  })

  test("a key that doesn't fit the period has no end", () => {
    expect(periodEnd('quarter', '2026', null)).toBeNull()
    expect(periodEnd('calendar_year', '2026-Q4', null)).toBeNull()
  })
})

describe('rule conditions', () => {
  test('an offer needing activation is skipped, with a nudge', () => {
    const rec = recommend(catalog, wallet(), purchase('Chipotle'))
    expect(testEntry(rec).rate).toBe(3)
    expect(testEntry(rec).warnings.join(' ')).toMatch(
      /Activate this bonus with the issuer/,
    )

    const activated = recommend(
      catalog,
      wallet({ activated: ['activate-me'] }),
      purchase('Chipotle'),
    )
    expect(testEntry(activated).rate).toBe(5)
  })

  test('a rule only applies inside its date window', () => {
    expect(
      testEntry(recommend(catalog, wallet(), purchase("Macy's"))).rate,
    ).toBe(3)
    expect(
      testEntry(
        recommend(
          catalog,
          wallet(),
          purchase("Macy's", { date: '2026-11-15' }),
        ),
      ).rate,
    ).toBe(6)
  })

  test('a U.S.-only rule does not apply abroad', () => {
    expect(
      testEntry(recommend(catalog, wallet(), purchase('Shell'))).rate,
    ).toBe(4)
    expect(
      testEntry(
        recommend(catalog, wallet(), purchase('Shell', { country: 'FR' })),
      ).rate,
    ).toBe(3)
  })

  test('an unknown foreign transaction fee counts as 3% abroad, with a warning', () => {
    const unknown: Catalog = {
      ...realCatalog,
      cards: [
        ...realCatalog.cards,
        { ...testCard, foreign_transaction_fee: null },
      ],
    }
    const rec = recommend(
      unknown,
      wallet(),
      purchase('Shell', { country: 'FR' }),
    )
    expect(rec.notes.join(' ')).toMatch(
      /has no foreign transaction fee on file, so the usual 3% is subtracted/,
    )
    expect(rec.notes.join(' ')).not.toMatch(
      /charges? foreign transaction fees?/,
    )
    const abroad = testEntry(rec)
    expect(abroad.effectiveReturnPct).toBeCloseTo(0)
    expect(abroad.foreignFee).toBe(3)
    expect(abroad.warnings[0]).toMatch(
      /foreign transaction fee isn't on file, so earnrate assumes the usual 3% and it nets 0%/,
    )
    expect(abroad.warnings.join(' ')).not.toMatch(/Charges a/)
    const home = testEntry(recommend(unknown, wallet(), purchase('Shell')))
    expect(home.warnings.join(' ')).not.toMatch(/foreign transaction fee/)
  })

  test('an online-only rule needs an online purchase', () => {
    expect(
      testEntry(
        recommend(
          catalog,
          wallet(),
          purchase('Best Buy', { channel: 'online' }),
        ),
      ).rate,
    ).toBe(4)
    expect(
      testEntry(
        recommend(
          catalog,
          wallet(),
          purchase('Best Buy', { channel: 'in_store' }),
        ),
      ).rate,
    ).toBe(3)
  })
})

describe('cardmember-year caps', () => {
  test('without an anniversary, usage is ignored and the wallet is asked for one', () => {
    const rec = recommend(catalog, wallet(), purchase('Marriott'))
    expect(testEntry(rec).rate).toBe(5)
    expect(testEntry(rec).warnings.join(' ')).toMatch(/anniversary/)
  })

  test('usage in the current cardmember year counts, last year does not', () => {
    const used = (period: string) =>
      wallet({
        anniversary: '03-15',
        cap_usage: { travel: { period, spent: 1000 } },
      })
    const usedUp = testEntry(
      recommend(catalog, used('2026'), purchase('Marriott')),
    )
    expect(usedUp.matchedRule).toBeNull()
    expect(usedUp.rate).toBe(3)
    expect(usedUp.warnings.join(' ')).toMatch(/used up for 2026/)
    expect(
      testEntry(recommend(catalog, used('2025'), purchase('Marriott'))).rate,
    ).toBe(5)
  })
})

describe('acceptance', () => {
  test('warns when a Discover card wins at an unrecognized merchant', () => {
    const rec = recommend(catalog, wallet(), purchase('Tiny Bookshop'))
    expect(rec.decision?.cardId).toBe('test-discover')
    expect(rec.warnings.join(' ')).toMatch(
      /Not every business takes Discover.*SoFi/,
    )
  })

  test('assumes a known merchant takes every network', () => {
    const rec = recommend(catalog, wallet(), purchase('Etsy'))
    expect(rec.decision?.cardId).toBe('test-discover')
    expect(rec.warnings.join(' ')).not.toMatch(/Not every business/)
  })

  test('reports when no card in the wallet works', () => {
    const discoverOnly = WalletSchema.parse({
      cards: [{ id: 'test-discover' }],
    })
    const rec = recommend(catalog, discoverOnly, purchase('Costco'))
    expect(rec.decision).toBeNull()
    expect(rec.excluded[0]?.reason).toMatch(/takes only Visa in-store/)
  })
})

function syntheticCard(id: string, rules: unknown[], extra: object = {}) {
  return CardSchema.parse({
    id,
    name: `Test ${id}`,
    issuer: 'test',
    network: 'visa',
    currency: 'cash',
    last_verified: '2026-10-01',
    verified_by: 'test',
    source_urls: ['https://example.com/terms'],
    base_rate: 1,
    foreign_transaction_fee: 0,
    rules,
    ...extra,
  })
}

function only(...cards: ReturnType<typeof syntheticCard>[]) {
  return {
    catalog: { ...realCatalog, cards: [...realCatalog.cards, ...cards] },
    wallet: WalletSchema.parse({ cards: cards.map((c) => ({ id: c.id })) }),
  }
}

describe('hotel and other brands', () => {
  const hiltonBusiness = WalletSchema.parse({
    cards: [{ id: 'amex-hilton-honors-business' }],
  })

  test('a brand earns what its parent earns', () => {
    for (const brand of ['Hampton Inn', 'Hilton', 'DoubleTree by Hilton']) {
      const rec = recommend(realCatalog, hiltonBusiness, purchase(brand))
      expect(rec.ranked[0]?.matchedRule, brand).toBe('hilton-purchases')
    }
  })

  test('a rule that leaves out the parent leaves out its brands', () => {
    const rec = recommend(realCatalog, hiltonBusiness, purchase('Hyatt Place'))
    expect(rec.ranked[0]?.matchedRule).toBe('everyday-purchases')
  })
})

describe('store cards', () => {
  const storeCard = (onlyAt: string[]) =>
    syntheticCard('test-store', [], {
      network: 'store',
      only_at: onlyAt,
      base_rate: 5,
    })
  const withSofi = (card: ReturnType<typeof syntheticCard>) => ({
    catalog: { ...realCatalog, cards: [...realCatalog.cards, card] },
    wallet: WalletSchema.parse({
      cards: [{ id: card.id }, { id: 'sofi-unlimited-2' }],
    }),
  })

  test('wins at its own store', () => {
    const { catalog, wallet } = withSofi(storeCard(['target']))
    expect(
      recommend(catalog, wallet, purchase('Target')).decision?.cardId,
    ).toBe('test-store')
  })

  test('is left out quietly everywhere else', () => {
    const { catalog, wallet } = withSofi(storeCard(['target']))
    for (const merchant of ['Whole Foods', 'Tiny Bookshop']) {
      const rec = recommend(catalog, wallet, purchase(merchant))
      expect(rec.ranked.map((r) => r.cardId)).toEqual(['sofi-unlimited-2'])
      expect(rec.excluded).toEqual([])
    }
  })

  test('works at its store even when the store limits networks', () => {
    const { catalog, wallet } = withSofi(storeCard(['costco']))
    const rec = recommend(catalog, wallet, purchase('Costco'))
    expect(rec.decision?.cardId).toBe('test-store')
  })

  test('needs only_at, and only a store card can have it', () => {
    expect(() => syntheticCard('no-scope', [], { network: 'store' })).toThrow(
      /only_at/,
    )
    expect(() =>
      syntheticCard('scoped-visa', [], { only_at: ['target'] }),
    ).toThrow(/only_at/)
  })
})

describe('wallet valuations', () => {
  const gold = (valuation: unknown) =>
    WalletSchema.parse({
      valuations: { MR: valuation },
      cards: [{ id: 'amex-gold' }, { id: 'amex-blue-cash-preferred' }],
    })

  test('a value override changes what points are worth', () => {
    const rec = recommend(
      realCatalog,
      gold({ value: 1.6 }),
      purchase('Whole Foods'),
    )
    expect(rec.decision).toMatchObject({ cardId: 'amex-gold' })
    expect(rec.decision?.effectiveReturnPct).toBeCloseTo(6.4)
  })

  test('a narrower range removes a flip point outside it', () => {
    const wide = recommend(realCatalog, gold(1.0), purchase('Whole Foods'))
    expect(wide.sensitivity).toMatch(/more than 1\.5¢/)
    const narrow = recommend(
      realCatalog,
      gold({ range: [1.0, 1.2] }),
      purchase('Whole Foods'),
    )
    expect(narrow.sensitivity).toBeNull()
  })
})

describe('more warnings', () => {
  test('warns when a cap is nearly used up', () => {
    const wallet = WalletSchema.parse({
      cards: [
        {
          id: 'amex-blue-cash-preferred',
          cap_usage: { 'us-supermarkets': { period: '2026', spent: 5000 } },
        },
      ],
    })
    const rec = recommend(realCatalog, wallet, purchase('Whole Foods'))
    expect(rec.ranked[0]?.warnings.join(' ')).toMatch(
      /Only \$1,000 left of the \$6,000 calendar-year cap/,
    )
  })

  test('an unverified rule is flagged and lowers confidence when it wins', () => {
    const { catalog: c, wallet: w } = only(
      syntheticCard('test-unverified', [
        {
          id: 'guess',
          match: { categories: ['dining'] },
          rate: 4,
          unverified: 'Not on the issuer page yet.',
        },
      ]),
    )
    const rec = recommend(c, w, purchase('Chipotle'))
    expect(rec.decision).toMatchObject({
      cardId: 'test-unverified',
      confidence: 'medium',
    })
    expect(rec.ranked[0]?.warnings.join(' ')).toMatch(/isn't confirmed/)
  })
})

describe('tie-breaks', () => {
  const dining = (cap?: object) => [
    {
      id: 'dining',
      match: { categories: ['dining'] },
      rate: 3,
      ...(cap ? { cap } : {}),
    },
  ]

  test('an uncapped rate beats a capped one at the same return', () => {
    const { catalog: c, wallet: w } = only(
      syntheticCard(
        'test-capped',
        dining({ amount: 1000, period: 'quarter', then_rate: 1 }),
      ),
      syntheticCard('test-uncapped', dining()),
    )
    const rec = recommend(c, w, purchase('Chipotle'))
    expect(rec.decision?.cardId).toBe('test-uncapped')
    expect(rec.notes.join(' ')).toMatch(/because its rate has no cap/)
  })

  test('within a card, an uncapped rule beats a capped one at the same rate, whatever the order', () => {
    const { catalog: c, wallet: w } = only(
      syntheticCard('test-order', [
        {
          id: 'capped',
          match: { categories: ['dining'] },
          rate: 3,
          cap: { amount: 100, period: 'quarter', then_rate: 1 },
        },
        { id: 'open', match: { merchants: ['chipotle'] }, rate: 3 },
      ]),
    )
    expect(recommend(c, w, purchase('Chipotle')).ranked[0]?.matchedRule).toBe(
      'open',
    )
  })

  test('otherwise the order is fixed and says either works', () => {
    const { catalog: c, wallet: w } = only(
      syntheticCard('test-b', dining()),
      syntheticCard('test-a', dining()),
    )
    const rec = recommend(c, w, purchase('Chipotle'))
    expect(rec.decision?.cardId).toBe('test-a')
    expect(rec.notes.join(' ')).toMatch(/by a fixed order; either works/)
  })
})

describe('MCC and merchant conditions', () => {
  const rate = (rules: unknown[]) => {
    const { catalog: c, wallet: w } = only(syntheticCard('test-mcc', rules))
    return recommend(c, w, purchase('Whole Foods')).ranked[0]?.rate
  }

  test('a rule can match on the merchant category code', () => {
    expect(rate([{ id: 'r', match: { mccs: [5411] }, rate: 5 }])).toBe(5)
    expect(rate([{ id: 'r', match: { mccs: [5812] }, rate: 5 }])).toBe(1)
  })

  test('a rule can exclude by MCC or by merchant', () => {
    const grocery = { categories: ['grocery'] }
    expect(rate([{ id: 'r', match: grocery, rate: 4 }])).toBe(4)
    expect(
      rate([{ id: 'r', match: grocery, exclude: { mccs: [5411] }, rate: 4 }]),
    ).toBe(1)
    expect(
      rate([
        {
          id: 'r',
          match: grocery,
          exclude: { merchants: ['whole-foods'] },
          rate: 4,
        },
      ]),
    ).toBe(1)
  })
})

describe('Chase promos and vacation homes', () => {
  const chase = WalletSchema.parse({
    cards: [
      { id: 'chase-sapphire-preferred' },
      { id: 'chase-freedom-unlimited' },
      { id: 'amex-gold' },
    ],
  })
  const top = (merchant: string, date?: string) =>
    recommend(
      realCatalog,
      chase,
      purchase(merchant, date === undefined ? {} : { date }),
    ).ranked.map((r) => [r.cardId, r.rate] as const)

  test('Lyft earns the promo rates until they end', () => {
    expect(top('Lyft').slice(0, 2)).toEqual([
      ['chase-sapphire-preferred', 5],
      ['chase-freedom-unlimited', 2],
    ])
    expect(top('Lyft', '2027-10-01')[0]).toEqual([
      'chase-sapphire-preferred',
      2,
    ])
  })

  test('direct vacation-home bookings earn 3x on Sapphire Preferred', () => {
    for (const merchant of ['Airbnb', 'vrbo.com', 'HomeAway', 'Vacasa']) {
      expect(top(merchant)[0]).toEqual(['chase-sapphire-preferred', 3])
    }
  })
})

describe('gas sold at stores', () => {
  const base = () =>
    WalletSchema.parse({
      memberships: ['amazon-prime'],
      cards: [
        { id: 'amex-blue-cash-preferred' },
        { id: 'chase-sapphire-preferred' },
        {
          id: 'usbank-cash-plus',
          chosen: {
            period: '2026-Q4',
            picks: {
              'five-percent': ['select-clothing-stores', 'movie-theaters'],
              'two-percent': ['gas-ev-charging'],
            },
          },
        },
      ],
    })
  const rate = (rec: Recommendation, cardId: string) =>
    rec.ranked.find((r) => r.cardId === cardId)?.rate

  test('"kroger gas" is a grocery-store gas station, not Kroger', () => {
    const m = resolveMerchant(catalog, 'Kroger gas', null)
    expect(m).toMatchObject({
      resolvedName: 'Kroger gas',
      category: 'gas.grocery_store',
      confidence: 'medium',
    })
    const rec = recommend(realCatalog, base(), purchase('kroger gas'))
    expect(rate(rec, 'amex-blue-cash-preferred')).toBe(1)
    expect(rate(rec, 'usbank-cash-plus')).toBe(2)
    expect(rec.decision?.cardId).toBe('chase-sapphire-preferred')
    expect(rec.warnings.join(' ')).toMatch(
      /If it counts as a supermarket, Amex Blue Cash Preferred wins \(6%\)/,
    )
  })

  test('superstore and club gas loses the BCP and Cash+ gas bonuses', () => {
    const walmart = recommend(realCatalog, base(), purchase('walmart fuel'))
    expect(walmart.merchant.category).toBe('gas.superstore')
    expect(rate(walmart, 'amex-blue-cash-preferred')).toBe(1)
    expect(rate(walmart, 'usbank-cash-plus')).toBe(1)

    const costco = recommend(realCatalog, base(), purchase('costco gas'))
    expect(costco.merchant.category).toBe('gas.superstore')
    expect(rate(costco, 'usbank-cash-plus')).toBe(1)
    expect(costco.excluded.map((e) => e.cardId)).toContain(
      'amex-blue-cash-preferred',
    )
  })

  test('Cash+ select clothing covers only the stores U.S. Bank lists', () => {
    expect(
      rate(
        recommend(realCatalog, base(), purchase('J.Crew')),
        'usbank-cash-plus',
      ),
    ).toBe(5)
    expect(
      rate(
        recommend(realCatalog, base(), purchase('Uniqlo')),
        'usbank-cash-plus',
      ),
    ).toBe(1)
  })
})

describe('Amex Travel and Airbnb', () => {
  const amex = WalletSchema.parse({
    cards: [
      { id: 'amex-gold' },
      { id: 'amex-platinum' },
      { id: 'chase-sapphire-preferred' },
    ],
  })
  const rates = (merchant: string) =>
    Object.fromEntries(
      recommend(realCatalog, amex, purchase(merchant)).ranked.map((r) => [
        r.cardId,
        r.rate,
      ]),
    )

  test('each Amex Travel booking type earns its own rate', () => {
    expect(rates('amex travel hotel')).toMatchObject({
      'amex-gold': 5,
      'amex-platinum': 5,
    })
    expect(rates('amex travel flight')).toMatchObject({
      'amex-gold': 3,
      'amex-platinum': 5,
    })
    expect(rates('airbnb via amex travel')).toMatchObject({
      'amex-gold': 2,
      'amex-platinum': 5,
    })
    expect(rates('amex travel car rental')).toMatchObject({
      'amex-gold': 2,
      'amex-platinum': 2,
    })
    expect(rates('amex travel cruise')).toMatchObject({
      'amex-gold': 2,
      'amex-platinum': 2,
    })
  })

  test('a direct Airbnb booking says what booking through Amex Travel would earn', () => {
    const rec = recommend(realCatalog, amex, purchase('Airbnb'))
    expect(rec.decision?.cardId).toBe('chase-sapphire-preferred')
    expect(rec.notes.join(' ')).toMatch(
      /If you book it as Airbnb through Amex Travel, .*Platinum.* earns 5%/,
    )
  })

  test('plain "Amex Travel" lists the booking types that would earn more', () => {
    const notes = recommend(realCatalog, amex, purchase('amex travel')).notes
    expect(notes.join(' ')).toMatch(/Hotel through Amex Travel/)
    expect(notes.join(' ')).toMatch(/Airbnb through Amex Travel/)
  })

  test('Gold earns nothing extra at restaurants inside venues', () => {
    const atStadium = recommend(realCatalog, amex, purchase('Dodger Stadium'), {
      ...resolveMerchant(realCatalog, 'Dodger Stadium', null),
      category: 'dining',
    })
    expect(atStadium.ranked.find((r) => r.cardId === 'amex-gold')?.rate).toBe(1)
  })
})

describe('ways of paying that change the answer', () => {
  const held = WalletSchema.parse({
    cards: [{ id: 'paypal-cashback-mastercard' }, { id: 'citi-double-cash' }],
  })

  test('are listed while payment is unknown, the same ones the assumptions name', () => {
    const rec = recommend(realCatalog, held, purchase('etsy.com'))
    expect(rec.ifPaying).toEqual([
      {
        cardId: 'paypal-cashback-mastercard',
        cardName: 'PayPal Cashback Mastercard',
        payment: 'paypal',
        earn: '3% cash back',
      },
    ])
    expect(rec.assumptions.join(' ')).toContain(
      'Through PayPal checkout, PayPal Cashback Mastercard would earn 3% cash back',
    )
  })

  test('are empty once the payment is given, and for a note-only answer', () => {
    const told = recommend(
      realCatalog,
      held,
      purchase('etsy.com', { payment: 'paypal' }),
    )
    expect(told.ifPaying).toEqual([])
    const rent = recommend(
      realCatalog,
      held,
      purchase('rent'),
      resolvePlace(realCatalog, 'rent', null),
    )
    expect(rent.categoryNote).not.toBeNull()
    expect(rent.ifPaying).toEqual([])
  })
})

test('half years run January to June and July to December', () => {
  expect(periodKey('half_year', '2026-06-30', null)).toBe('2026-H1')
  expect(periodKey('half_year', '2026-07-01', null)).toBe('2026-H2')
  expect(periodEnd('half_year', '2026-H1', null)).toBe('2026-06-30')
  expect(periodEnd('half_year', '2026-H2', null)).toBe('2026-12-31')
})

describe('stores an issuer names', () => {
  const wallet = (...ids: string[]) =>
    WalletSchema.parse({ cards: ids.map((id) => ({ id })) })

  test("the answer says the issuer names the store as what it's assumed to count as", () => {
    const rec = recommend(
      realCatalog,
      wallet('amex-gold', 'citi-double-cash'),
      purchase('vons'),
    )
    expect(rec.assumptions).toContain(
      'Assumes Vons counts as a supermarket; for Amex Gold, American Express names it as one.',
    )
    const other = recommend(
      realCatalog,
      wallet('citi-double-cash'),
      purchase('vons'),
    )
    expect(other.assumptions).toContain('Assumes Vons counts as a supermarket.')
  })

  test('a store that may code another way is settled for a card whose issuer names it', () => {
    const named = recommend(
      realCatalog,
      wallet('amex-blue-cash-preferred'),
      purchase('meijer'),
    )
    expect(named.decision).toMatchObject({
      cardId: 'amex-blue-cash-preferred',
      confidence: 'high',
    })
    const unnamed = recommend(
      realCatalog,
      wallet('citi-double-cash'),
      purchase('meijer'),
    )
    expect(unnamed.decision?.confidence).toBe('medium')
  })
})
