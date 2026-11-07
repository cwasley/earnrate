import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  type Exploration,
} from '../src/engine/explore.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import type { Merchant } from '../src/schema/merchant.ts'
import { storeIndexReasons } from '../scripts/pages/indexing.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()
const options = { filters: ALL_PERSONAL_CARDS, memberships: [], valuations: {} }
const top = (r: Exploration) => r.ranked.slice(0, 10)

const explore = (
  c: Catalog,
  merchant: string | null,
  category: string | null,
) =>
  exploreCards(
    c,
    { merchant, category, amount: null, channel: null, date: TODAY },
    options,
  )

function reasons(c: Catalog, id: string): string[] {
  const merchant = [...c.merchants.overrides, ...c.merchants.seed].find(
    (m) => m.id === id,
  )
  if (!merchant) throw new Error(`no merchant ${id}`)
  return storeIndexReasons(
    c,
    merchant,
    explore(c, merchant.name, null),
    explore(c, null, merchant.category),
    top,
  )
}

const withMerchant = (id: string, change: Partial<Merchant>): Catalog => ({
  ...catalog,
  merchants: {
    ...catalog.merchants,
    seed: catalog.merchants.seed.map((m) =>
      m.id === id ? { ...m, ...change } : m,
    ),
  },
})

describe('which store pages are indexed', () => {
  test('a store ranked like its category, with nothing of its own, is not', () => {
    expect(reasons(catalog, 'aldi')).toEqual([])
  })

  test('a store with notes, a credit or cards it refuses is', () => {
    expect(reasons(catalog, 'costco')).toEqual(
      expect.arrayContaining([
        'notes on how it codes',
        "cards it doesn't take",
        'a ranking unlike its category',
      ]),
    )
    expect(reasons(catalog, 'lululemon')).toContain('a statement credit there')
  })

  test('a store page indexes itself once the data says something about it', () => {
    expect(
      reasons(
        withMerchant('aldi', { note: 'Some locations take only debit.' }),
        'aldi',
      ),
    ).toEqual(['notes on how it codes'])
  })
})
