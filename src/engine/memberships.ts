import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Membership } from '../schema/membership.ts'
import { money, withArticle, words } from './text.ts'

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

// The memberships a person has: the ones they've said, plus the one each of
// their cards can't be held without (a Costco membership for Costco
// Anywhere). Gates a rule's `requires.membership` as well as fees. Only the
// person's own cards (or those named for an answer) belong in `cardIds`.
export function effectiveMemberships(
  catalog: Catalog,
  memberships: string[],
  cardIds: string[],
): string[] {
  const out = new Set(memberships)
  for (const card of catalog.cards) {
    const id = card.requires_membership
    if (id !== undefined && cardIds.includes(card.id)) out.add(id)
  }
  return [...out]
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
  const paid = new Set(effectiveMemberships(catalog, memberships, heldCards))
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
  return m?.annual_fee === undefined || m.annual_fee === 0
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

// The membership a card can't be had without, unless the person has it.
// When every card is ranked, such a card ranks apart, named after the
// ranking: most people can't get it.
export function missingMembership(
  card: Pick<Card, 'requires_membership'>,
  has: Set<string>,
): string | null {
  const id = card.requires_membership
  return id !== undefined && !has.has(id) ? id : null
}

// The members-only results that would have placed among the first `n` of
// `ranked`; `better` is negative when its first argument ranks higher.
export function placedAmong<T, U>(
  membersOnly: T[],
  ranked: U[],
  n: number,
  better: (a: T, b: U) => number,
): T[] {
  const last = ranked[n - 1]
  return membersOnly.filter((m) => last === undefined || better(m, last) < 0)
}

export const NO_MEMBERSHIPS =
  'Assumes no memberships (like Amazon Prime). Cards and rates that need one are listed separately.'

// "If you have a Verizon wireless or Fios account: Verizon Visa Card, 4%."
// One line per membership, in the order first named.
export function ifMemberLines(
  catalog: Catalog,
  items: { membership: string; text: string }[],
): string[] {
  const grouped = new Map<string, string[]>()
  for (const { membership: id, text } of items) {
    const texts = grouped.get(id) ?? []
    if (!texts.includes(text)) texts.push(text)
    grouped.set(id, texts)
  }
  return [...grouped].map(
    ([id, texts]) =>
      `If you have ${withArticle(membershipName(catalog, id))}: ${texts.join('; ')}.`,
  )
}

// The site's checkbox for a membership: its own question, or, for one a
// card needs, "I have a Verizon wireless or Fios account".
export function askText(catalog: Catalog, m: Membership): string | null {
  if (m.ask !== undefined) return m.ask
  return catalog.cards.some((c) => c.requires_membership === m.id)
    ? `I have ${withArticle(m.name)}`
    : null
}
