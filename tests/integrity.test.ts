import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { catalogProblems, walletProblems } from '../src/data/integrity.ts'
import { CardSchema } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { CategoriesFileSchema } from '../src/schema/category.ts'
import { CurrenciesFileSchema } from '../src/schema/currency.ts'
import { MerchantsFileSchema } from '../src/schema/merchant.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const cashPlusYaml = `
id: usbank-cash-plus
name: U.S. Bank Cash+ Visa Signature
issuer: usbank
network: visa
currency: cash
last_verified: 2026-10-24
verified_by: claude
source_urls: [https://www.usbank.com/]
base_rate: 1
foreign_transaction_fee: 0
caps:
  - { id: five-percent-combined, amount: 2000, period: quarter, then_rate: 1 }
choices:
  - id: five-percent
    pick: 2
    period: quarter
    options:
      tv-internet-streaming: [tv_internet, streaming]
      movie-theaters: [movie_theaters]
      fast-food: [dining.fast_food]
rules:
  - id: five-percent
    match: { choice: five-percent }
    rate: 5
    cap: five-percent-combined
  - id: bonus-at-costco
    match: { merchants: [costco] }
    rate: 3
    requires: { activation: true }
evidence:
  - { rule: base_rate, url: https://www.usbank.com/, quote: 1% on everything else }
  - { rule: foreign_transaction_fee, url: https://www.usbank.com/, quote: Foreign transaction fee 3% }
  - { rule: five-percent, url: https://www.usbank.com/, quote: 5% on two categories }
  - { rule: bonus-at-costco, url: https://www.usbank.com/, quote: 3% at Costco }
`

function catalog(cardYaml = cashPlusYaml): Catalog {
  return {
    categories: CategoriesFileSchema.parse(
      [
        'tv_internet',
        'streaming',
        'movie_theaters',
        'dining',
        'dining.fast_food',
        'warehouse_club',
        'other',
      ].map((id) => ({ id, name: id })),
    ),
    currencies: CurrenciesFileSchema.parse([
      { id: 'cash', name: 'Cash', value_cents: 1 },
    ]),
    issuers: [{ id: 'usbank', name: 'U.S. Bank', search: [] }],
    memberships: [],
    cards: [CardSchema.parse(parse(cardYaml))],
    merchants: {
      seed: MerchantsFileSchema.parse([
        { id: 'costco', name: 'Costco', category: 'warehouse_club' },
      ]),
      overrides: [],
    },
  }
}

const wallet = (yaml: string) => WalletSchema.parse(parse(yaml))

describe('catalogProblems', () => {
  test('a consistent catalog has no problems', () => {
    expect(catalogProblems(catalog())).toEqual([])
  })

  test('catches an issuer missing from data/issuers.yaml', () => {
    const broken = cashPlusYaml.replace('issuer: usbank', 'issuer: us-bank')
    expect(catalogProblems(catalog(broken))).toEqual([
      "usbank-cash-plus: unknown issuer 'us-bank' (data/issuers.yaml)",
    ])
  })

  test('catches a dangling shared cap', () => {
    const broken = cashPlusYaml.replace(
      'cap: five-percent-combined',
      'cap: five-pct',
    )
    expect(catalogProblems(catalog(broken))).toEqual([
      "card usbank-cash-plus rule five-percent: unknown cap 'five-pct'",
    ])
  })

  test('rules on a rotating cap need dates', () => {
    const broken = cashPlusYaml.replace(
      'period: quarter, then_rate: 1 }',
      'period: quarter, then_rate: 1, rotating: true }',
    )
    expect(catalogProblems(catalog(broken))).toEqual([
      "card usbank-cash-plus rule five-percent: rules on rotating cap 'five-percent-combined' need valid_from and valid_to",
    ])
  })

  test('catches an unknown category inside a choice option', () => {
    const broken = cashPlusYaml.replace('[movie_theaters]', '[movies]')
    expect(catalogProblems(catalog(broken))).toEqual([
      "card usbank-cash-plus choice five-percent.movie-theaters: unknown category 'movies'",
    ])
  })

  test('catches an unknown merchant', () => {
    const broken = cashPlusYaml.replace(
      'merchants: [costco]',
      'merchants: [cosco]',
    )
    expect(catalogProblems(catalog(broken))).toEqual([
      "card usbank-cash-plus rule bonus-at-costco: unknown merchant 'cosco'",
    ])
  })

  test('every rule needs a short quote from one of its sources', () => {
    const yaml = cashPlusYaml
      .replace(
        '  - { rule: bonus-at-costco, url: https://www.usbank.com/, quote: 3% at Costco }\n',
        '',
      )
      .replace(
        'url: https://www.usbank.com/, quote: 5% on two categories',
        'url: https://example.com/, quote: 5% on two categories',
      )
      .replace('quote: 1% on everything else', 'quote: 1%')
      .replace(
        '  - { rule: foreign_transaction_fee, url: https://www.usbank.com/, quote: Foreign transaction fee 3% }\n',
        '',
      )
    const problems = catalogProblems(catalog(yaml))
    expect(problems).toContain(
      'card usbank-cash-plus: no evidence for bonus-at-costco',
    )
    expect(problems).toContain(
      'card usbank-cash-plus: no evidence for foreign_transaction_fee',
    )
    expect(problems.join(' ')).toMatch(
      /five-percent: https:\/\/example\.com\/ isn't in source_urls/,
    )
    expect(problems.join(' ')).toMatch(
      /base_rate: quote should be 3-20 words, not 1/,
    )
  })

  test('an unknown foreign transaction fee needs a todo saying so', () => {
    const yaml = cashPlusYaml
      .replace('foreign_transaction_fee: 0', 'foreign_transaction_fee: null')
      .replace(
        '  - { rule: foreign_transaction_fee, url: https://www.usbank.com/, quote: Foreign transaction fee 3% }\n',
        '',
      )
    expect(catalogProblems(catalog(yaml))).toContain(
      'card usbank-cash-plus: foreign_transaction_fee is null without a todo saying why',
    )
    expect(
      catalogProblems(
        catalog(
          `${yaml}todo: ['Foreign transaction fee not on file: the page is blocked.']\n`,
        ),
      ),
    ).toEqual([])
  })

  test('pooling needs a quote too', () => {
    const yaml = cashPlusYaml.replace(
      'base_rate: 1\n',
      'base_rate: 1\npools_into: { currency: cash, when_wallet_has: [usbank-cash-plus] }\n',
    )
    expect(catalogProblems(catalog(yaml))).toContain(
      'card usbank-cash-plus: no evidence for pools_into',
    )
  })

  test('a spend milestone needs a quote, and an id no rule has', () => {
    const yaml = cashPlusYaml.replace(
      'evidence:\n',
      'milestones:\n  - { id: spend-10k, spend: 10000, period: calendar_year, points: 5000 }\n  - { id: bonus-at-costco, spend: 20000, period: calendar_year, rewards: [Gold status] }\nevidence:\n',
    )
    const problems = catalogProblems(catalog(yaml))
    expect(problems).toContain(
      'card usbank-cash-plus: no evidence for spend-10k',
    )
    expect(problems).toContain(
      "card usbank-cash-plus: milestone 'bonus-at-costco' has a rule's id",
    )
  })

  test('a spend milestone pays points, rewards or both', () => {
    const card = parse(cashPlusYaml) as Record<string, unknown>
    const milestone = { id: 'spend-10k', spend: 10000, period: 'calendar_year' }
    expect(
      CardSchema.safeParse({ ...card, milestones: [milestone] }).success,
    ).toBe(false)
    expect(
      CardSchema.safeParse({
        ...card,
        milestones: [{ ...milestone, points: 1 }],
      }).success,
    ).toBe(true)
  })

  describe('stores an issuer names', () => {
    const named = (earning: string[], notEarning: string[], quotes: string[]) =>
      catalog(
        cashPlusYaml
          .replace(
            'evidence:\n',
            `  - id: dining
    match: { categories: [dining] }
    exclude: { categories: [dining.fast_food] }
    rate: 2
    named: { earning: [${earning.join(', ')}], not_earning: [${notEarning.join(', ')}] }
evidence:
`,
          )
          .concat(
            quotes
              .map((q) => `  - { rule: ${q}, url: https://www.usbank.com/ }\n`)
              .join(''),
          ),
      )
    const withStores = (c: Catalog) => ({
      ...c,
      merchants: {
        ...c.merchants,
        seed: MerchantsFileSchema.parse([
          ...c.merchants.seed,
          { id: 'chez-panisse', name: 'Chez Panisse', category: 'dining' },
          {
            id: 'burger-hut',
            name: "Burger Hut's",
            aliases: ['burger hut'],
            category: 'dining.fast_food',
          },
        ]),
      },
    })
    const quotes = [
      'dining, quote: 2% at restaurants',
      'dining.earning, quote: Restaurants such as Chez Panisse earn 2%',
      'dining.not_earning, quote: Not fast food (e.g. Burger-Hut) or Costco',
    ]

    test('agree with the rule and are named in their list’s quotes', () => {
      expect(
        catalogProblems(
          withStores(named(['chez-panisse'], ['burger-hut', 'costco'], quotes)),
        ),
      ).toEqual([])
    })

    test('each list needs quotes, and each store has to be in them', () => {
      const problems = catalogProblems(
        withStores(
          named(['chez-panisse'], ['burger-hut', 'tacos'], quotes.slice(0, 2)),
        ),
      )
      expect(problems).toContain(
        'card usbank-cash-plus: no evidence for dining.not_earning',
      )
      expect(problems).toContain(
        "card usbank-cash-plus rule dining named.not_earning: unknown merchant 'tacos'",
      )
      expect(
        catalogProblems(
          withStores(
            named(
              ['chez-panisse'],
              ['burger-hut'],
              [
                ...quotes.slice(0, 2),
                'dining.not_earning, quote: Not at fast food restaurants',
              ],
            ),
          ),
        ),
      ).toEqual([
        "card usbank-cash-plus rule dining: no dining.not_earning quote names Burger Hut's",
      ])
    })

    test("are refused when earnrate's data says otherwise", () => {
      expect(
        catalogProblems(
          withStores(
            named(
              ['burger-hut'],
              ['chez-panisse'],
              [
                quotes[0] ?? '',
                'dining.earning, quote: Restaurants such as Burger Hut earn 2%',
                'dining.not_earning, quote: Not at Chez Panisse either',
              ],
            ),
          ),
        ),
      ).toEqual([
        "card usbank-cash-plus rule dining: the issuer names Burger Hut's as earning it, but earnrate's data doesn't pay it there",
        "card usbank-cash-plus rule dining: the issuer names Chez Panisse as not earning it, but earnrate's data pays it there",
      ])
    })
  })

  test('catches a child category without its parent', () => {
    const c = catalog()
    c.categories = c.categories.filter((x) => x.id !== 'dining')
    expect(catalogProblems(c)).toContain(
      "category dining.fast_food: parent 'dining' is missing",
    )
  })

  test("catches a category answered by a page that isn't there", () => {
    const c = catalog()
    c.categories = CategoriesFileSchema.parse([
      ...c.categories,
      { id: 'dining.bars', name: 'Bars', page: 'dining.pubs' },
      { id: 'dining.cafes', name: 'Cafes', page: 'dining.cafes' },
      { id: 'dining.diners', name: 'Diners', page: 'dining.bars' },
    ])
    expect(catalogProblems(c)).toEqual(
      expect.arrayContaining([
        "category dining.bars: page 'dining.pubs' is not another category",
        "category dining.cafes: page 'dining.cafes' is not another category",
        "category dining.diners: page 'dining.bars' has no page of its own either",
      ]),
    )
  })

  test("catches a category naming a card that isn't there", () => {
    const c = catalog()
    c.categories = CategoriesFileSchema.parse([
      ...c.categories,
      {
        id: 'housing',
        name: 'Rent',
        note: 'Pay rent through Bilt.',
        cards: ['bilt-teal'],
      },
    ])
    expect(catalogProblems(c)).toContain(
      "category housing: card 'bilt-teal' is not in the catalog",
    )
    expect(
      CategoriesFileSchema.safeParse([
        { id: 'dining', name: 'Dining', cards: ['bilt-blue'] },
      ]).success,
    ).toBe(false)
  })

  test('catches one alias naming two merchants', () => {
    const c = catalog()
    c.merchants.seed = MerchantsFileSchema.parse([
      { id: 'costco', name: 'Costco', category: 'warehouse_club' },
      {
        id: 'costco-gas',
        name: 'Costco Gas',
        aliases: ['costco'],
        category: 'other',
      },
    ])
    expect(catalogProblems(c)).toEqual([
      "seed: 'costco' names both costco and costco-gas",
      "merchant costco: 'Costco' resolves to costco-gas",
    ])
  })

  test('catches an override whose name starts a seed merchant’s name', () => {
    const c = catalog()
    c.merchants.overrides = MerchantsFileSchema.parse([
      { id: 'amazon', name: 'Amazon', category: 'other' },
    ])
    c.merchants.seed.push(
      ...MerchantsFileSchema.parse([
        { id: 'amazon-music', name: 'Amazon Music', category: 'streaming' },
      ]),
    )
    expect(catalogProblems(c)).toEqual([
      "merchant amazon-music: 'Amazon Music' resolves to amazon",
    ])
  })

  test('catches a brand of an unknown merchant, or of another brand', () => {
    const c = catalog()
    c.merchants.seed.push(
      ...MerchantsFileSchema.parse([
        { id: 'hilton', name: 'Hilton', category: 'other' },
        {
          id: 'hampton',
          name: 'Hampton',
          category: 'other',
          brand_of: 'hilton',
        },
        { id: 'tiny', name: 'Tiny', category: 'other', brand_of: 'hampton' },
        { id: 'lost', name: 'Lost', category: 'other', brand_of: 'nowhere' },
      ]),
    )
    expect(catalogProblems(c)).toEqual([
      "merchant tiny: brand_of 'hampton' is itself a brand of 'hilton'",
      "merchant lost: brand_of 'nowhere' is not a merchant",
    ])
  })

  test('catches a merchant named like a category', () => {
    const c = catalog()
    c.categories = CategoriesFileSchema.parse([
      ...c.categories,
      { id: 'gas', name: 'Gas stations', aliases: ['gas'] },
    ])
    c.merchants.seed.push(
      ...MerchantsFileSchema.parse([
        { id: 'gas-n-go', name: 'Gas', category: 'gas' },
      ]),
    )
    expect(catalogProblems(c)).toEqual([
      "category gas: 'Gas stations' resolves to gas-n-go",
      "category gas: 'gas' resolves to gas-n-go",
    ])
  })
})

describe('walletProblems', () => {
  test('a valid wallet has no problems', () => {
    const w = wallet(`
cards:
  - id: usbank-cash-plus
    cap_usage: { five-percent-combined: { period: 2026-Q4, spent: 300 } }
    chosen: { period: 2026-Q4, picks: { five-percent: [tv-internet-streaming, movie-theaters] } }
    activated: [bonus-at-costco]
`)
    expect(walletProblems(w, catalog())).toEqual([])
  })

  test('catches too many picks and an unknown option', () => {
    const w = wallet(`
cards:
  - id: usbank-cash-plus
    chosen: { period: 2026-Q4, picks: { five-percent: [tv-internet-streaming, movie-theaters, gyms] } }
`)
    expect(walletProblems(w, catalog())).toEqual([
      'wallet card usbank-cash-plus chosen five-percent: picked 3, card allows 2',
      "wallet card usbank-cash-plus chosen five-percent: 'gyms' is not an option",
    ])
  })

  test('catches usage recorded against something that is not a cap', () => {
    const w = wallet(`
cards:
  - id: usbank-cash-plus
    cap_usage: { bonus-at-costco: { period: 2026, spent: 10 } }
`)
    expect(walletProblems(w, catalog())).toEqual([
      "wallet card usbank-cash-plus cap_usage: 'bonus-at-costco' is not a cap on this card",
    ])
  })

  test('catches milestone spending recorded against something that is not a milestone', () => {
    const w = wallet(`
cards:
  - id: usbank-cash-plus
    milestone_usage: { five-percent: { period: 2026, spent: 10 } }
`)
    expect(walletProblems(w, catalog())).toEqual([
      "wallet card usbank-cash-plus milestone_usage: 'five-percent' is not a spend milestone on this card",
    ])
  })

  test('catches a card that is not in the catalog', () => {
    expect(
      walletProblems(wallet('cards: [{ id: amex-centurion }]'), catalog()),
    ).toEqual(['wallet card amex-centurion: not in the card catalog'])
  })
})
