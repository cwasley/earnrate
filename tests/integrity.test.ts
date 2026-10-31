import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { catalogProblems, walletProblems } from '../src/data/integrity.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { CardSchema } from '../src/schema/card.ts'
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
    const problems = catalogProblems(catalog(yaml))
    expect(problems).toContain(
      'card usbank-cash-plus: no evidence for bonus-at-costco',
    )
    expect(problems.join(' ')).toMatch(
      /five-percent: https:\/\/example\.com\/ isn't in source_urls/,
    )
    expect(problems.join(' ')).toMatch(
      /base_rate: quote should be 3-20 words, not 1/,
    )
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

  test('catches a child category without its parent', () => {
    const c = catalog()
    c.categories = c.categories.filter((x) => x.id !== 'dining')
    expect(catalogProblems(c)).toContain(
      "category dining.fast_food: parent 'dining' is missing",
    )
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

  test('catches a card that is not in the catalog', () => {
    expect(
      walletProblems(wallet('cards: [{ id: amex-centurion }]'), catalog()),
    ).toEqual(['wallet card amex-centurion: not in the card catalog'])
  })
})
