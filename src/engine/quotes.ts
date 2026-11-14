import { findMerchant } from '../merchants/resolve.ts'
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'

type Quote = Card['evidence'][number]

// Wording that leaves something out of a rule.
export const EXCLUSION =
  /\bexclud|\bnot at\b|\bnot (be )?(included|eligible|count|qualify)|\bdo(es)? not\b|\bdon['’]t\b|\bisn['’]t\b|\baren['’]t\b|\bwon['’]t\b|\bexcept\b|\bmay not\b/i

// Wording that pays less, which isn't the bonus being backed.
const LESS = /\bwill not\b|\bonly (get|earn)\b|\bearn only\b/i

const ABROAD = /\binternational\b|\bforeign\b|\boutside (of )?the U\.?S\b/i

// Words too common in terms to show a quote is about the store.
const COMMON = new Set(['service', 'store', 'purchase', 'card', 'other'])

const word = (w: string) => w.toLowerCase().replace(/s$/, '')

const keyWords = (texts: string[]) =>
  new Set(
    texts
      .join(' ')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 5)
      .map(word),
  )

// A name as a whole word or phrase, plural or not, so "gap" isn't found in
// "mortgage".
const mentions = (text: string, name: string) =>
  new RegExp(
    `(?<![a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?![a-z0-9])`,
    'i',
  ).test(text)

function merchantNames(catalog: Catalog, id: string): string[] {
  const m = findMerchant(catalog, id)
  return m ? [m.name, ...m.aliases].map((n) => n.toLowerCase()) : []
}

// The quote that best backs a rule paying at a store, or on the category it
// counts as: the first naming the store, else the first naming the category,
// else the first. Never one that leaves something out (in so many words, by
// naming a store or category the rule excludes, or by listing what the rule's
// note says doesn't count), unless the rule has no other.
export function supportingQuote(
  catalog: Catalog,
  card: Card,
  ruleId: string,
  at: { merchantId?: string | null; category?: string | null } = {},
): Quote | null {
  const quotes = card.evidence.filter((e) => e.rule === ruleId)
  if (quotes.length <= 1) return quotes[0] ?? null
  const rule = card.rules.find((r) => r.id === ruleId)
  const leftOut = [
    ...[
      ...(rule?.exclude?.merchants ?? []),
      ...(rule?.named?.not_earning ?? []),
    ].flatMap((id) => merchantNames(catalog, id)),
    ...catalog.categories
      .filter((c) => rule?.exclude?.categories?.includes(c.id))
      .flatMap((c) => [c.name, ...c.aliases])
      .map((n) => n.toLowerCase().replace(/s$/, '')),
  ]
  const sentences = (rule?.note ?? '').split(/(?<=\.)\s+/)
  const outWords = keyWords(sentences.filter((t) => EXCLUSION.test(t)))
  const inWords = keyWords(sentences.filter((t) => !EXCLUSION.test(t)))
  const noted = (q: string) => {
    const ws = [...keyWords([q])]
    const out = ws.filter((w) => outWords.has(w)).length
    return out >= 3 && out > ws.filter((w) => inWords.has(w)).length
  }
  const excludes = (q: string) =>
    EXCLUSION.test(q) ||
    LESS.test(q) ||
    (rule?.geography === 'us_only' && ABROAD.test(q)) ||
    leftOut.some((n) => mentions(q, n)) ||
    noted(q)
  const earning = quotes.filter((q) => !excludes(q.quote))
  if (earning.length === 0) return quotes[0] ?? null
  const store = at.merchantId ? merchantNames(catalog, at.merchantId) : []
  const category = catalog.categories.find((c) => c.id === at.category)
  // The category's own name; aliases ("trains" for transit) are loose enough
  // to find a list of what it leaves out.
  const topic = new Set(
    (category?.name ?? '')
      .split(/[^a-z]+/i)
      .map(word)
      .filter((w) => w.length >= 4 && !COMMON.has(w)),
  )
  const tier = (q: string) => {
    if (store.some((n) => mentions(q, n))) return 2
    const words = q
      .toLowerCase()
      .split(/[^a-z]+/)
      .map(word)
    return words.some((w) => topic.has(w)) ? 1 : 0
  }
  const top = Math.max(...earning.map((q) => tier(q.quote)))
  return earning.find((q) => tier(q.quote) === top) ?? null
}
