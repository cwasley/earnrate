import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { setValuationsText } from '../src/data/wallet-edit.ts'
import { withValuations } from '../src/engine/wallet-change.ts'
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
