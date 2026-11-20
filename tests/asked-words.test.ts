import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { EVERYDAY_PURCHASES, quickPickText } from '../src/engine/cheat-sheet.ts'
import { ALL_PERSONAL_CARDS, exploreCards } from '../src/engine/explore.ts'
import {
  askedScope,
  askedWords,
  categoryScope,
  categoryTitle,
  categoryTitleMid,
} from '../src/engine/text.ts'
import { resolvePlace } from '../src/merchants/resolve.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()
const place = (text: string) => resolvePlace(catalog, text, null)
const GROCERIES =
  "Ranks purchases at supermarkets; superstores and warehouse clubs don't count."

describe('everyday words for a kind of purchase', () => {
  test.each([
    ['Groceries', 'Groceries', 'groceries'],
    ['groceries', 'Groceries', 'groceries'],
    ['the grocery store', 'Grocery store', 'grocery store'],
    ['eating out', 'Eating out', 'eating out'],
    ['ev', 'EV', 'EV'],
  ])('"%s" titles its answer "%s"', (typed, title, mid) => {
    const m = place(typed)
    expect(m.source).toBe('category')
    expect(categoryTitle(catalog, m)).toBe(title)
    expect(categoryTitleMid(catalog, m)).toBe(mid)
    expect(askedScope(catalog, m)).not.toBeNull()
  })

  test.each(['Supermarkets', 'supermarket', 'Restaurants', 'Travel'])(
    'the category\'s own name "%s" titles itself',
    (typed) => {
      const m = place(typed)
      expect(askedWords(catalog, m)).toBeNull()
      expect(askedScope(catalog, m)).toBeNull()
      expect(categoryTitle(catalog, m)).toBe(
        catalog.categories.find((c) => c.id === m.category)?.name,
      )
    },
  )

  test('a store, and a category answered by its note alone, keep their titles', () => {
    expect(askedWords(catalog, place('Whole Foods'))).toBeNull()
    expect(askedWords(catalog, place('rent'))).toBeNull()
  })

  test('the quick picks that name a category in other words say what it ranks', () => {
    const lines = EVERYDAY_PURCHASES.map((item) => {
      const m = place(quickPickText(item))
      return [categoryTitle(catalog, m), askedScope(catalog, m)]
    }).filter(([, scope]) => scope !== null)
    expect(lines).toEqual([
      ['Groceries', GROCERIES],
      ['Dining', 'Ranks purchases at restaurants.'],
      ['Gas', 'Ranks purchases at gas stations.'],
      ['Drugstores', 'Ranks purchases at drugstores and pharmacies.'],
    ])
  })

  test("a category's scope names what its data excludes", () => {
    expect(categoryScope(catalog, 'grocery.supermarket')).toBe(GROCERIES)
    expect(categoryScope(catalog, 'travel.flights')).toBe(
      'Ranks purchases on flights.',
    )
    expect(categoryScope(catalog, 'other')).toBe('Ranks everyday purchases.')
  })

  test('answers about a category state its scope among their assumptions', () => {
    const r = exploreCards(
      catalog,
      {
        merchant: 'groceries',
        category: null,
        amount: null,
        channel: null,
        date: TODAY,
      },
      { filters: ALL_PERSONAL_CARDS, memberships: [], valuations: {} },
    )
    expect(r.merchant.input).toBe('groceries')
    expect(r.assumptions).toContain(GROCERIES)
  })
})
