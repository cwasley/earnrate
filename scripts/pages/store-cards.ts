// A store's own credit cards in the catalog: its store card, or a card named
// for it (or for the chain it's a brand of) whose terms name the store. The
// catalog holds only some cards, so finding none says nothing about whether
// the store has one.
import type { Card } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Merchant } from '../../src/schema/merchant.ts'
import { findMerchant } from '../../src/merchants/resolve.ts'

const wordsOf = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `

export type OwnCards = {
  owner: string // "Kohl's", or "IHG Hotels & Resorts" for Holiday Inn Express
  cards: Card[]
}

export function ownCards(
  catalog: Catalog,
  merchant: Merchant,
): OwnCards | null {
  const parent =
    merchant.brand_of === undefined
      ? null
      : (findMerchant(catalog, merchant.brand_of) ?? null)
  const ids = [merchant.id, ...(parent ? [parent.id] : [])]
  const names = [merchant, ...(parent ? [parent] : [])].flatMap((m) => [
    m.name,
    ...m.aliases,
  ])
  const cards = catalog.cards.filter((c) => {
    if (c.business) return false
    const termsNameIt =
      c.only_at?.some((id) => ids.includes(id)) ||
      [...c.rules, ...c.credits].some((r) =>
        r.match.merchants?.some((id) => ids.includes(id)),
      )
    return (
      termsNameIt && names.some((n) => wordsOf(c.name).includes(wordsOf(n)))
    )
  })
  if (cards.length === 0) return null
  const ownedByParent =
    parent !== null &&
    !cards.some((c) =>
      [merchant.name, ...merchant.aliases].some((n) =>
        wordsOf(c.name).includes(wordsOf(n)),
      ),
    )
  return { owner: ownedByParent ? parent.name : merchant.name, cards }
}
