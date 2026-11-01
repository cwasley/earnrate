import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import { money } from './text.ts'

export type MembershipCost = {
  id: string
  name: string // "a Costco membership"
  annualFee: number
  cardIds: string[] // the cards that need it
}

// Memberships the person already pays for: the ones they've said, the ones a
// card they hold needs, and the ones their spending shows (only members shop
// at Costco).
export function paidMemberships(
  catalog: Catalog,
  {
    memberships,
    heldCards = [],
    merchantIds = [],
  }: {
    memberships: string[]
    heldCards?: string[]
    merchantIds?: (string | null)[]
  },
): Set<string> {
  const paid = new Set(memberships)
  for (const card of catalog.cards) {
    const m = card.requires_membership
    if (!m) continue
    if (
      heldCards.includes(card.id) ||
      m.members_shop_at.some((id) => merchantIds.includes(id))
    )
      paid.add(m.id)
  }
  return paid
}

// What these cards' memberships add, once each, leaving out the paid ones.
export function membershipCosts(
  cards: Card[],
  paid: Set<string>,
): MembershipCost[] {
  const costs = new Map<string, MembershipCost>()
  for (const card of cards) {
    const m = card.requires_membership
    if (!m || paid.has(m.id)) continue
    const cost = costs.get(m.id) ?? {
      id: m.id,
      name: m.name,
      annualFee: m.annual_fee,
      cardIds: [],
    }
    cost.cardIds.push(card.id)
    costs.set(m.id, cost)
  }
  return [...costs.values()]
}

// The card's membership as a condition, unless it's paid for.
export function membershipNeeded(card: Card, paid: Set<string>): string[] {
  const m = card.requires_membership
  return m && !paid.has(m.id)
    ? [`Needs ${m.name} (${money(m.annual_fee)} a year).`]
    : []
}

export function membershipNote(catalog: Catalog, m: MembershipCost): string {
  const names = m.cardIds.map(
    (id) => catalog.cards.find((c) => c.id === id)?.name ?? id,
  )
  return `${names.join(' and ')} ${names.length === 1 ? 'needs' : 'need'} ${m.name}, ${money(m.annualFee)} a year, counted here like an annual fee. If you're already a member, add it to your memberships.`
}
