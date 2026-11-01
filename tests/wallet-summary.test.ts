import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { walletSummary } from '../src/engine/wallet-summary.ts'
import { formatWalletSummary } from '../src/format/wallet.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const catalog = await loadCatalog()

test('picks that carry over have no end date', () => {
  const wallet = WalletSchema.parse({
    cards: [
      {
        id: 'bank-of-america-customized-cash-rewards',
        chosen: {
          period: '2026',
          picks: { 'three-percent': ['online-shopping'] },
        },
      },
    ],
  })
  const later = walletSummary(catalog, wallet, '2027-03-01')
  expect(later.cards[0]?.chosen).toMatchObject({ current: true, until: null })
  expect(formatWalletSummary(later)).toMatch(
    /Picks: 3%: online shopping\. They stay until the user changes them\./,
  )
})

test('every bonus rate is listed, and an activated quarter says so', () => {
  const wallet = WalletSchema.parse({
    cards: [{ id: 'chase-freedom-flex', activated: ['q4-2026-grocery'] }],
  })
  const [flex] = walletSummary(catalog, wallet, '2026-11-01').cards
  const rates = flex?.rates.join('; ') ?? ''
  expect(rates).toMatch(/on drugstores/)
  expect(rates).not.toMatch(/once activated/)
  expect(flex?.toActivate).toEqual([])
})
