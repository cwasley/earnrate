import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { addToWallet, updateInWallet } from '../src/engine/wallet-change.ts'
import type { Wallet, WalletCard } from '../src/schema/wallet.ts'
import {
  openedChange,
  spentChange,
  trackingChange,
} from '../site/app/bonus-change.ts'
import { draftShown } from '../site/app/draft.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()

const daysAgo = (n: number) =>
  new Date(Date.parse(TODAY) - n * 864e5).toISOString().slice(0, 10)

function goldWith(bonus: WalletCard['bonus']): Wallet {
  const added = addToWallet(catalog, null, { id: 'amex-gold' }, TODAY)
  if (!added.ok) throw new Error(added.error)
  const w = added.wallet
  return { ...w, cards: w.cards.map((c) => ({ ...c, bonus })) }
}

const held = (w: Wallet) => {
  const c = w.cards[0]
  if (!c) throw new Error('no card')
  return c
}

describe("a field's draft", () => {
  test('shows what was typed while the saved value is unchanged', () => {
    expect(draftShown({ value: '150', over: '100' }, '100', '100')).toBe('150')
  })

  test('gives way when the saved value changes under it', () => {
    expect(draftShown({ value: '150', over: '100' }, '900', '900')).toBe('900')
    expect(draftShown(null, '900', '900')).toBe('900')
  })

  test('can be keyed by a value it stands for', () => {
    const typed = { month: 3, day: 0 }
    expect(
      draftShown({ value: typed, over: null }, { month: 0, day: 0 }, null),
    ).toBe(typed)
    expect(
      draftShown({ value: typed, over: null }, { month: 5, day: 1 }, '05-01'),
    ).toEqual({ month: 5, day: 1 })
  })
})

describe("a card's welcome bonus settings", () => {
  const opened = daysAgo(20)
  const stale = goldWith({ opened, spent: 100 })
  const server = goldWith({ opened, spent: 900 })

  test('changing the date keeps spending recorded elsewhere', () => {
    const date = daysAgo(21)
    const change = openedChange(held(stale), date, {
      tracking: true,
      introRates: false,
      unsaved: '',
    })
    expect(change).toEqual({ bonus: { opened: date } })
    const after = updateInWallet(
      catalog,
      server,
      { id: 'amex-gold', ...change },
      TODAY,
    )
    if (!after.ok) throw new Error(after.error)
    expect(held(after.wallet).bonus).toMatchObject({ opened: date, spent: 900 })
  })

  test("a card with a first-year rate sets its date and its bonus's together", () => {
    const date = daysAgo(21)
    expect(
      openedChange(held(stale), date, {
        tracking: true,
        introRates: true,
        unsaved: '',
      }),
    ).toEqual({ opened: date, bonus: { opened: date } })
    expect(
      openedChange({ ...held(stale), opened }, '', {
        tracking: true,
        introRates: true,
        unsaved: '',
      }),
    ).toEqual({ opened: null })
  })

  test('the spending sent is only what was typed, with the saved date', () => {
    expect(spentChange(held(stale), '', '250')).toEqual({
      bonus: { opened, spent: 250 },
    })
  })

  test('spending typed before a date waits for one', () => {
    const none = goldWith(undefined)
    expect(spentChange(held(none), '', '250')).toBeNull()
    expect(trackingChange(held(none), true, '', '250')).toBeNull()
    expect(
      openedChange(held(none), opened, {
        tracking: true,
        introRates: false,
        unsaved: '250',
      }),
    ).toEqual({ bonus: { opened, spent: 250 } })
  })

  test('turning tracking off removes the bonus, and on again starts one', () => {
    expect(trackingChange(held(stale), false, opened, '')).toEqual({
      bonus: null,
    })
    expect(trackingChange(held(goldWith(undefined)), true, opened, '')).toEqual(
      { bonus: { opened, spent: 0 } },
    )
    expect(trackingChange(held(stale), true, opened, '')).toBeNull()
  })
})
