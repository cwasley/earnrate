import { findCategory } from '../../src/merchants/resolve.ts'
import { EVERYDAY_PURCHASES } from '../../src/engine/cheat-sheet.ts'
import { categoryReadsOn, categoryUnranked } from '../../src/engine/text.ts'
import type { Catalog } from '../../src/schema/catalog.ts'

export type PlaceKind = { category: string; label: string }

// "Gas stations" asks as "Gas station", and "Drugstores and pharmacies" as
// "Drugstore", but only when the engine reads that word back as the same
// category; otherwise the category's own name.
function kindLabel(catalog: Catalog, id: string, name: string): string {
  const first = name.split(' and ')[0] ?? name
  const one = /[^s]s$/.test(first) ? first.slice(0, -1) : first
  return findCategory(catalog, one) === id ? one : name
}

// What a store earnrate doesn't know might be. The quick ones are the
// everyday purchases that are places, each followed by the subcategories
// people search for by name (coffee shops are fast food); the rest are every
// other category a ranking can answer for.
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
  const kind = (c: Catalog['categories'][number], label: string) => ({
    category: c.id,
    label,
  })
  return {
    quick: quickIds.flatMap((id) => {
      const c = answerable.find((x) => x.id === id)
      return c ? [kind(c, kindLabel(catalog, c.id, c.name))] : []
    }),
    more: answerable
      .filter((c) => !quickIds.includes(c.id))
      .map((c) => kind(c, c.name)),
  }
}
