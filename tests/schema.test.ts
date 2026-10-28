import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { CardSchema } from '../src/schema/card.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

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
})
