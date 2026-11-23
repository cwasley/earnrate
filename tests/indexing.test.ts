import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  type Exploration,
} from '../src/engine/explore.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import type { Merchant } from '../src/schema/merchant.ts'
import {
  categoryIndexed,
  SEARCHED_STORES,
  storeHref,
  storeIndexing,
  type StoreFacts,
} from '../scripts/pages/indexing.ts'
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

const merchants = (c: Catalog) => {
  const byId = new Map<string, Merchant>()
  for (const m of [...c.merchants.seed, ...c.merchants.overrides])
    byId.set(m.id, m)
  return [...byId.values()].filter((m) => m.kind !== 'booking')
}

function decide(c: Catalog) {
  const pageOf = (id: string) =>
    c.categories.find((x) => x.id === id)?.page ?? id
  const categories = new Map<string, Exploration>()
  const facts: StoreFacts[] = merchants(c).map((m) => {
    const id = pageOf(m.category)
    let category = categories.get(id)
    if (!category) {
      category = explore(c, null, id)
      categories.set(id, category)
    }
    return { merchant: m, store: explore(c, m.name, null), category }
  })
  return storeIndexing(c, facts, top)
}

const decisions = decide(catalog)
const indexed = (id: string) => decisions.get(id)?.indexed

const withMerchant = (id: string, change: Partial<Merchant>): Catalog => ({
  ...catalog,
  merchants: {
    seed: catalog.merchants.seed.map((m) =>
      m.id === id ? { ...m, ...change } : m,
    ),
    overrides: catalog.merchants.overrides.map((m) =>
      m.id === id ? { ...m, ...change } : m,
    ),
  },
})

describe('which store pages are indexed', () => {
  test('a store whose answer is its category page’s, with nothing of its own, is not', () => {
    expect(decisions.get('stater-bros')).toMatchObject({
      reasons: [],
      indexed: false,
    })
    // An issuer naming it among its example stores doesn't change its answer.
    expect(indexed('aldi')).toBe(false)
    expect(indexed('chevron')).toBe(false)
  })

  test('a store with an answer of its own, a credit, a store card, or cards it refuses is', () => {
    expect(decisions.get('costco')?.reasons).toEqual(
      expect.arrayContaining([
        "cards it doesn't take",
        'a ranking unlike its category',
      ]),
    )
    expect(indexed('costco')).toBe(true)
    expect(decisions.get('lululemon')?.reasons).toContain(
      'a statement credit there',
    )
    expect(indexed('amazon')).toBe(true)
    expect(indexed('walmart')).toBe(true)
  })

  test("a store a card's own rule names for its rate is", () => {
    for (const id of ['netflix', 'delta', 'marriott'])
      expect(decisions.get(id)?.reasons, id).toContain("a card's terms name it")
    expect(indexed('netflix')).toBe(true)
  })

  test("a brand ranked like its parent store is answered by the parent's page", () => {
    expect(decisions.get('hampton-inn')).toMatchObject({
      indexed: false,
      parent: 'hilton',
    })
    expect(indexed('hilton')).toBe(true)
    expect(storeHref('hampton-inn', false, 'hotel', 'hilton')).toBe(
      '/best/hilton',
    )
    // The resort credit is the Hilton resorts' own, so they keep their page.
    expect(decisions.get('hilton-resorts')).toMatchObject({
      indexed: true,
      parent: null,
    })
  })

  test('many stores that differ from their category in only one shared ranking are answered by the category page', () => {
    expect(decisions.get('gap')).toMatchObject({
      reasons: ['a ranking unlike its category'],
      indexed: false,
      parent: null,
    })
    expect(storeHref('gap', false, 'clothes')).toBe('/best/clothes#gap')
  })

  test('a store page people found in search stays indexed', () => {
    for (const id of SEARCHED_STORES) {
      expect(
        merchants(catalog).some((m) => m.id === id),
        id,
      ).toBe(true)
      expect(indexed(id), id).toBe(true)
    }
    expect(decisions.get('trader-joes')?.reasons).toContain(
      'people find it in search',
    )
  })

  test('a store page indexes itself once the data gives it something of its own', () => {
    const card = catalog.cards.find((c) => c.id === 'citi-double-cash')
    if (!card) throw new Error('no citi-double-cash')
    const named: Catalog = {
      ...catalog,
      cards: catalog.cards.map((c) =>
        c.id === card.id
          ? {
              ...c,
              rules: [
                ...c.rules,
                {
                  ...(c.rules[0] ?? ({} as never)),
                  id: 'stater-bros-test',
                  match: { merchants: ['stater-bros'] },
                },
              ],
            }
          : c,
      ),
    }
    const decided = decide(named).get('stater-bros')
    expect(decided?.reasons).toContain("a card's terms name it")
    expect(decided?.indexed).toBe(true)
    const noted = withMerchant('stater-bros', {
      note: 'Some locations take only debit.',
    })
    expect(decide(noted).get('stater-bros')?.indexed).toBe(false)
  }, 60_000)

  test('the indexed store pages stay a fraction of all of them', () => {
    const n = [...decisions.values()].filter((d) => d.indexed).length
    expect(n).toBeGreaterThan(100)
    expect(n).toBeLessThan(220)
  })
})

describe('which category pages are indexed', () => {
  const everyday = explore(catalog, null, 'other')
  test('a category ranked like everyday spending is not, unless it has lines of its own', () => {
    const superstore = explore(catalog, null, 'superstore')
    expect(categoryIndexed(superstore, everyday, top, false)).toBe(false)
    expect(categoryIndexed(superstore, everyday, top, true)).toBe(true)
    expect(
      categoryIndexed(explore(catalog, null, 'dining'), everyday, top, false),
    ).toBe(true)
    expect(categoryIndexed(everyday, everyday, top, false)).toBe(true)
  })

  test('a category that is only a note is not', () => {
    expect(
      categoryIndexed(explore(catalog, null, 'housing'), everyday, top, true),
    ).toBe(false)
  })
})
