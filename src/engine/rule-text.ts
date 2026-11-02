import { findMerchant } from '../merchants/resolve.ts'
import type { Card, Rule } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import { categoryPhrase, choiceName, listed, words } from './text.ts'

// What a rule or a pick covers, in words, for answers and wallet lists.

// Travel-site bookings ("Flight through Amex Travel") read mid-sentence in
// lower case and plural; brand names ("Airbnb through Amex Travel") keep theirs.
const BOOKING = /^(Attraction|Car rental|Cruise|Flight|Hotel|Vacation rental)\b/

function merchantName(catalog: Catalog, id: string): string {
  const merchant = findMerchant(catalog, id)
  const name = merchant?.name ?? words(id)
  return merchant?.kind === 'booking'
    ? name.replace(BOOKING, (kind) => `${kind.toLowerCase()}s`)
    : name
}

export function optionName(
  catalog: Catalog,
  card: Card,
  choiceId: string,
  option: string,
): string {
  const o = card.choices.find((c) => c.id === choiceId)?.options[option]
  if (!o) return words(option)
  const parts = [
    ...o.categories.map((c) => categoryPhrase(catalog, c)),
    ...o.merchants.map((m) => merchantName(catalog, m)),
  ]
  if (o.online) parts.push('online shopping')
  return parts.length > 0 ? listed(parts) : words(option)
}

// What a rule covers, as a list of phrases.
export function ruleParts(catalog: Catalog, rule: Rule): string[] {
  if (rule.match.any) return ['everything else']
  if (rule.match.choice !== undefined)
    return [`your ${choiceName(rule.match.choice)} picks`]
  const merchants = rule.match.merchants ?? []
  // A long list of one kind of store reads as "select streaming services".
  const kinds = new Set(
    merchants.map((m) => findMerchant(catalog, m)?.category),
  )
  const [kind] = kinds
  const merchantParts =
    merchants.length > 4 && kinds.size === 1 && kind !== undefined
      ? [`select ${categoryPhrase(catalog, kind)}`]
      : merchants.map((m) => merchantName(catalog, m))
  const parts = [
    ...(rule.match.categories ?? []).map((c) => categoryPhrase(catalog, c)),
    ...merchantParts,
  ]
  return parts.length > 0 ? parts : [words(rule.id)]
}

export function ruleWhat(catalog: Catalog, rule: Rule): string {
  return listed(ruleParts(catalog, rule))
}
