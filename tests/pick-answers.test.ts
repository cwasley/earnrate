import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { feeWorthKit, feeWorthVerdict } from '../src/engine/fee-worth.ts'
import { recommend } from '../src/engine/recommend.ts'
import { creditBack } from '../src/engine/text.ts'
import { WalletSchema } from '../src/schema/wallet.ts'
import { purchase, TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()
const CUSTOMIZED = 'bank-of-america-customized-cash-rewards'

const withPick = (pick: string) =>
  WalletSchema.parse({
    version: 1,
    cards: [
      {
        id: CUSTOMIZED,
        chosen: { period: '2026-Q4', picks: { 'three-percent': [pick] } },
      },
    ],
  })

const answer = (merchant: string, pick: string) =>
  recommend(catalog, withPick(pick), purchase(merchant, { amount: 40 }))

test("an answer names the pick that pays and only that pick's fine print", () => {
  const gas = answer('Exxon', 'gas-ev-charging')
  const [line = ''] = gas.ranked[0]?.reasoning ?? []
  expect(line).toBe(
    '3% cash back on gas stations and EV charging, your pick. Gas excludes EV charging billed by parking lots. Up to $2,500 of spending a quarter, then 1% cash back.',
  )
  const online = answer('Netflix', 'online-shopping').ranked[0]?.reasoning[0]
  expect(online).toMatch(/^3% cash back on online shopping, your pick\. /)
  expect(online).not.toMatch(/Gas excludes|Travel includes/)
})

test('a store the issuer names for a pick says so', () => {
  expect(answer('Exxon', 'gas-ev-charging').assumptions).toContain(
    'Assumes ExxonMobil counts as a gas station; for Bank of America Customized Cash Rewards, Bank of America names it as one.',
  )
})

test('a fee card that never wins names the no-fee card that leads, and the saved value behind it', () => {
  const { feeWorth } = feeWorthKit(catalog, TODAY, { MR: 1.7 })
  const card = catalog.cards.find(
    (c) => c.id === 'chase-ink-business-preferred',
  )
  if (!card) throw new Error('no card')
  const worth = feeWorth(card)
  if (!worth) throw new Error('no fee math')
  expect(worth.breakEven).toBeNull()
  expect(feeWorthVerdict(worth, 'Ink Business Preferred')).toContain(
    "doesn't earn more than the best no-fee card, the Amex Blue Business Plus, after its $95 fee",
  )
})

test("a month's own amount reads without nested parentheses inside them", () => {
  const uber = {
    amount: 15,
    period: 'month' as const,
    month_amounts: { 12: 35 },
  }
  expect(creditBack(uber)).toBe('$15 back each month ($35 in December)')
  expect(creditBack(uber, true)).toBe('$15 back each month, $35 in December')
})
