// Which pages search engines should index: only the ones that say something
// another page doesn't. The rest stay up for visitors, marked noindex and
// left out of the sitemap, and links to them go to the page that answers
// for them, so they come back on their own once the data gives them
// something of their own.
import type { ExploreEntry, Exploration } from '../../src/engine/explore.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Merchant } from '../../src/schema/merchant.ts'
import { hasCodingNotes } from './coding.ts'

const rankingKey = (list: ExploreEntry[]) =>
  list.map((e) => `${e.cardId}:${e.effectiveReturnPct.toFixed(4)}`).join(',')

// How many of a ranking's cards, with their rates, a store's answer is: two
// pages that lead with the same three cards give the same answer.
const ANSWER = 3

// Stores whose only difference from their category is a ranking they share
// with this many others in it (the streaming services one card names) are
// answered by the category page.
const CLUSTER = 4

// Store pages people found in search before this rule (Search Console,
// Nov 1–12 2026: a click or 20 impressions, or 10 with a note or an issuer
// naming the store). They stay indexed whatever the rule says, so a page
// people find doesn't drop out of search.
export const SEARCHED_STORES = new Set([
  'ace-hardware',
  'alamo',
  'american-eagle',
  'boost-mobile',
  'brightline',
  'budget',
  'cabelas',
  'caseys',
  'etsy',
  'hannaford',
  'ihop',
  'jewel-osco',
  'life-time',
  'macys',
  'maggianos',
  'marathon',
  'racetrac',
  'royal-farms',
  'shaws',
  'sprouts',
  'stewarts-shops',
  'trader-joes',
  'twenty-four-hour-fitness',
  'united-supermarkets',
  'volaris',
  'vons',
  'wawa',
  'youtube-premium',
])

export type StoreFacts = {
  merchant: Merchant
  store: Exploration
  // Its category page's ranking, when it has one.
  category: Exploration | undefined
}

export type StoreIndexing = {
  reasons: string[] // what it says of its own; empty when nothing
  indexed: boolean
  // A brand answered by its parent store's page, which links go to.
  parent: string | null
}

// What a store's page says that its category page doesn't. `shown` is the
// ranking a page lists (the store's and its category's, the same way).
export function storeIndexReasons(
  catalog: Catalog,
  facts: StoreFacts,
  shown: (r: Exploration) => ExploreEntry[],
): string[] {
  const { merchant, store, category } = facts
  const id = merchant.id
  const reasons: string[] = []
  if (
    !category ||
    rankingKey(shown(store).slice(0, ANSWER)) !==
      rankingKey(shown(category).slice(0, ANSWER))
  )
    reasons.push('a ranking unlike its category')
  if (store.credits.length > 0) reasons.push('a statement credit there')
  if (catalog.cards.some((c) => c.only_at?.includes(id)))
    reasons.push('a store card')
  if (store.excluded.length > (category?.excluded.length ?? 0))
    reasons.push("cards it doesn't take")
  const rules = catalog.cards.flatMap((c) => c.rules)
  if (
    hasCodingNotes(merchant) &&
    rules.some((r) => r.exclude?.merchants?.includes(id))
  )
    reasons.push("a card's terms leave it out")
  if (
    merchant.brand_of === undefined &&
    rules.some((r) => r.match.merchants?.includes(id))
  )
    reasons.push("a card's terms name it")
  return reasons
}

// Every store page's decision, from its own reasons and the stores around
// it: a brand ranked like its parent store, and a ranking shared by many
// stores in a category, are answered elsewhere.
export function storeIndexing(
  catalog: Catalog,
  stores: StoreFacts[],
  shown: (r: Exploration) => ExploreEntry[],
): Map<string, StoreIndexing> {
  const top = (r: Exploration) => rankingKey(shown(r).slice(0, ANSWER))
  const byId = new Map(stores.map((s) => [s.merchant.id, s]))
  const reasons = new Map(
    stores.map((s) => [s.merchant.id, storeIndexReasons(catalog, s, shown)]),
  )
  const onlyRanking = (id: string) => {
    const r = reasons.get(id) ?? []
    return r.length === 1 && r[0] === 'a ranking unlike its category'
  }
  const clusters = new Map<string, number>()
  const clusterKey = (s: StoreFacts) =>
    `${s.merchant.category}|${rankingKey(shown(s.store))}`
  for (const s of stores)
    if (onlyRanking(s.merchant.id))
      clusters.set(clusterKey(s), (clusters.get(clusterKey(s)) ?? 0) + 1)
  const decisions = new Map<string, StoreIndexing>()
  for (const s of stores) {
    const id = s.merchant.id
    const own = reasons.get(id) ?? []
    const parent =
      s.merchant.brand_of === undefined
        ? undefined
        : byId.get(s.merchant.brand_of)
    const credits = (r: Exploration) =>
      new Set(r.credits.map((c) => `${c.cardId}:${c.creditId}`))
    const parentCredits = parent && credits(parent.store)
    const likeParent =
      parent !== undefined &&
      top(parent.store) === top(s.store) &&
      [...credits(s.store)].every((c) => parentCredits?.has(c))
    const clustered =
      onlyRanking(id) && (clusters.get(clusterKey(s)) ?? 0) >= CLUSTER
    const searched = SEARCHED_STORES.has(id)
    decisions.set(id, {
      reasons: searched ? [...own, 'people find it in search'] : own,
      indexed: searched || (own.length > 0 && !likeParent && !clustered),
      parent: likeParent ? parent.merchant.id : null,
    })
  }
  // A brand's link goes to its parent's page only when that page is indexed.
  for (const [id, d] of decisions)
    if (d.parent !== null && decisions.get(d.parent)?.indexed !== true)
      decisions.set(id, { ...d, parent: null })
  return decisions
}

// A category page is indexed when its answer isn't everyday spending's: a
// ranking of its own, or lines of its own (a business card that earns more
// there than any personal card, stores it answers for whose top cards
// differ). A page that's only a note (rent) has no answer to rank.
export function categoryIndexed(
  category: Exploration,
  everyday: Exploration | undefined,
  shown: (r: Exploration) => ExploreEntry[],
  ownLines: boolean,
): boolean {
  if (category.categoryNote !== null || shown(category).length === 0)
    return false
  if (!everyday || category === everyday) return true
  return ownLines || rankingKey(shown(category)) !== rankingKey(shown(everyday))
}

// Where a link to a store's page goes. A store page that isn't indexed says
// nothing its category page (or, for a brand, its parent store's page)
// doesn't, so links go there instead: search engines then spend their visits
// on pages they keep.
export const storeHref = (
  slug: string,
  indexed: boolean,
  categorySlug: string | null,
  parent: string | null = null,
) =>
  indexed
    ? `/best/${slug}`
    : parent !== null
      ? `/best/${parent}`
      : categorySlug === null
        ? `/best/${slug}`
        : `/best/${categorySlug}#${slug}`
