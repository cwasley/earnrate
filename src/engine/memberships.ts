import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Membership } from '../schema/membership.ts'
import { listed, money, withArticle, words } from './text.ts'

export type MembershipCost = {
  id: string
  name: string // "Costco membership"
  annualFee: number
  cardIds: string[] // the cards that need it
}

export function membership(
  catalog: Catalog,
  id: string,
): Membership | undefined {
  return catalog.memberships.find((m) => m.id === id)
}

export function membershipName(catalog: Catalog, id: string): string {
  return membership(catalog, id)?.name ?? words(id)
}

// Tiers of one membership: holding one, the others in its group aren't
// missing (BofA Preferred Rewards).
export function sameGroup(catalog: Catalog, a: string, b: string): boolean {
  const group = membership(catalog, a)?.group
  return group !== undefined && group === membership(catalog, b)?.group
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
    const id = card.requires_membership
    if (id !== undefined && heldCards.includes(card.id)) paid.add(id)
  }
  for (const m of catalog.memberships)
    if (m.members_shop_at.some((id) => merchantIds.includes(id))) paid.add(m.id)
  return paid
}

// What these cards' memberships add, once each, leaving out the paid ones.
export function membershipCosts(
  catalog: Catalog,
  cards: Card[],
  paid: Set<string>,
): MembershipCost[] {
  const costs = new Map<string, MembershipCost>()
  for (const card of cards) {
    const m =
      card.requires_membership === undefined
        ? undefined
        : membership(catalog, card.requires_membership)
    if (!m || paid.has(m.id)) continue
    const cost = costs.get(m.id) ?? {
      id: m.id,
      name: m.name,
      annualFee: m.annual_fee ?? 0,
      cardIds: [],
    }
    cost.cardIds.push(card.id)
    costs.set(m.id, cost)
  }
  return [...costs.values()]
}

// "a Costco membership ($65 a year)"
export function membershipText(catalog: Catalog, id: string): string {
  const m = membership(catalog, id)
  const name = withArticle(m?.name ?? words(id))
  return m?.annual_fee === undefined
    ? name
    : `${name} (${money(m.annual_fee)} a year)`
}

// The card's membership as a condition, unless it's paid for.
export function membershipNeeded(
  catalog: Catalog,
  card: Card,
  paid: Set<string>,
): string[] {
  const id = card.requires_membership
  return id !== undefined && !paid.has(id)
    ? [`Needs ${membershipText(catalog, id)}.`]
    : []
}

export function membershipNote(catalog: Catalog, m: MembershipCost): string {
  const names = m.cardIds.map(
    (id) => catalog.cards.find((c) => c.id === id)?.name ?? id,
  )
  return `${listed(names)} ${names.length === 1 ? 'needs' : 'need'} ${withArticle(m.name)}, ${money(m.annualFee)} a year, counted here like an annual fee. If you're already a member, add it to your memberships.`
}
