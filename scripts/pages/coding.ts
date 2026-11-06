// How a store codes and what that means card by card: the "How it codes"
// section on /best/<store> and the /how-stores-code page. Whether a rule
// pays at a store is the engine's call (evaluateCard), never a lookup here.
import {
  categoryMatches,
  evaluateCard,
  purchaseContext,
} from '../../src/engine/evaluate.ts'
import { idealHolding, type Picks } from '../../src/engine/explore.ts'
import { inEffect } from '../../src/engine/periods.ts'
import { categoryPhrase, earnText, listed } from '../../src/engine/text.ts'
import { resolveMerchantById } from '../../src/merchants/resolve.ts'
import type { Card, Rule } from '../../src/schema/card.ts'
import type { Merchant } from '../../src/schema/merchant.ts'
import type { GeneratedPage, PageContext } from './context.ts'
import type { Quote } from './rules.ts'
import { esc, fitDescription, fitTitle, SITE } from './site.ts'
import { rulePreposition } from '../../src/engine/rule-text.ts'

const EXCLUSION =
  /\bexclud|\bnot at\b|\bnot (be )?(included|eligible|count|qualify)|\bdo(es)? not\b|\bdon['’]t\b|\bisn['’]t\b|\baren['’]t\b|\bwon['’]t\b|\bexcept\b|\bmay not\b/i

const SHOWN = 6 // cards named per line before "and N more"

const openCards = (ctx: PageContext) =>
  ctx.catalog.cards.filter((c) => c.applications_closed === undefined)

const valueOf = (ctx: PageContext, card: Card, rate: number) =>
  (rate *
    (ctx.catalog.currencies.find((c) => c.id === card.currency)?.value_cents ??
      1)) /
  100

// Within a family both ways: a `travel` rule covers hotels, and a
// `grocery.supermarket` rule is a grocery rule.
const related = (a: string, b: string) =>
  categoryMatches(a, b) || categoryMatches(b, a)

function choicePicks(
  card: Card,
  rule: Rule,
  category: string,
  merchantId: string,
  family: string | null,
): Picks | null {
  if (rule.match.choice === undefined) return {}
  const choice = card.choices.find((c) => c.id === rule.match.choice)
  if (!choice) return null
  const option = Object.entries(choice.options).find(
    ([, o]) =>
      (family === null || o.categories.some((c) => related(c, family))) &&
      (o.categories.some((c) => categoryMatches(c, category)) ||
        o.merchants.includes(merchantId)),
  )?.[0]
  return option === undefined ? null : { [choice.id]: [option] }
}

// Whether this one rule pays at the merchant, if it codes as `category`,
// with the card set up for it (picked, activated, any membership it asks).
function rulePays(
  ctx: PageContext,
  card: Card,
  rule: Rule,
  merchantId: string,
  category: string,
  // Only a pick in this family counts, for a question about it.
  family: string | null = null,
): boolean {
  if (!inEffect(rule, ctx.today)) return false
  const picks = choicePicks(card, rule, category, merchantId, family)
  if (picks === null) return false
  const only = { ...card, rules: [rule] }
  const held = idealHolding(only, ctx.today, picks)
  const wallet = {
    valuations: {},
    memberships: rule.requires?.membership ? [rule.requires.membership] : [],
    cards: [held],
  }
  return (['in_store', 'online'] as const).some((channel) => {
    const m = resolveMerchantById(ctx.catalog, merchantId, channel)
    if (!m) return false
    const at = category === m.category ? m : { ...m, category, likelyMcc: null }
    const p = purchaseContext(ctx.catalog, wallet, at, category, {
      amount: null,
      date: ctx.today,
      country: 'US',
    })
    return evaluateCard(only, held, p).best.rule?.id === rule.id
  })
}

// A card's bonus rules in a category family.
function familyRules(card: Card, family: string): Rule[] {
  return card.rules.filter((r) => {
    if (r.rate <= card.base_rate) return false
    if (r.match.categories?.some((c) => related(c, family))) return true
    if (r.match.choice !== undefined) {
      const choice = card.choices.find((c) => c.id === r.match.choice)
      return Object.values(choice?.options ?? {}).some((o) =>
        o.categories.some((c) => related(c, family)),
      )
    }
    return false
  })
}

export type Treatment = {
  card: Card
  pays: Rule | null // its best rule that pays there
  rules: Rule[] // its rules in the family
  quote: Quote | null // an exclusion from its terms, when it doesn't pay
  note: string | null // the rule's own note saying so, when no quote does
  byName: boolean // a rule in the family leaves this store out by name
}

function exclusionText(
  ctx: PageContext,
  card: Card,
  rules: Rule[],
  words: string[],
): { quote: Quote | null; note: string | null } {
  const mentions = (t: string) => words.some((w) => t.toLowerCase().includes(w))
  const quotes = rules
    .flatMap((r) => ctx.quotesFor(card, r.id))
    .filter((q) => EXCLUSION.test(q.quote))
  const quote = quotes.find((q) => mentions(q.quote)) ?? null
  if (quote) return { quote, note: null }
  // Only the sentence of a rule's note that says so.
  const note = rules
    .flatMap((r) => (r.note ?? '').split(/(?<=\.)\s+/))
    .find((n) => EXCLUSION.test(n) && mentions(n))
  if (note) return { quote: null, note }
  return { quote: null, note: null }
}

// Words that name the merchant or how it codes, to pick the quote about it.
function topicWords(
  ctx: PageContext,
  merchant: Merchant,
  category: string,
  family: string,
): string[] {
  const cats = ctx.catalog.categories.filter(
    (c) => c.id === category || c.id === merchant.category,
  )
  const word = (n: string) => n.toLowerCase().replace(/s$/, '')
  // The category asked about is in every quote about it: no clue there.
  const asked = new Set(
    ctx.catalog.categories
      .filter((c) => related(c.id, family))
      .flatMap((c) => [c.name, ...c.aliases].map(word)),
  )
  const names = [
    merchant.name,
    ...merchant.aliases,
    ...cats.flatMap((c) => [c.name, ...c.aliases]),
  ]
  return [
    ...new Set(names.map(word).filter((n) => n.length >= 4 && !asked.has(n))),
  ]
}

function treatments(
  ctx: PageContext,
  merchant: Merchant,
  category: string,
  family: string,
): Treatment[] {
  const words = topicWords(ctx, merchant, category, family)
  const list: Treatment[] = []
  for (const card of openCards(ctx)) {
    const rules = familyRules(card, family).filter((r) =>
      inEffect(r, ctx.today),
    )
    if (rules.length === 0) continue
    const paying = rules
      .filter((r) => rulePays(ctx, card, r, merchant.id, category, family))
      .sort((a, b) => b.rate - a.rate)
    const pays = paying[0] ?? null
    const why = pays
      ? { quote: null, note: null }
      : exclusionText(ctx, card, rules, words)
    const byName = rules.some((r) =>
      r.exclude?.merchants?.includes(merchant.id),
    )
    list.push({ card, pays, rules, ...why, byName })
  }
  return list.sort(
    (a, b) =>
      valueOf(ctx, b.card, b.pays?.rate ?? 0) -
        valueOf(ctx, a.card, a.pays?.rate ?? 0) ||
      a.card.name.localeCompare(b.card.name),
  )
}

const cardLink = (ctx: PageContext, card: Card) =>
  `<a href="/cards/${card.id}">${esc(ctx.shortName(card.id))}</a>`

function namedList(items: string[]): string {
  if (items.length <= SHOWN + 1) return listed(items)
  return `${items.slice(0, SHOWN).join(', ')} and ${String(items.length - SHOWN)} more`
}

// The cards that pay and the ones that don't, as list items.
function treatmentItems(
  ctx: PageContext,
  list: Treatment[],
  familyWords: string,
  codesAs: string,
  // The store codes outside the category asked about: no card's reasons
  // apply, so they're one line.
  outside = false,
): string[] {
  const paying = list.filter((t) => t.pays)
  const reason = (t: Treatment) => !t.pays && (t.quote || t.note || t.byName)
  const withReason = list.filter(reason)
  const silent = list.filter((t) => !t.pays && !reason(t))
  const items: string[] = []
  if (paying.length > 0)
    items.push(
      `<strong>Counts</strong> for ${namedList(
        paying.map(
          (t) =>
            `${cardLink(ctx, t.card)} (${esc(earnText(ctx.catalog, t.pays?.rate ?? 0, t.card.currency))}${t.pays?.requires?.membership ? ` with ${esc(ctx.membershipName(t.pays.requires.membership))}` : ''})`,
        ),
      )}.`,
    )
  for (const t of withReason)
    items.push(
      `<strong>Doesn't count</strong> for ${cardLink(ctx, t.card)}: ${t.quote ? ctx.quoteHtml(t.quote) : t.note ? esc(t.note) : 'its rule leaves this store out by name.'}`,
    )
  if (silent.length > 0 && outside)
    items.push(
      `<strong>Doesn't count</strong> for the other ${String(silent.length)} cards with a bonus on ${esc(familyWords)}: none of them covers ${esc(codesAs)}.`,
    )
  else if (silent.length > 0)
    items.push(
      `<strong>Doesn't count</strong> for ${namedList(
        silent.map((t) => cardLink(ctx, t.card)),
      )}: ${silent.length === 1 ? 'its' : 'their'} bonus on ${esc(familyWords)} doesn't pay when it codes as ${esc(codesAs)}.`,
    )
  return items
}

const codesText = (ctx: PageContext, category: string, mcc?: number) =>
  `${categoryPhrase(ctx.catalog, category)}${mcc === undefined ? '' : ` (MCC ${String(mcc)})`}`

// Where a merchant's notes say how it codes.
export const hasCodingNotes = (m: Merchant) =>
  m.note !== undefined || m.ambiguity !== undefined

// A store page's "How it codes": the category, the notes, and the rules that
// name it, pay there or leave it out, for each way it may code.
export function howItCodes(
  ctx: PageContext,
  merchant: Merchant,
  categorySlug: (id: string) => string | null,
): string {
  if (!hasCodingNotes(merchant)) return ''
  const ways = [merchant.category, ...(merchant.ambiguity?.may_code_as ?? [])]
  const parts: string[] = []
  const catLink = (id: string) => {
    const slug = categorySlug(id)
    return slug
      ? `<a href="/categories/${slug}">${esc(categoryPhrase(ctx.catalog, id))}</a>`
      : esc(categoryPhrase(ctx.catalog, id))
  }
  parts.push(
    `<p>${esc(merchant.name)} usually codes as ${catLink(merchant.category)}${merchant.likely_mcc === undefined ? '' : ` (MCC ${String(merchant.likely_mcc)})`}${merchant.ambiguity ? `, and may code as ${listed(merchant.ambiguity.may_code_as.map(catLink), 'or')}` : ''}.</p>`,
  )
  const notes = [merchant.note, merchant.ambiguity?.note].filter(
    (n) => n !== undefined,
  )
  if (notes.length > 0)
    parts.push(`<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`)

  const named: string[] = []
  const excluding: string[] = []
  for (const card of openCards(ctx)) {
    for (const rule of card.rules.filter((r) => inEffect(r, ctx.today))) {
      const quote = ctx.quotesFor(card, rule.id)
      if (
        rule.match.merchants?.includes(merchant.id) &&
        rule.rate > card.base_rate
      )
        named.push(
          `<li>${cardLink(ctx, card)}: ${esc(earnText(ctx.catalog, rule.rate, card.currency))} ${rulePreposition(ctx.catalog, [rule])} ${esc(ctx.ruleWhatRaw(card, rule))}${quote[0] ? `. ${ctx.quoteHtml(quote[0])}` : '.'}</li>`,
        )
      const ex = rule.exclude
      const leftOut =
        ex?.merchants?.includes(merchant.id) ||
        ways.some((w) => ex?.categories?.some((c) => categoryMatches(c, w)))
      if (leftOut) {
        const why = exclusionText(
          ctx,
          card,
          [rule],
          ways.flatMap((w) => topicWords(ctx, merchant, w, '')),
        )
        excluding.push(
          `<li>${cardLink(ctx, card)}: its ${esc(earnText(ctx.catalog, rule.rate, card.currency))} on ${esc(ctx.ruleWhatRaw(card, rule))} leaves it out${why.quote ? `: ${ctx.quoteHtml(why.quote)}` : why.note ? `: ${esc(why.note)}` : '.'}</li>`,
        )
      }
    }
  }
  if (named.length > 0)
    parts.push(
      `<h3>Cards whose terms name ${esc(merchant.name)}</h3><ul class="quotes">${named.join('')}</ul>`,
    )
  if (excluding.length > 0)
    parts.push(
      `<h3>Cards whose terms leave it out</h3><ul class="quotes">${excluding.join('')}</ul>`,
    )

  for (const way of ways) {
    const paying = openCards(ctx)
      .flatMap((card) => {
        const best = card.rules
          .filter(
            (r) =>
              r.rate > card.base_rate &&
              !r.match.any &&
              !r.match.merchants?.includes(merchant.id),
          )
          .filter((r) => rulePays(ctx, card, r, merchant.id, way))
          .sort((a, b) => b.rate - a.rate)[0]
        return best ? [{ card, rule: best }] : []
      })
      .sort(
        (a, b) =>
          valueOf(ctx, b.card, b.rule.rate) - valueOf(ctx, a.card, a.rule.rate),
      )
    if (paying.length === 0) continue
    parts.push(
      `<p>${way === merchant.category ? 'Coded' : 'If it codes'} as ${esc(codesText(ctx, way))}, ${String(paying.length)} ${paying.length === 1 ? 'card pays' : 'cards pay'} a category bonus here: ${namedList(
        paying.map(
          (p) =>
            `${cardLink(ctx, p.card)} (${esc(earnText(ctx.catalog, p.rule.rate, p.card.currency))})`,
        ),
      )}.</p>`,
    )
  }
  return `<h2 id="how-it-codes">How it codes</h2>${parts.join('')}`
}

type Question = {
  heading: string
  family: string // the category asked about
  merchants: (ms: Merchant[]) => Merchant[]
}

const byIds = (ids: string[]) => (ms: Merchant[]) =>
  ids.flatMap((id) => ms.filter((m) => m.id === id))

// The questions people search for, each answered from the merchants it names
// or picks out of the data.
const QUESTIONS: Question[] = [
  {
    heading: 'Does Costco count as groceries?',
    family: 'grocery',
    merchants: byIds(['costco']),
  },
  {
    heading: 'Is Target a grocery store?',
    family: 'grocery',
    merchants: byIds(['target']),
  },
  {
    heading: 'Do Uber Eats and DoorDash count as dining?',
    family: 'dining',
    merchants: byIds(['uber-eats', 'doordash']),
  },
  {
    heading: "Does gas at Costco or Sam's Club count as gas?",
    family: 'gas',
    merchants: byIds(['costco-gas', 'sams-club-gas']),
  },
  {
    heading: 'Do restaurants inside hotels count as dining?',
    family: 'dining',
    merchants: (ms) =>
      ms.filter(
        (m) =>
          categoryMatches('travel.hotels', m.category) &&
          m.ambiguity?.may_code_as.some((c) => categoryMatches('dining', c)),
      ),
  },
  {
    heading: 'Does a pharmacy inside a supermarket count as groceries?',
    family: 'grocery',
    merchants: (ms) =>
      ms.filter(
        (m) =>
          categoryMatches('grocery', m.category) &&
          m.ambiguity?.may_code_as.some((c) => categoryMatches('drugstore', c)),
      ),
  },
]

const allMerchants = (ctx: PageContext) => {
  const byId = new Map<string, Merchant>()
  for (const m of [
    ...ctx.catalog.merchants.seed,
    ...ctx.catalog.merchants.overrides,
  ])
    byId.set(m.id, m)
  return [...byId.values()]
}

const questionId = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/['’?]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function answerQuestion(
  ctx: PageContext,
  q: Question,
  bestSlug: (merchantId: string) => string | null,
): string | null {
  const merchants = q.merchants(allMerchants(ctx))
  if (merchants.length === 0) return null
  const familyWords = categoryPhrase(ctx.catalog, q.family)
  // Stores that code the same way and get the same answer share one.
  const groups = new Map<string, { merchants: Merchant[]; html: string }>()
  for (const m of merchants) {
    const ways = [m.category, ...(m.ambiguity?.may_code_as ?? [])]
    const blocks = [...new Set(ways)].map((way) => {
      const list = treatments(ctx, m, way, q.family)
      const items = treatmentItems(
        ctx,
        list,
        familyWords,
        codesText(ctx, way),
        !related(way, q.family),
      )
      const lead =
        way === m.category
          ? `Coded as ${esc(codesText(ctx, way, m.likely_mcc))}:`
          : `If it posts as ${esc(codesText(ctx, way))}:`
      return `<p>${lead}</p><ul class="quotes">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
    })
    const key = blocks.join('')
    const g = groups.get(key)
    if (g) g.merchants.push(m)
    else groups.set(key, { merchants: [m], html: key })
  }
  const notesOf = (ms: Merchant[]) => {
    const each = ms.map((m) =>
      [m.note, m.ambiguity?.note].filter((n) => n !== undefined).join(' '),
    )
    if (each.every((n) => n === '')) return ''
    if (each.every((n) => n === each[0])) return `<p>${esc(each[0] ?? '')}</p>`
    return `<ul>${ms.map((m, i) => (each[i] ? `<li>${esc(m.name)}: ${esc(each[i] ?? '')}</li>` : '')).join('')}</ul>`
  }
  const link = (m: Merchant) => {
    const slug = bestSlug(m.id)
    return slug ? `<a href="/best/${slug}">${esc(m.name)}</a>` : esc(m.name)
  }
  const sections = [...groups.values()].map(
    (g) =>
      `<h3>${listed(g.merchants.map(link))}</h3>${notesOf(g.merchants)}${g.html}`,
  )
  return `<h2 id="${questionId(q.heading)}">${esc(q.heading)}</h2>${sections.join('')}`
}

export function howStoresCodePage(
  ctx: PageContext,
  bestSlug: (merchantId: string) => string | null,
  lastmod: string,
): GeneratedPage {
  const answers = QUESTIONS.map((q) => ({
    q,
    html: answerQuestion(ctx, q, bestSlug),
  })).filter((a) => a.html !== null)
  const title = fitTitle([
    'How stores code: Costco, Target, Uber Eats and more',
    'How stores code for credit card bonuses',
  ])
  const description = fitDescription([
    "Does Costco count as groceries? Is Target a grocery store? Answered card by card from each issuer's terms and how each store codes.",
    'How stores code for credit card bonus categories, card by card, from issuer terms.',
  ])
  const path = '/how-stores-code'
  const body = `
      <h1>How stores code</h1>
      <p class="updated">Updated ${esc(ctx.todayWords)}</p>
      <p>A card's bonus depends on how the store's charge is coded (its merchant category code), not on what you bought. These answers come from earnrate's notes on each store and from each card's own rules, checked by earnrate's engine. A store's page shows every card's rate there.</p>
      <ul>${answers.map((a) => `<li><a href="#${questionId(a.q.heading)}">${esc(a.q.heading)}</a></li>`).join('')}</ul>
      ${answers.map((a) => a.html).join('')}
      <p class="muted">Only cards open to new applicants are listed. A card "counts" a store when one of its rules in that category pays there, set up at its best: categories picked, bonuses activated, any membership it asks for.</p>`
  return {
    file: 'how-stores-code.html',
    path,
    lastmod,
    html: ctx.layout({
      title,
      description,
      path,
      body,
      crumbs: [{ name: 'How stores code', path }],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
        url: `${SITE}${path}`,
        dateModified: lastmod,
      },
    }),
  }
}
