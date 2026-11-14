// A card rule in words, as the card pages and the pages built on them show
// it: what it covers, its conditions, and the issuer's quote.
import {
  activationLine,
  capitalize,
  categoryPhrase,
  categoryReadsOn,
  earnText,
  hostname,
  listed,
  shortDate,
  words,
  capSentence,
} from '../../src/engine/text.ts'
import { ruleWhat as engineRuleWhat } from '../../src/engine/rule-text.ts'
import { cardText } from '../../src/format/card-text.ts'
import { findMerchant } from '../../src/merchants/resolve.ts'
import type { Card, Rule } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import { esc } from './site.ts'

export type Quote = Card['evidence'][number]

// A quote as a reader sees it. Quotes match the issuer's page text, which
// can space out marks ("Target ® , Walmart ®") and lead with a tab's label
// ("CURRENT QUARTER").
export const quoteText = (quote: string) =>
  quote
    .replace(/^(CURRENT|NEXT) QUARTER\s+/, '')
    .replace(/\s+([®™©])/g, '$1')
    .replace(/([®™©])\s+([,.;:)])/g, '$1$2')

export function ruleKit(catalog: Catalog, today: string) {
  const { membershipName, issuerName } = cardText(catalog)
  const merchantName = (id: string) => findMerchant(catalog, id)?.name
  const readsOn = (id: string) => categoryReadsOn(catalog, id)

  // The engine's wording, so a card page and an answer say the same thing;
  // a page names every store a rule covers.
  const ruleWhatRaw = (card: Card, rule: Rule) =>
    engineRuleWhat(catalog, rule, card, { everyStore: true })

  const ruleWhat = (card: Card, rule: Rule) =>
    capitalize(ruleWhatRaw(card, rule))

  const capOf = (card: Card, rule: Rule) =>
    typeof rule.cap === 'string'
      ? card.caps.find((c) => c.id === rule.cap)
      : rule.cap

  function capLine(card: Card, rule: Rule): string | null {
    const cap = capOf(card, rule)
    if (!cap) return null
    return capSentence(
      cap,
      earnText(catalog, cap.then_rate, card.currency),
      'spending',
      typeof rule.cap === 'string'
        ? ' (shared with its other bonus categories on this cap)'
        : '',
    )
  }

  function exclusionLine(rule: Rule): string | null {
    const ex = rule.exclude
    if (!ex) return null
    const names = [
      ...(ex.categories ?? []).map((id) => categoryPhrase(catalog, id)),
      ...(ex.merchants ?? []).map((id) => merchantName(id) ?? words(id)),
    ]
    return names.length > 0 ? `Not at ${listed(names, 'or')}` : null
  }

  // `omit` leaves out lines a page already says once for all of a card's rules.
  function ruleConditions(
    card: Card,
    rule: Rule,
    omit: { cap?: boolean; activation?: boolean; dates?: boolean } = {},
  ): string[] {
    const lines: string[] = []
    const excluded = exclusionLine(rule)
    if (excluded) lines.push(excluded)
    if (rule.channel === 'online') lines.push('Online only')
    if (rule.channel === 'in_store') lines.push('In store only')
    if (rule.geography === 'us_only') lines.push('U.S. purchases only')
    if (rule.geography === 'foreign_only')
      lines.push('Purchases outside the U.S. only')
    if (rule.requires?.membership !== undefined)
      lines.push(`With ${membershipName(rule.requires.membership)}`)
    if (rule.requires?.activation === true && omit.activation !== true)
      lines.push(activationLine(issuerName(card.issuer), rule, today))
    if (
      omit.dates !== true &&
      (rule.valid_from !== undefined || rule.valid_to !== undefined)
    )
      lines.push(
        rule.valid_from !== undefined && rule.valid_to !== undefined
          ? `${shortDate(rule.valid_from)} to ${shortDate(rule.valid_to)}`
          : rule.valid_to !== undefined
            ? `Through ${shortDate(rule.valid_to)}`
            : `From ${shortDate(rule.valid_from ?? '')}`,
      )
    const cap = omit.cap === true ? null : capLine(card, rule)
    if (cap) lines.push(cap)
    if (rule.unverified !== undefined)
      lines.push("Not yet confirmed against the issuer's terms")
    return lines
  }

  const quoteHtml = (ev: Quote) =>
    `“${esc(quoteText(ev.quote))}” <a href="${esc(ev.url)}" rel="nofollow noopener">${esc(hostname(ev.url))}</a>`

  function evidenceFor(card: Card, ruleId: string): string {
    const ev = card.evidence.find((e) => e.rule === ruleId)
    return ev ? `<p class="muted">${quoteHtml(ev)}</p>` : ''
  }

  const quotesFor = (card: Card, ruleId: string) =>
    card.evidence.filter((e) => e.rule === ruleId)

  return {
    merchantName,
    readsOn,
    ruleWhatRaw,
    ruleWhat,
    capOf,
    capLine,
    exclusionLine,
    ruleConditions,
    quoteHtml,
    evidenceFor,
    quotesFor,
  }
}
