import { findMerchant } from '../merchants/resolve.ts'
import type { Card, Credit, IntroRate, Rule } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import {
  categoryPhrase,
  categoryReadsOn,
  choiceName,
  earnText,
  introPeriod,
  listed,
  num,
  PAYMENT_PHRASES,
  PICK_PERIODS,
  words,
} from './text.ts'

// What a rule or a pick covers, in words, for answers and wallet lists.

// Travel-site bookings ("Flight through Amex Travel") read mid-sentence in
// lower case and plural; brand names ("Airbnb through Amex Travel") keep theirs.
const BOOKING =
  /^(Activity|Attraction|Car rental|Cruise|Flight|Hotel|Vacation rental)\b/

const plural = (kind: string) =>
  kind === 'Activity' ? 'activities' : `${kind.toLowerCase()}s`

function merchantName(catalog: Catalog, id: string): string {
  const merchant = findMerchant(catalog, id)
  const name = merchant?.name ?? words(id)
  return merchant?.kind === 'booking' ? name.replace(BOOKING, plural) : name
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

// What a rule covers, as a list of phrases. With the card, a pick reads
// "the 2 categories you pick each quarter" and a rule for every purchase reads
// "every purchase" when it's the card's only one.
export function ruleParts(
  catalog: Catalog,
  rule: Rule,
  card?: Pick<Card, 'rules' | 'choices'>,
  { everyStore = false }: { everyStore?: boolean } = {},
): string[] {
  const m = rule.match
  if (m.any)
    return [
      rule.geography === 'foreign_only'
        ? 'purchases outside the U.S.'
        : rule.requires?.payment !== undefined
          ? 'purchases'
          : card?.rules.every((r) => r.match.any)
            ? 'every purchase'
            : 'everything else',
    ]
  if (m.choice !== undefined) {
    const choice = card?.choices.find((c) => c.id === m.choice)
    if (!choice) return [`your ${choiceName(m.choice)} picks`]
    const which =
      choice.pick === 1
        ? 'the category'
        : `the ${String(choice.pick)} categories`
    return [
      `${which} you pick${choice.period === 'until_changed' ? '' : ` ${PICK_PERIODS[choice.period]}`}`,
    ]
  }
  const merchants = m.merchants ?? []
  const categories = (m.categories ?? []).map((c) => categoryPhrase(catalog, c))
  const merchantParts =
    (everyStore ? null : shortenedMerchants(catalog, merchants)) ??
    merchants.map((id) => merchantName(catalog, id))
  // A rule naming both matches a purchase that is both.
  if (merchants.length > 0 && categories.length > 0)
    return [`${listed(merchantParts)} when it codes as ${listed(categories)}`]
  const parts = [...categories, ...(merchants.length > 0 ? merchantParts : [])]
  if (parts.length > 0) return parts
  return m.mccs?.length
    ? [`purchases coded MCC ${m.mccs.map(String).join(', ')}`]
    : [words(rule.id)]
}

// A long list of mostly one kind of store reads as "select streaming
// services": Amex's streaming list also names Audible, which isn't one.
// Null when the list is read out in full.
function shortenedKind(catalog: Catalog, merchants: string[]): string | null {
  const counts = new Map<string, number>()
  for (const id of merchants) {
    const category = findMerchant(catalog, id)?.category
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  const [kind, count = 0] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? []
  return merchants.length > 4 &&
    kind !== undefined &&
    count >= merchants.length * 0.75
    ? kind
    : null
}

export function shortenedMerchants(
  catalog: Catalog,
  merchants: string[],
): string[] | null {
  const kind = shortenedKind(catalog, merchants)
  return kind === null ? null : [`select ${categoryPhrase(catalog, kind)}`]
}

export function ruleWhat(
  catalog: Catalog,
  rule: Rule,
  card?: Pick<Card, 'rules' | 'choices'>,
  options: { everyStore?: boolean } = {},
): string {
  const payment = rule.requires?.payment
  const what = listed(ruleParts(catalog, rule, card, options))
  return payment === undefined ? what : `${what} ${PAYMENT_PHRASES[payment]}`
}

// "on dining", "on your picks", "at Costco", "on Walmart+ membership": a
// category's own preposition, "at" for a store unless its data says "on" or
// it's a booking through a travel site ("on hotels through Amex Travel"), and
// a shortened list ("select streaming services") reads like its kind.
export function rulePreposition(catalog: Catalog, rules: Rule[]): 'on' | 'at' {
  const readsOn = (r: Rule) => {
    if (r.match.any === true || r.match.choice !== undefined) return true
    const merchants = r.match.merchants ?? []
    const kind = shortenedKind(catalog, merchants)
    return (
      (r.match.categories ?? []).every((c) => categoryReadsOn(catalog, c)) &&
      (kind !== null
        ? categoryReadsOn(catalog, kind)
        : merchants.every((id) => {
            const merchant = findMerchant(catalog, id)
            return (
              merchant?.preposition === 'on' || merchant?.kind === 'booking'
            )
          }))
    )
  }
  return rules.length > 0 && rules.every(readsOn) ? 'on' : 'at'
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
      : [...new Set(covered.map((r) => ruleWhat(catalog, r, card)))].join('; ')
  const change =
    intro.multiply === undefined
      ? `an extra ${earnText(catalog, intro.add ?? 0, card.currency)} on ${on}`
      : intro.multiply === 2
        ? `double ${on}`
        : `${num(intro.multiply)} times ${on}`
  return `${change} for the ${introPeriod(intro.days)}`
}

// What a merchant credit is named for: "Lululemon", "Disney+, Hulu and ESPN".
// Bookings through a travel site the credit also names go without saying:
// "Capital One Travel", not each kind of booking through it.
export function creditName(catalog: Catalog, credit: Credit): string {
  const ids = credit.match.merchants ?? []
  const portals = ids
    .map((m) => findMerchant(catalog, m))
    .filter((m) => m?.kind === 'portal')
    .map((m) => ` through ${m?.name ?? ''}`)
  const merchants = ids.filter((m) => {
    const merchant = findMerchant(catalog, m)
    return !(
      merchant?.kind === 'booking' &&
      portals.some((p) => merchant.name.endsWith(p))
    )
  })
  return listed([
    ...merchants.map((m) => merchantName(catalog, m)),
    ...(credit.match.categories ?? []).map((c) => categoryPhrase(catalog, c)),
  ])
}

// A short name for a list of credits: the first store a credit names
// ("Grubhub" for the dining credit at five chains); creditName has them all.
export function creditLabel(catalog: Catalog, credit: Credit): string {
  const [first, ...more] = credit.match.merchants ?? []
  return first === undefined || more.length === 0
    ? creditName(catalog, credit)
    : merchantName(catalog, first)
}

// "at Lululemon", "at restaurants", "on travel", "on Walmart+ membership":
// the category's or merchant's own preposition.
export const creditWhere = (catalog: Catalog, credit: Credit) =>
  `${
    (credit.match.categories ?? []).some((c) => categoryReadsOn(catalog, c)) ||
    (credit.match.merchants ?? []).some(
      (m) => findMerchant(catalog, m)?.preposition === 'on',
    )
      ? 'on'
      : 'at'
  } ${creditName(catalog, credit)}`
