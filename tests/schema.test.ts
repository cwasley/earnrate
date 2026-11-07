import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { loadCatalog } from '../src/data/load.ts'
import { parseWalletYaml, walletYaml } from '../src/format/wallet-yaml.ts'
import { CardSchema } from '../src/schema/card.ts'
import { WalletCardSchema, WalletSchema } from '../src/schema/wallet.ts'

const goldYaml = `
id: amex-gold
name: American Express Gold Card
issuer: amex
network: amex
currency: MR
last_verified: 2026-10-24
verified_by: claude
source_urls: [https://www.americanexpress.com/]
base_rate: 1
foreign_transaction_fee: 0
rules:
  - id: restaurants
    match: { categories: [dining] }
    rate: 4
    cap: { amount: 50000, period: calendar_year, then_rate: 1 }
  - id: us-supermarkets
    match: { categories: [grocery.supermarket] }
    exclude: { categories: [superstore, warehouse_club] }
    rate: 4
    geography: us_only
    cap: { amount: 25000, period: calendar_year, then_rate: 1 }
`

const parseCard = (yaml: string) => CardSchema.safeParse(parse(yaml))

describe('CardSchema', () => {
  test('parses the spec example and applies defaults', () => {
    const card = CardSchema.parse(parse(goldYaml))
    expect(card.last_verified).toBe('2026-10-24')
    expect(card.rules[0]?.channel).toBe('any')
    expect(card.rules[0]?.geography).toBe('worldwide')
    expect(card.rules[1]?.geography).toBe('us_only')
    expect(card.caps).toEqual([])
  })

  test('requires a foreign transaction fee, 0 when there is none', () => {
    expect(
      parseCard(goldYaml.replace('foreign_transaction_fee: 0\n', '')).success,
    ).toBe(false)
  })

  test('rejects a misspelled key', () => {
    expect(parseCard(goldYaml.replace('base_rate', 'base_rat')).success).toBe(
      false,
    )
  })

  test('rejects a network that is not one of the four', () => {
    expect(
      parseCard(goldYaml.replace('network: amex', 'network: unknown')).success,
    ).toBe(false)
  })

  test('rejects a match with nothing to match on', () => {
    const empty = goldYaml.replace(
      'match: { categories: [dining] }',
      'match: { categories: [] }',
    )
    expect(parseCard(empty).success).toBe(false)
  })

  test('accepts a shared cap by id', () => {
    const shared = goldYaml.replace(
      'cap: { amount: 50000, period: calendar_year, then_rate: 1 }',
      'cap: dining-cap',
    )
    const card = CardSchema.parse(parse(shared))
    expect(card.rules[0]?.cap).toBe('dining-cap')
  })

  test('rejects valid_from after valid_to', () => {
    const windowed = goldYaml.replace(
      '    rate: 4\n    cap: { amount: 50000',
      '    rate: 4\n    valid_from: 2026-12-31\n    valid_to: 2026-10-01\n    cap: { amount: 50000',
    )
    expect(parseCard(windowed).success).toBe(false)
  })
})

describe('WalletSchema', () => {
  test('reads a bare-year period as a string', () => {
    const wallet = WalletSchema.parse(
      parse(`
cards:
  - id: amex-gold
    cap_usage: { us-supermarkets: { period: 2026, spent: 120.5 } }
`),
    )
    expect(wallet.cards[0]?.cap_usage['us-supermarkets']?.period).toBe('2026')
    expect(wallet.memberships).toEqual([])
  })

  test('rejects a malformed period', () => {
    const result = WalletSchema.safeParse(
      parse(`
cards:
  - id: usbank-cash-plus
    chosen: { period: 2026-q4, picks: { five-percent: [movie-theaters] } }
`),
    )
    expect(result.success).toBe(false)
  })

  test('accepts plain-number and object valuations', () => {
    const wallet = WalletSchema.parse(
      parse(`
valuations:
  MR: 1.5
  UR: { value: 1.2, range: [1.0, 2.0] }
cards: [{ id: amex-gold }]
`),
    )
    expect(wallet.valuations['MR']).toBe(1.5)
  })

  test('an export keeps every wallet card field through an import', async () => {
    const catalog = await loadCatalog()
    const wallet = parseWalletYaml(
      `
version: 1
valuations: { MR: 1.6 }
memberships: [amazon-prime]
cards:
  - id: amex-platinum
    checkout_label: Platinum
    anniversary: '03-14'
    opened: '2025-03-14'
    cap_usage: { flights: { period: '2026', spent: 1200 } }
    milestone_usage: { spend-75k: { period: '2026', spent: 14950 } }
    enrolled: [lululemon]
    credit_usage: { lululemon: { period: 2026-Q4, used: 75 } }
    skipped_credits: [equinox, oura]
    bonus: { opened: '2026-10-01', spent: 100 }
  - id: usbank-cash-plus
    chosen: { period: 2026-Q4, picks: { five-percent: [fast-food, cell-phone] } }
  - id: discover-it-cash-back
    activated: [q4-2026-restaurants]
`,
      catalog,
    )
    if (typeof wallet === 'string') throw new Error(wallet)
    const set = new Set(wallet.cards.flatMap((c) => Object.keys(c)))
    expect(
      Object.keys(WalletCardSchema.shape).filter((k) => !set.has(k)),
    ).toEqual([])
    expect(parseWalletYaml(walletYaml(wallet), catalog)).toEqual(wallet)
  })

  test('an imported wallet with a card number says so', async () => {
    const catalog = await loadCatalog()
    expect(
      parseWalletYaml(
        'valuations:\n  MR: { value: 1.5, redemption: card 4111 1111 1111 1112 }\ncards: [{ id: amex-gold }]\n',
        catalog,
      ),
    ).toMatch(/redemption note looks like it has a card number/)
  })
})
