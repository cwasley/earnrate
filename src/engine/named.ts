import type { Card, Rule } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Merchant } from '../schema/merchant.ts'
import { inEffect } from './periods.ts'
import type { MerchantResolution } from './types.ts'

// A rule's `named` lists: stores the issuer names as examples of where the
// rule pays (`earning`) or doesn't (`not_earning`).
export const NAMED_LISTS = ['earning', 'not_earning'] as const
export type NamedList = (typeof NAMED_LISTS)[number]

// The evidence id a list's quotes go under: `us-supermarkets.earning`.
export const namedKey = (ruleId: string, list: NamedList) => `${ruleId}.${list}`

// Issuers spell names their own way ("BJ's Club", "7Eleven", "P.F. Chang's"),
// so names compare by letters and digits only, and a name has to fill whole
// words of the quote: "Kroger" is in "Kroger Fuel Center", "Shell" isn't in
// "Shellfish".
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9&]/g, '')
const quoteWords = (quote: string) =>
  quote
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .filter((w) => w !== '')

type Named = Pick<Merchant, 'name' | 'aliases'>
// Where a store's names appear in a quote, as [first word, last word].
type Span = [number, number]

function nameSpans(words: string[], merchant: Named): Span[] {
  const names = [merchant.name, ...merchant.aliases]
    .map(compact)
    .filter((n) => n !== '')
  const spans: Span[] = []
  for (let i = 0; i < words.length; i++) {
    let run = ''
    for (let j = i; j < words.length; j++) {
      run += words[j] ?? ''
      if (names.includes(run)) spans.push([i, j])
      if (!names.some((n) => n.startsWith(run))) break
    }
  }
  return spans
}

export const quoteNames = (quote: string, merchant: Named) =>
  nameSpans(quoteWords(quote), merchant).length > 0

// The words in a quote that name the store and not a longer name around
// them: "XFINITY MOBILE" names Xfinity Mobile, not Comcast Xfinity.
export function quoteNamesAlone(
  quote: string,
  merchant: Named,
  others: readonly Named[],
): Span[] {
  const words = quoteWords(quote)
  const longer = others.flatMap((m) => nameSpans(words, m))
  return nameSpans(words, merchant).filter(
    ([a, b]) => !longer.some(([c, d]) => c <= a && b <= d && d - c > b - a),
  )
}

// The stores a quote names, in its order and in its own spelling ("Pick'n
// Save"), the longest name winning where names overlap.
export function namesInQuote<M extends Named>(
  quote: string,
  merchants: readonly M[],
): { merchant: M; text: string }[] {
  const at: { start: number; end: number }[] = []
  const pattern = /[a-z0-9&]+/gi
  for (let m = pattern.exec(quote); m !== null; m = pattern.exec(quote))
    at.push({ start: m.index, end: m.index + m[0].length })
  const words = quoteWords(quote)
  const found = merchants
    .flatMap((merchant) =>
      nameSpans(words, merchant).map(([a, b]) => ({ merchant, a, b })),
    )
    .sort((x, y) => y.b - y.a - (x.b - x.a) || x.a - y.a)
  const kept: typeof found = []
  for (const f of found)
    if (
      !kept.some((k) => f.a <= k.b && k.a <= f.b) &&
      !kept.some((k) => k.merchant === f.merchant)
    )
      kept.push(f)
  return kept
    .sort((x, y) => x.a - y.a)
    .map(({ merchant, a, b }) => ({
      merchant,
      text: quote
        .slice(at[a]?.start ?? 0, at[b]?.end ?? quote.length)
        .concat(
          quote.slice(at[b]?.end ?? quote.length).startsWith('+') ? '+' : '',
        ),
    }))
}

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
