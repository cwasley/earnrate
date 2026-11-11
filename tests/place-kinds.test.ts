import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { findCategory } from '../src/merchants/resolve.ts'
import { placeKinds } from '../site/app/place-kinds.ts'

describe('kinds of place for an unknown store', () => {
  test('the quick ones are everyday places, named in words the engine reads back', async () => {
    const catalog = await loadCatalog()
    const { quick } = placeKinds(catalog)
    expect(quick.map((k) => k.label)).toEqual([
      'Supermarket',
      'Restaurant',
      'Fast food',
      'Gas station',
      'Drugstore',
    ])
    for (const k of quick)
      expect(findCategory(catalog, k.label), k.label).toBe(k.category)
  })

  test('the rest offer every other category a ranking answers, once each', async () => {
    const catalog = await loadCatalog()
    const { quick, more } = placeKinds(catalog)
    const offered = [...quick, ...more].map((k) => k.category)
    expect(new Set(offered).size).toBe(offered.length)
    expect(offered).toContain('travel.hotels')
    expect(offered).toContain('convenience_store')
    expect(offered).not.toContain('other')
    expect(offered).not.toContain('housing')
    expect(offered).not.toContain('grocery')
    for (const k of more)
      expect(k.label).toBe(
        catalog.categories.find((c) => c.id === k.category)?.name,
      )
  })
})
