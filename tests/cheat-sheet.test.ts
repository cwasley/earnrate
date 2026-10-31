import { describe, expect, test } from 'vitest'
import { loadCatalog, loadWallet } from '../src/data/load.ts'
import { cheatSheet } from '../src/engine/cheat-sheet.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()
const example = await loadWallet(
  new URL('../wallet.example.yaml', import.meta.url).pathname,
)

describe('cheat sheet', () => {
  test('the best card for each everyday purchase, with the wallet as it is', () => {
    const sheet = cheatSheet(catalog, example, TODAY)
    expect(sheet.quarter).toBe('Q4 2026')
    expect(
      sheet.rows.map((r) => [r.label, r.cardId, r.effectiveReturnPct]),
    ).toEqual([
      ['Groceries', 'amex-blue-cash-preferred', 6],
      ['Dining', 'amex-gold', 4],
      ['Gas', 'chase-sapphire-preferred', 3],
      ['Amazon', 'chase-prime-visa', 5],
      ['Costco', 'chase-sapphire-preferred', 1],
      ['Travel', 'chase-sapphire-preferred', 2],
      ['Streaming', 'amex-blue-cash-preferred', 6],
      ['Drugstores', 'chase-freedom-flex', 3],
      ['Everything else', 'citi-double-cash', 2],
    ])
    expect(sheet.notes.some((n) => /Freedom Flex.*activated/.test(n))).toBe(
      true,
    )
  })

  test('activating a rotating category changes the sheet', () => {
    const activated = {
      ...example,
      cards: example.cards.map((c) =>
        c.id === 'chase-freedom-flex'
          ? { ...c, activated: ['q4-2026-grocery', 'q4-2026-dining'] }
          : c,
      ),
    }
    const dining = cheatSheet(catalog, activated, TODAY).rows.find(
      (r) => r.label === 'Dining',
    )
    expect(dining?.cardId).toBe('chase-freedom-flex')
    expect(dining?.effectiveReturnPct).toBe(5)
  })

  test('says so when none of the cards work at a store', () => {
    const amexOnly = {
      ...example,
      cards: [{ id: 'amex-gold', cap_usage: {}, activated: [] }],
    }
    const costco = cheatSheet(catalog, amexOnly, TODAY).rows.find(
      (r) => r.label === 'Costco',
    )
    expect(costco?.cardId).toBeNull()
  })
})
