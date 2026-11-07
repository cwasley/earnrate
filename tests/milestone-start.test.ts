import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { milestoneSummaries } from '../src/engine/milestones.ts'
import { bookPurchase } from '../src/engine/record.ts'
import { cardInfo } from '../src/engine/setup.ts'
import {
  resolveSpendLines,
  simulateWallet,
  spendLineFor,
} from '../src/engine/simulate.ts'
import type { Card } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const base = await loadCatalog()
const card: Card = {
  ...(base.cards.find((c) => c.id === 'chase-ihg-one-rewards-business') ??
    (() => {
      throw new Error('no card')
    })()),
  milestones: [
    {
      id: 'diamond-2027',
      spend: 50_000,
      period: 'calendar_year',
      rewards: ['Diamond Elite status'],
      valid_from: '2027-01-01',
    },
  ],
}
const catalog: Catalog = {
  ...base,
  cards: base.cards.map((c) => (c.id === card.id ? card : c)),
}
const wallet = WalletSchema.parse({
  cards: [
    {
      id: card.id,
      milestone_usage: { 'diamond-2027': { period: '2027', spent: 49_900 } },
    },
  ],
})
const held =
  wallet.cards[0] ??
  (() => {
    throw new Error('no card')
  })()

describe('a spend milestone that starts later', () => {
  test('is listed with its start until then, and plainly after', () => {
    const before = cardInfo(catalog, card, null, '2026-11-07')
    expect(before.milestones[0]?.text).toBe(
      '$50,000 calendar-year spend for Diamond Elite status starting Jan 1, 2027',
    )
    const after = cardInfo(catalog, card, null, '2027-01-02')
    expect(after.milestones[0]?.text).toBe(
      '$50,000 calendar-year spend for Diamond Elite status',
    )
  })

  test("isn't tracked or reached before it starts", () => {
    expect(milestoneSummaries(card, held, '2026-12-31')).toEqual([])
    expect(milestoneSummaries(card, held, '2027-03-01')).toHaveLength(1)
    const purchase = (date: string) => ({
      cardId: card.id,
      merchant: 'ihg',
      amount: 200,
      channel: null,
      date,
    })
    const early = bookPurchase(catalog, wallet, purchase('2026-12-31'))
    expect(early.milestones).toEqual([])
    const later = bookPurchase(catalog, wallet, purchase('2027-03-01'))
    expect(later.milestones.map((m) => m.milestoneId)).toEqual(['diamond-2027'])
  })

  test('a simulated year it starts in counts it, and says from when', () => {
    const lines = resolveSpendLines(catalog, [
      spendLineFor(catalog, 'other', 5_000),
    ])
    const sim = simulateWallet(catalog, wallet, lines, '2026-12-01', [card.id])
    expect(sim.notes.join(' ')).toContain(
      'Diamond Elite status starting Jan 1, 2027',
    )
  })
})
