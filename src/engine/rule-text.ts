import { findMerchant } from '../merchants/resolve.ts'
import type { Card, Credit, IntroRate, Rule } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import {
  categoryPhrase,
  choiceName,
  earnText,
  introPeriod,
  listed,
  num,
  PAYMENT_PHRASES,
  words,
} from './text.ts'

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
  if (rule.match.any)
    return [
      rule.geography === 'foreign_only'
        ? 'purchases outside the U.S.'
        : rule.requires?.payment !== undefined
          ? 'purchases'
          : 'everything else',
    ]
  if (rule.match.choice !== undefined)
    return [`your ${choiceName(rule.match.choice)} picks`]
  const merchants = rule.match.merchants ?? []
  // A long list of mostly one kind of store reads as "select streaming
  // services": Amex's streaming list also names Audible, which isn't one.
  const counts = new Map<string, number>()
  for (const m of merchants) {
    const category = findMerchant(catalog, m)?.category
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  const [kind, count = 0] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? []
  const merchantParts =
    merchants.length > 4 &&
    kind !== undefined &&
    count >= merchants.length * 0.75
      ? [`select ${categoryPhrase(catalog, kind)}`]
      : merchants.map((m) => merchantName(catalog, m))
  const parts = [
    ...(rule.match.categories ?? []).map((c) => categoryPhrase(catalog, c)),
    ...merchantParts,
  ]
  return parts.length > 0 ? parts : [words(rule.id)]
}

export function ruleWhat(catalog: Catalog, rule: Rule): string {
  const payment = rule.requires?.payment
  const what = listed(ruleParts(catalog, rule))
  return payment === undefined ? what : `${what} ${PAYMENT_PHRASES[payment]}`
}

// "double every rate for the first year", "an extra 3% cash back on your 3%
// picks for the first year".
export function introWhat(
  catalog: Catalog,
  card: Card,
  intro: IntroRate,
): string {
  const covered = card.rules.filter((r) => intro.rules?.includes(r.id))
  const on =
    intro.rules === undefined
      ? 'every rate'
      : [...new Set(covered.map((r) => ruleWhat(catalog, r)))].join('; ')
  const change =
    intro.multiply === undefined
      ? `an extra ${earnText(catalog, intro.add ?? 0, card.currency)} on ${on}`
      : intro.multiply === 2
        ? `double ${on}`
        : `${num(intro.multiply)} times ${on}`
  return `${change} for the ${introPeriod(intro.days)}`
}

// What a merchant credit is named for: "Lululemon", "Disney+, Hulu and ESPN".
export const creditName = (catalog: Catalog, credit: Credit) =>
  listed([
    ...(credit.match.merchants ?? []).map((m) => merchantName(catalog, m)),
    ...(credit.match.categories ?? []).map((c) => categoryPhrase(catalog, c)),
  ])
