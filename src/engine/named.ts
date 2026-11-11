import type { Card, Rule } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import { inEffect } from './periods.ts'
import type { MerchantResolution } from './types.ts'

// A rule's `named` lists: stores the issuer names as examples of where the
// rule pays (`earning`) or doesn't (`not_earning`).
export const NAMED_LISTS = ['earning', 'not_earning'] as const
export type NamedList = (typeof NAMED_LISTS)[number]

// The evidence id a list's quotes go under: `us-supermarkets.earning`.
export const namedKey = (ruleId: string, list: NamedList) => `${ruleId}.${list}`

export type Naming = { card: Card; rule: Rule; list: NamedList }

// Every rule in effect on `date` whose issuer names the store in a list.
export function namings(
  cards: readonly Card[],
  merchantId: string,
  date: string,
): Naming[] {
  return cards.flatMap((card) =>
    card.rules
      .filter((rule) => inEffect(rule, date))
      .flatMap((rule) =>
        NAMED_LISTS.filter((list) =>
          rule.named?.[list]?.includes(merchantId),
        ).map((list) => ({ card, rule, list })),
      ),
  )
}

// Whether the rule a card earns by here is one whose issuer names the store
// as counting as the store's own category.
export const namesAsItsCategory = (
  rule: Rule | null | undefined,
  merchant: MerchantResolution,
): boolean =>
  merchant.merchantId !== null &&
  (rule?.named?.earning?.includes(merchant.merchantId) ?? false) &&
  (rule?.match.categories?.includes(merchant.category) ?? false)

// The issuers that name the store as counting as its category, each with the
// cards in an answer that earn by such a rule, by name.
export function namedBy(
  catalog: Catalog,
  merchant: MerchantResolution,
  earning: { card: Card; rule: Rule | null | undefined; name: string }[],
): { issuer: string; cards: string[] }[] {
  const byIssuer = new Map<string, string[]>()
  for (const { card, rule, name } of earning)
    if (namesAsItsCategory(rule, merchant))
      byIssuer.set(card.issuer, [...(byIssuer.get(card.issuer) ?? []), name])
  return [...byIssuer].map(([id, cards]) => ({
    issuer: catalog.issuers.find((i) => i.id === id)?.name ?? id,
    cards,
  }))
}
