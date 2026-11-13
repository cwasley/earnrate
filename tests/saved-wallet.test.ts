import { describe, expect, test } from 'vitest'
import { normalizeWallet } from '../site/app/saved-wallet.ts'

const gold = { id: 'amex-gold', cap_usage: {}, activated: [] }

describe('normalizeWallet', () => {
  test('a wallet without cards in it is no wallet', () => {
    expect(normalizeWallet(null)).toBeNull()
    expect(normalizeWallet('cards')).toBeNull()
    expect(normalizeWallet({ memberships: [] })).toBeNull()
    expect(normalizeWallet({ cards: 'amex-gold' })).toBeNull()
  })

  test('fills the defaults a card or wallet is missing', () => {
    expect(normalizeWallet({ cards: [{ id: 'amex-gold' }] })).toEqual({
      valuations: {},
      memberships: [],
      cards: [gold],
    })
  })

  test('drops entries that are not cards, and repeated cards', () => {
    const w = normalizeWallet({
      cards: [null, 'amex-gold', 7, [], { name: 'x' }, gold, { ...gold }],
    })
    expect(w?.cards).toEqual([gold])
  })

  test('memberships as one string become a list', () => {
    expect(
      normalizeWallet({ memberships: 'costco', cards: [] })?.memberships,
    ).toEqual(['costco'])
    expect(
      normalizeWallet({ memberships: ['costco', 3, null, 'Bad Id'], cards: [] })
        ?.memberships,
    ).toEqual(['costco'])
    expect(
      normalizeWallet({ memberships: { costco: true }, cards: [] })
        ?.memberships,
    ).toEqual([])
  })

  test('a bad field costs only that field', () => {
    const w = normalizeWallet({
      valuations: { 'amex-mr': 1.5, 'chase-ur': -2 },
      cards: [
        {
          id: 'amex-gold',
          activated: 'all',
          cap_usage: { x: { period: '2026-Q4', spent: -5 } },
          anniversary: 'March',
          bonus: { opened: '2026-10-01', spent: 'lots' },
          enrolled: ['dining-credit', 4],
          surprise: true,
        },
      ],
    })
    expect(w).toEqual({
      valuations: { 'amex-mr': 1.5 },
      memberships: [],
      cards: [
        {
          id: 'amex-gold',
          activated: [],
          cap_usage: {},
          bonus: { opened: '2026-10-01', spent: 0 },
          enrolled: ['dining-credit'],
        },
      ],
    })
  })

  test('a bonus without its opening date is dropped, not the card', () => {
    expect(
      normalizeWallet({ cards: [{ id: 'amex-gold', bonus: { spent: 100 } }] })
        ?.cards,
    ).toEqual([gold])
  })

  test('a card whose id is not an id is dropped', () => {
    expect(
      normalizeWallet({ cards: [{ id: 'Amex Gold' }, gold] })?.cards,
    ).toEqual([gold])
  })

  test('a checkout label holding a card number is dropped', () => {
    const w = normalizeWallet({
      cards: [{ ...gold, checkout_label: 'Gold 4111 1111 1111 1112' }],
    })
    expect(w?.cards).toEqual([gold])
  })

  test('cards earnrate no longer knows stay, for the page to skip', () => {
    expect(
      normalizeWallet({ cards: [{ id: 'retired-card' }, gold] })?.cards.map(
        (c) => c.id,
      ),
    ).toEqual(['retired-card', 'amex-gold'])
  })

  describe('wallets saved by older versions load unchanged', () => {
    test('the first site wallet: no version, picks and caps', () => {
      const old = {
        valuations: { 'amex-mr': { value: 1.6 } },
        memberships: ['amazon-prime'],
        cards: [
          {
            id: 'chase-freedom-flex',
            cap_usage: { quarterly: { period: '2026-Q4', spent: 120 } },
            activated: ['q4-2026'],
          },
          {
            id: 'citi-custom-cash',
            cap_usage: {},
            activated: [],
            chosen: { period: '2026-11', picks: { top: ['grocery'] } },
          },
        ],
      }
      expect(normalizeWallet(old)).toEqual(old)
    })

    test('a versioned wallet with only memberships', () => {
      expect(
        normalizeWallet({
          version: 1,
          valuations: {},
          memberships: ['costco'],
          cards: [],
        }),
      ).toEqual({ valuations: {}, memberships: ['costco'], cards: [] })
    })

    test('a wallet from before credits, milestones and skipped issuers', () => {
      const old = {
        valuations: {},
        memberships: [],
        cards: [
          {
            id: 'amex-gold',
            cap_usage: {},
            activated: [],
            anniversary: '03-15',
            bonus: { opened: '2026-09-01', spent: 2500 },
          },
        ],
      }
      expect(normalizeWallet(old)).toEqual(old)
    })

    test('a wallet with every field of today', () => {
      const today = {
        valuations: { 'amex-mr': 1.8 },
        memberships: ['costco'],
        skipped_issuers: ['chase'],
        cards: [
          {
            id: 'amex-platinum',
            checkout_label: 'Platinum',
            anniversary: '05-01',
            opened: '2025-05-01',
            cap_usage: {},
            activated: [],
            milestone_usage: { m: { period: '2026', spent: 10 } },
            enrolled: ['uber-cash'],
            credit_usage: { 'uber-cash': { period: '2026-11', used: 15 } },
            skipped_credits: ['saks'],
            night_values: { night: 300 },
            bonus: { opened: '2025-05-01', spent: 0, spend: 8000 },
          },
        ],
      }
      expect(normalizeWallet({ version: 1, ...today })).toEqual(today)
    })
  })
})
