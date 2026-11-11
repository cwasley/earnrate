import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { QUICK_CARDS } from '../site/app/quick-cards.ts'

describe("My wallet's tap-to-add cards", () => {
  test('every one is a personal card earnrate knows, listed once', async () => {
    const catalog = await loadCatalog()
    for (const id of QUICK_CARDS) {
      const card = catalog.cards.find((c) => c.id === id)
      expect(card, id).toBeDefined()
      expect(card?.business, id).toBe(false)
    }
    expect(new Set(QUICK_CARDS).size).toBe(QUICK_CARDS.length)
  })

  test('the list stays short enough to scan on a phone', () => {
    expect(QUICK_CARDS.length).toBeGreaterThanOrEqual(12)
    expect(QUICK_CARDS.length).toBeLessThanOrEqual(18)
  })
})
