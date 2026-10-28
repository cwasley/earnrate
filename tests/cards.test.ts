import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { capBooking } from '../src/engine/record.ts'
import { recommend } from '../src/engine/recommend.ts'
import { WalletSchema, type Wallet } from '../src/schema/wallet.ts'
import { purchase, TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()

const NEW_CARDS = [
  'chase-sapphire-reserve',
  'chase-freedom-flex',
  'chase-ink-business-cash',
  'chase-ink-business-preferred',
  'citi-strata-elite',
  'citi-strata-premier',
  'citi-double-cash',
  'citi-custom-cash',
  'capital-one-venture-x',
  'capital-one-venture',
  'capital-one-savor',
  'bilt-obsidian',
  'wells-fargo-active-cash',
  'wells-fargo-autograph',
  'amex-blue-cash-everyday',
  'amex-blue-business-plus',
]

function wallet(extra: Record<string, object> = {}): Wallet {
  return WalletSchema.parse({
    cards: NEW_CARDS.map((id) => ({ id, ...extra[id] })),
  })
}

function rates(
  merchant: string,
  w = wallet(),
  channel?: 'online' | 'in_store',
) {
  const rec = recommend(
    catalog,
    w,
    purchase(merchant, channel ? { channel } : {}),
  )
  return Object.fromEntries(rec.ranked.map((r) => [r.cardId, r.rate]))
}

describe('the 16 popular cards', () => {
  test('all of them are in the catalog', () => {
    const ids = new Set(catalog.cards.map((c) => c.id))
    expect(NEW_CARDS.filter((id) => !ids.has(id))).toEqual([])
  })

  test('Sapphire Reserve: 8x Chase Travel, 4x direct flights, 3x dining', () => {
    expect(rates('chase travel')['chase-sapphire-reserve']).toBe(8)
    expect(rates('delta.com')['chase-sapphire-reserve']).toBe(4)
    expect(rates('Chipotle')['chase-sapphire-reserve']).toBe(3)
    expect(rates('Lyft')['chase-sapphire-reserve']).toBe(5)
  })

  test("another bank's travel site counts as a travel agency, not a direct booking", () => {
    expect(rates('amex travel hotel')['chase-sapphire-reserve']).toBe(1)
    expect(rates('amex travel hotel')['citi-strata-premier']).toBe(3)
  })

  test('Freedom Flex: Q4 2026 grocery at 5% once activated', () => {
    expect(rates('Kroger')['chase-freedom-flex']).toBe(1)
    const activated = wallet({
      'chase-freedom-flex': { activated: ['q4-2026-grocery'] },
    })
    expect(rates('Kroger', activated)['chase-freedom-flex']).toBe(5)
    expect(rates('Walmart', activated)['chase-freedom-flex']).toBe(1)
  })

  test('Ink Business Cash and Preferred', () => {
    expect(rates('Staples')['chase-ink-business-cash']).toBe(5)
    expect(rates('Comcast')['chase-ink-business-cash']).toBe(5)
    expect(rates('Shell')['chase-ink-business-cash']).toBe(2)
    expect(rates('UPS')['chase-ink-business-preferred']).toBe(3)
    expect(rates('Google Ads')['chase-ink-business-preferred']).toBe(3)
  })

  test('Citi Strata: portal bonuses, 1.5x Elite base, and travel agencies at 3x', () => {
    expect(rates('citi travel hotel')['citi-strata-elite']).toBe(12)
    expect(rates('Tiny Bookshop')['citi-strata-elite']).toBe(1.5)
    expect(rates('Expedia')['citi-strata-premier']).toBe(3)
    expect(rates('Kroger')['citi-strata-premier']).toBe(3)
    expect(rates('walmart fuel')['citi-strata-premier']).toBe(1)
  })

  test('Double Cash 2% everywhere; Custom Cash 5% on the picked category', () => {
    expect(rates('Tiny Bookshop')['citi-double-cash']).toBe(2)
    expect(rates('Chipotle')['citi-custom-cash']).toBe(1)
    const picked = wallet({
      'citi-custom-cash': {
        chosen: {
          period: '2026-10',
          picks: { 'top-category': ['restaurants'] },
        },
      },
    })
    expect(rates('Chipotle', picked)['citi-custom-cash']).toBe(5)
    expect(rates('DoorDash', picked)['citi-custom-cash']).toBe(1)
  })

  test('Capital One: portal hotels and entertainment', () => {
    expect(rates('capital one travel hotel')['capital-one-venture-x']).toBe(10)
    expect(rates('capital one travel hotel')['capital-one-venture']).toBe(5)
    expect(rates('Tiny Bookshop')['capital-one-venture-x']).toBe(2)
    expect(rates('capital one entertainment')['capital-one-savor']).toBe(8)
    expect(rates('Kroger')['capital-one-savor']).toBe(3)
    expect(rates('AMC')['capital-one-savor']).toBe(3)
  })

  test('Bilt: dining is the 3x default, grocery when picked', () => {
    expect(rates('Chipotle')['bilt-obsidian']).toBe(3)
    expect(rates('Kroger')['bilt-obsidian']).toBe(1)
    const grocery = wallet({
      'bilt-obsidian': {
        chosen: { period: '2026', picks: { 'three-x-category': ['grocery'] } },
      },
    })
    expect(rates('Kroger', grocery)['bilt-obsidian']).toBe(3)
    expect(rates('Chipotle', grocery)['bilt-obsidian']).toBe(1)
  })

  test('Wells Fargo Active Cash and Autograph', () => {
    expect(rates('Tiny Bookshop')['wells-fargo-active-cash']).toBe(2)
    expect(rates('Chipotle')['wells-fargo-autograph']).toBe(3)
    expect(rates('Shell')['wells-fargo-autograph']).toBe(3)
  })

  test('Blue Cash Everyday: 3% at supermarkets, gas and U.S. online retail, including Amazon', () => {
    expect(rates('Kroger')['amex-blue-cash-everyday']).toBe(3)
    expect(rates('Shell')['amex-blue-cash-everyday']).toBe(3)
    expect(rates('amazon.com')['amex-blue-cash-everyday']).toBe(3)
    expect(
      rates('Best Buy', wallet(), 'in_store')['amex-blue-cash-everyday'],
    ).toBe(1)
  })

  test('no-fee cards pool into the premium card points they can be combined with', () => {
    const currencyOf = (cards: string[], merchant: string, cardId: string) =>
      recommend(
        catalog,
        WalletSchema.parse({ cards: cards.map((id) => ({ id })) }),
        purchase(merchant),
      ).ranked.find((r) => r.cardId === cardId)?.currency
    expect(
      currencyOf(
        ['chase-ink-business-cash'],
        'Staples',
        'chase-ink-business-cash',
      ),
    ).toBe('cash')
    expect(
      currencyOf(
        ['chase-ink-business-cash', 'chase-ink-business-preferred'],
        'Staples',
        'chase-ink-business-cash',
      ),
    ).toBe('UR')
    expect(
      currencyOf(
        ['chase-freedom-flex', 'chase-ink-business-preferred'],
        'Chipotle',
        'chase-freedom-flex',
      ),
    ).toBe('UR')
    expect(
      currencyOf(
        ['citi-double-cash', 'citi-strata-premier'],
        'Tiny Bookshop',
        'citi-double-cash',
      ),
    ).toBe('TYP')
  })

  test('Blue Business Plus: 2x on everything, and Amex Travel stays out of the cap', () => {
    expect(rates('Tiny Bookshop')['amex-blue-business-plus']).toBe(2)
    expect(rates('Staples')['amex-blue-business-plus']).toBe(2)
    const booking = capBooking(catalog, wallet(), {
      cardId: 'amex-blue-business-plus',
      merchant: 'amex travel hotel',
      amount: 400,
      date: TODAY,
      channel: null,
    })
    expect(booking).toBeNull()
  })
})

describe('Bank of America Customized Cash Rewards', () => {
  const ID = 'bank-of-america-customized-cash-rewards'

  function ccr(card: object = {}, memberships: string[] = []): Wallet {
    return WalletSchema.parse({ memberships, cards: [{ id: ID, ...card }] })
  }

  function rate(
    merchant: string,
    w: Wallet,
    overrides: Parameters<typeof purchase>[1] = {},
  ): number | undefined {
    return recommend(catalog, w, purchase(merchant, overrides)).ranked.find(
      (r) => r.cardId === ID,
    )?.rate
  }

  const picked = (option: string, period = '2026-10') => ({
    chosen: { period, picks: { 'three-percent': [option] } },
  })

  test('gas is the 3% default; grocery stores and wholesale clubs earn 2%', () => {
    expect(rate('Shell', ccr())).toBe(3)
    expect(rate('Kroger', ccr())).toBe(2)
    expect(rate('Costco', ccr())).toBe(2)
    expect(rate('Walmart', ccr())).toBe(1)
    expect(rate('CVS', ccr())).toBe(1)
    expect(rate('Chipotle', ccr())).toBe(1)
  })

  test('each choice category earns 3%', () => {
    expect(rate('Chipotle', ccr(picked('dining')))).toBe(3)
    expect(rate('Shell', ccr(picked('dining')))).toBe(1)
    expect(rate('Delta', ccr(picked('travel')))).toBe(3)
    expect(rate('Uber', ccr(picked('travel')))).toBe(3)
    expect(rate('CVS', ccr(picked('drug-stores')))).toBe(3)
    expect(
      rate('Home Depot', ccr(picked('home-improvement-furnishings'))),
    ).toBe(3)
    expect(rate('IKEA', ccr(picked('home-improvement-furnishings')))).toBe(3)
  })

  test('the choice stays until changed, so an older pick still applies', () => {
    const w = ccr(picked('dining', '2026-07'))
    expect(rate('Chipotle', w)).toBe(3)
    const rec = recommend(catalog, w, purchase('Chipotle'))
    const warnings = [...rec.warnings, ...rec.ranked.flatMap((r) => r.warnings)]
    expect(warnings.join(' ')).not.toMatch(/not the current period/)
  })

  test('Online Shopping is any online purchase, minus excluded services', () => {
    const w = ccr(picked('online-shopping'))
    expect(rate('amazon.com', w)).toBe(3)
    expect(rate('Best Buy', w, { channel: 'online' })).toBe(3)
    expect(rate('Netflix', w, { channel: 'online' })).toBe(3)
    expect(rate('Best Buy', w, { channel: 'in_store' })).toBe(1)
    expect(rate('UPS', w, { channel: 'online' })).toBe(1)
    expect(rate('Planet Fitness', w, { channel: 'online' })).toBe(1)
  })

  test('3% and 2% share a $2,500 quarterly cap, then 1%', () => {
    const used = (spent: number) =>
      ccr({
        cap_usage: {
          'three-and-two-percent-combined': { period: '2026-Q4', spent },
        },
      })
    expect(rate('Kroger', used(2400), { amount: 200 })).toBeCloseTo(1.5)
    expect(rate('Shell', used(2400), { amount: 100 })).toBe(3)
    expect(rate('Shell', used(2500))).toBe(1)
    expect(rate('Kroger', used(2500))).toBe(1)
  })

  test('BofA Rewards tiers multiply every rate', () => {
    const premier = ccr({}, ['bofa-rewards-premier'])
    expect(rate('Shell', premier)).toBe(5.25)
    expect(rate('Kroger', premier)).toBe(3.5)
    expect(rate('Walmart', premier)).toBe(1.75)
    expect(rate('Shell', ccr({}, ['bofa-rewards-member']))).toBe(3.3)
    expect(rate('Shell', ccr({}, ['bofa-rewards-preferred-plus']))).toBe(3.75)
    expect(rate('Shell', ccr({}, ['bofa-rewards-preferred-honors']))).toBe(4.5)
    const capped = ccr(
      {
        cap_usage: {
          'three-and-two-percent-combined': { period: '2026-Q4', spent: 2500 },
        },
      },
      ['bofa-rewards-premier'],
    )
    expect(rate('Shell', capped)).toBe(1.75)
  })
})
