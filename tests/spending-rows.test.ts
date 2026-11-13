import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TYPICAL_MONTHLY_SPEND } from '../src/engine/simulate.ts'
import {
  isTypicalRows,
  loadSpendingRows,
  PAST_TYPICAL,
  saveSpendingRows,
  sameRows,
} from '../site/app/spending-rows.ts'

const KEY = 'earnrate:spending'
let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Best setups' spending rows", () => {
  test('the current typical amounts are on the list of past defaults, so changing them later still recognizes these', () => {
    expect(PAST_TYPICAL.some((p) => sameRows(p, TYPICAL_MONTHLY_SPEND))).toBe(
      true,
    )
  })

  test('a fresh visitor gets the typical amounts', () => {
    expect(isTypicalRows(loadSpendingRows())).toBe(true)
  })

  test('rows saved at any past default load as the current typical amounts', () => {
    for (const past of PAST_TYPICAL) {
      store.set(KEY, JSON.stringify(past))
      expect(isTypicalRows(loadSpendingRows())).toBe(true)
    }
  })

  test("the person's own rows are kept, even one dollar off a past default", () => {
    const [first] = PAST_TYPICAL
    if (!first) throw new Error('no past default')
    const own = first.map((r, i) => (i === 0 ? { ...r, monthly: 510 } : r))
    store.set(KEY, JSON.stringify(own))
    expect(loadSpendingRows()).toEqual(own)
    expect(isTypicalRows(loadSpendingRows())).toBe(false)
  })

  test('the typical rows in another order are still typical, and are forgotten when saved', () => {
    const moved = [...TYPICAL_MONTHLY_SPEND.slice(1), TYPICAL_MONTHLY_SPEND[0]]
      .filter((r) => r !== undefined)
      .map((r) => ({ ...r }))
    expect(isTypicalRows(moved)).toBe(true)
    store.set(KEY, JSON.stringify(moved))
    expect(isTypicalRows(loadSpendingRows())).toBe(true)
    saveSpendingRows(moved)
    expect(store.has(KEY)).toBe(false)
    expect(
      sameRows(moved, [...moved.slice(1), { what: 'Gas', monthly: 151 }]),
    ).toBe(false)
  })

  test('saving keeps changed rows, and rows back at the typical amounts are forgotten', () => {
    const own = [{ what: 'Groceries', monthly: 700 }]
    saveSpendingRows(own)
    expect(store.get(KEY)).toBe(JSON.stringify(own))
    saveSpendingRows(TYPICAL_MONTHLY_SPEND.map((t) => ({ ...t })))
    expect(store.has(KEY)).toBe(false)
  })

  test('something else under the key, or storage that throws, gives the typical amounts', () => {
    store.set(KEY, '{"not":"rows"}')
    expect(isTypicalRows(loadSpendingRows())).toBe(true)
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(isTypicalRows(loadSpendingRows())).toBe(true)
  })
})
