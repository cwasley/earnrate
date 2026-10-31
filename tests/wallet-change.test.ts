import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import {
  addToWallet,
  removeFromWallet,
  updateInWallet,
  withMemberships,
} from '../src/engine/wallet-change.ts'
import { WalletSchema } from '../src/schema/wallet.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()

function walletOf(change: ReturnType<typeof addToWallet>) {
  if (!change.ok) throw new Error(change.error)
  return change.wallet
}

describe('wallet changes without a file', () => {
  test('adding to no wallet starts one that parses like a wallet file', () => {
    const change = addToWallet(catalog, null, { id: 'chase-prime-visa' }, TODAY)
    const wallet = walletOf(change)
    expect(WalletSchema.parse(wallet)).toEqual(wallet)
    expect(change.ok && change.notes.map((n) => n.kind)).toEqual(['membership'])
  })

  test('picks are checked and filed under the current period', () => {
    const wallet = walletOf(
      addToWallet(catalog, null, { id: 'usbank-cash-plus' }, TODAY),
    )
    const bad = updateInWallet(
      catalog,
      wallet,
      { id: 'usbank-cash-plus', picks: { 'five-percent': ['nope'] } },
      TODAY,
    )
    expect(bad.ok).toBe(false)
    const good = walletOf(
      updateInWallet(
        catalog,
        wallet,
        { id: 'usbank-cash-plus', picks: { 'five-percent': ['fast-food'] } },
        TODAY,
      ),
    )
    expect(good.cards[0]?.chosen).toEqual({
      period: '2026-Q4',
      picks: { 'five-percent': ['fast-food'] },
    })
  })

  test('refuses card numbers, duplicates, unknown memberships and removing the last card', () => {
    const wallet = walletOf(
      addToWallet(catalog, null, { id: 'amex-gold' }, TODAY),
    )
    const numbered = updateInWallet(
      catalog,
      wallet,
      { id: 'amex-gold', checkoutLabel: 'Gold 12345678' },
      TODAY,
    )
    expect(!numbered.ok && numbered.error).toMatch(/card number/)
    expect(addToWallet(catalog, wallet, { id: 'amex-gold' }, TODAY).ok).toBe(
      false,
    )
    expect(withMemberships(catalog, wallet, ['costco-gold']).ok).toBe(false)
    expect(removeFromWallet(wallet, 'amex-gold').ok).toBe(false)
  })
})
