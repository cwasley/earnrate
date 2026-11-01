import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { setValuationsText } from '../src/data/wallet-edit.ts'
import { withValuations } from '../src/engine/wallet-change.ts'
import { compareOffers } from '../src/engine/offers.ts'
import { walletSummary } from '../src/engine/wallet-summary.ts'
import { formatOffers } from '../src/format/offers.ts'
import { formatWalletSummary } from '../src/format/wallet.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const catalog = await loadCatalog()

test('point values are set, cleared and checked', () => {
  const wallet = WalletSchema.parse({ cards: [{ id: 'amex-gold' }] })
  const set = withValuations(catalog, wallet, { UR: 1.5, MR: 1.6 })
  if (!set.ok) throw new Error(set.error)
  expect(set.wallet.valuations).toEqual({ UR: 1.5, MR: 1.6 })
  const cleared = withValuations(catalog, set.wallet, { UR: null })
  if (!cleared.ok) throw new Error(cleared.error)
  expect(cleared.wallet.valuations).toEqual({ MR: 1.6 })
  const unknown = withValuations(catalog, wallet, { XX: 2 })
  expect(unknown.ok ? '' : unknown.error).toMatch(/Unknown currency 'XX'/)
  const high = withValuations(catalog, wallet, { UR: 9 })
  expect(high.ok ? '' : high.error).toMatch(/at most 5¢/)
})

test('wallet file edits keep comments and the rest of the file', () => {
  const text =
    'version: 1\nvaluations:\n  UR: 1.5 # mine\n  MR: 1.2\nmemberships: [amazon-prime]\n# my cards\ncards:\n  - id: amex-gold\n'
  expect(setValuationsText(text, { UR: 1.7, MR: null, TYP: 1.3 })).toBe(
    'version: 1\nvaluations:\n  UR: 1.7 # mine\n  TYP: 1.3\nmemberships: [amazon-prime]\n# my cards\ncards:\n  - id: amex-gold\n',
  )
  expect(
    setValuationsText('version: 1\n# my cards\ncards:\n  - id: amex-gold\n', {
      UR: 1.5,
    }),
  ).toBe(
    'version: 1\nvaluations:\n  UR: 1.5\n# my cards\ncards:\n  - id: amex-gold\n',
  )
  expect(
    setValuationsText('valuations:\n  UR: 1.5\ncards:\n  - id: amex-gold\n', {
      UR: null,
    }),
  ).toBe('cards:\n  - id: amex-gold\n')
})

test('a redemption choice in the wallet reads as one, not as a set value', () => {
  const wallet = WalletSchema.parse({
    valuations: { 'sofi-rewards': { redemption: 'sofi-account' } },
    cards: [{ id: 'sofi-unlimited-2' }],
  })
  const summary = walletSummary(catalog, wallet, '2026-11-01')
  expect(summary.pointValues).toEqual([
    {
      currency: 'sofi-rewards',
      name: 'SoFi Member Rewards',
      centsPerUnit: 1,
      redemption: 'sofi-account',
    },
  ])
  expect(formatWalletSummary(summary)).toMatch(
    /Point values in the wallet: SoFi Member Rewards at 1¢ \(redeemed as sofi account\)/,
  )
})

test('offers ruled out by a held card stay in view past the top ten', () => {
  const holder = WalletSchema.parse({ cards: [{ id: 'amex-platinum' }] })
  const comparison = compareOffers(
    catalog,
    holder,
    { kind: 'any', noAnnualFee: false, business: false, includeHeld: false },
    '2026-11-01',
  )
  const text = formatOffers(comparison, (id) => id, false)
  expect(text).toMatch(
    /more left out as likely not eligible with a card you hold: American Express Gold Card/,
  )
})
