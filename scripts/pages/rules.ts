// A card rule in words, as the card pages and the pages built on them show
// it: what it covers, its conditions, and the issuer's quote.
import {
  CAP_PERIODS,
  capitalize,
  categoryPhrase,
  categoryReadsOn,
  earnText,
  hostname,
  listed,
  PAYMENT_PHRASES,
  PICK_PERIODS,
  shortDate,
  wholeDollars,
  words,
} from '../../src/engine/text.ts'
import { cardText } from '../../src/format/card-text.ts'
import { findMerchant } from '../../src/merchants/resolve.ts'
import type { Card, Rule } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import { esc } from './site.ts'

export type Quote = Card['evidence'][number]

export function ruleKit(catalog: Catalog) {
  const { membershipName, issuerName } = cardText(catalog)
  const merchantName = (id: string) => findMerchant(catalog, id)?.name
  const readsOn = (id: string) => categoryReadsOn(catalog, id)

  function ruleWhatRaw(card: Card, rule: Rule): string {
    const payment = rule.requires?.payment
    const what = ruleScope(card, rule)
    return payment === undefined ? what : `${what} ${PAYMENT_PHRASES[payment]}`
  }

  function ruleScope(card: Card, rule: Rule): string {
    const m = rule.match
    if (m.any) return 'every purchase'
    const parts: string[] = []
    if (m.choice !== undefined) {
      const choice = card.choices.find((c) => c.id === m.choice)
      parts.push(
        choice
          ? `${choice.pick === 1 ? 'one category' : `${String(choice.pick)} categories`} you pick${choice.period === 'until_changed' ? '' : ` ${PICK_PERIODS[choice.period]}`}`
          : 'the category you pick',
      )
    }
    if (m.merchants?.length)
      parts.push(listed(m.merchants.map((id) => merchantName(id) ?? words(id))))
    if (m.categories?.length) {
      const cats = listed(m.categories.map((id) => categoryPhrase(catalog, id)))
      parts.push(m.merchants?.length ? `when it codes as ${cats}` : cats)
    }
    if (m.mccs?.length)
      parts.push(`purchases coded MCC ${m.mccs.map(String).join(', ')}`)
    return parts.join(' ')
  }

  const ruleWhat = (card: Card, rule: Rule) =>
    capitalize(ruleWhatRaw(card, rule))

  const capOf = (card: Card, rule: Rule) =>
    typeof rule.cap === 'string'
      ? card.caps.find((c) => c.id === rule.cap)
      : rule.cap

  function capLine(card: Card, rule: Rule): string | null {
    const cap = capOf(card, rule)
    if (!cap) return null
    return `Up to ${wholeDollars(cap.amount)} of spending ${CAP_PERIODS[cap.period]}${typeof rule.cap === 'string' ? ' (shared with its other bonus categories on this cap)' : ''}, then ${earnText(catalog, cap.then_rate, card.currency)}`
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

  function ruleConditions(card: Card, rule: Rule): string[] {
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
    if (rule.requires?.activation === true)
      lines.push(`Activate it with ${issuerName(card.issuer)} first`)
    if (rule.valid_from !== undefined || rule.valid_to !== undefined)
      lines.push(
        rule.valid_from !== undefined && rule.valid_to !== undefined
          ? `${shortDate(rule.valid_from)} to ${shortDate(rule.valid_to)}`
          : rule.valid_to !== undefined
            ? `Through ${shortDate(rule.valid_to)}`
            : `From ${shortDate(rule.valid_from ?? '')}`,
      )
    const cap = capLine(card, rule)
    if (cap) lines.push(cap)
    if (rule.unverified !== undefined)
      lines.push("Not yet confirmed against the issuer's terms")
    return lines
  }

  const quoteHtml = (ev: Quote) =>
    `“${esc(ev.quote)}” <a href="${esc(ev.url)}" rel="nofollow noopener">${esc(hostname(ev.url))}</a>`

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
