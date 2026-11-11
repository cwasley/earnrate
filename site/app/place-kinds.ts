import { EVERYDAY_PURCHASES } from '../../src/engine/cheat-sheet.ts'
import {
  categoryReadsOn,
  categorySingular,
  categoryUnranked,
} from '../../src/engine/text.ts'
import type { Catalog } from '../../src/schema/catalog.ts'

// `key` tells apart chips that answer for the same category ("Fast food"
// and "Coffee shop"); a category's own chip is keyed by its id.
export type PlaceKind = { key: string; category: string; label: string }

export const kindCategory = (key: string) => key.split('|')[0] ?? key

// "Gas stations" asks as "Gas station", and "Drugstores and pharmacies" as
// "Drugstore"; a name with no singular the engine reads back as itself.
const kindLabel = (catalog: Catalog, id: string, name: string): string =>
  categorySingular(catalog, id) ?? name

// What a store earnrate doesn't know might be. The quick ones are the
// everyday purchases that are places, each followed by the subcategories
// people search for by name and the places a category names (coffee shops
// are fast food); the rest are every other category a ranking can answer
// for.
export function placeKinds(catalog: Catalog): {
  quick: PlaceKind[]
  more: PlaceKind[]
} {
  const answerable = catalog.categories.filter(
    (c) =>
      c.id !== 'other' &&
      c.page === undefined &&
      !categoryUnranked(catalog, c.id),
  )
  const quickIds = EVERYDAY_PURCHASES.flatMap((item) =>
    'category' in item &&
    item.category !== 'other' &&
    !categoryReadsOn(catalog, item.category)
      ? [
          item.category,
          ...answerable
            .filter(
              (c) =>
                c.id.startsWith(`${item.category}.`) && c.aliases.length > 0,
            )
            .map((c) => c.id),
        ]
      : [],
  )
  const places = (c: Catalog['categories'][number]): PlaceKind[] =>
    (c.places ?? []).map((label) => ({
      key: `${c.id}|${label}`,
      category: c.id,
      label,
    }))
  const more = answerable.filter((c) => !quickIds.includes(c.id))
  return {
    quick: [
      ...quickIds.flatMap((id) => {
        const c = answerable.find((x) => x.id === id)
        return c
          ? [
              {
                key: c.id,
                category: c.id,
                label: kindLabel(catalog, c.id, c.name),
              },
              ...places(c),
            ]
          : []
      }),
      ...more.flatMap(places),
    ],
    more: more.map((c) => ({ key: c.id, category: c.id, label: c.name })),
  }
}
