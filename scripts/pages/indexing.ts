// Which store pages search engines should index: only the ones that say
// something about the store its category page doesn't. The rest stay up for
// visitors, marked noindex and left out of the sitemap, and come back on
// their own once the data gives them something of their own.
import type { ExploreEntry, Exploration } from '../../src/engine/explore.ts'
import { namings } from '../../src/engine/named.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Merchant } from '../../src/schema/merchant.ts'
import { hasCodingNotes } from './coding.ts'

const rankingKey = (list: ExploreEntry[]) =>
  list.map((e) => `${e.cardId}:${e.effectiveReturnPct.toFixed(4)}`).join(',')

// Why a store page is worth indexing; empty when it isn't. `shown` is the
// ranking a page lists (the store's and its category's, the same way).
export function storeIndexReasons(
  catalog: Catalog,
  merchant: Merchant,
  store: Exploration,
  category: Exploration | undefined,
  shown: (r: Exploration) => ExploreEntry[],
  today: string,
): string[] {
  const reasons: string[] = []
  if (hasCodingNotes(merchant)) reasons.push('notes on how it codes')
  if (store.credits.length > 0) reasons.push('a statement credit there')
  if (catalog.cards.some((c) => c.only_at?.includes(merchant.id)))
    reasons.push('a store card')
  if (
    catalog.cards.some((c) =>
      c.rules.some(
        (r) =>
          r.match.merchants?.includes(merchant.id) ||
          r.exclude?.merchants?.includes(merchant.id),
      ),
    )
  )
    reasons.push("a card's terms name it")
  const open = catalog.cards.filter((c) => c.applications_closed === undefined)
  if (namings(open, merchant.id, today).length > 0)
    reasons.push("an issuer's list of example stores names it")
  if (store.excluded.length > (category?.excluded.length ?? 0))
    reasons.push("cards it doesn't take")
  if (!category || rankingKey(shown(store)) !== rankingKey(shown(category)))
    reasons.push('a ranking unlike its category')
  return reasons
}
