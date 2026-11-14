// How a store codes and what that means card by card: the "How it codes"
// section on /best/<store> and the /how-stores-code page. Whether a rule
// pays at a store is the engine's call (evaluateCard), never a lookup here.
import {
  categoryMatches,
  evaluateCard,
  purchaseContext,
} from '../../src/engine/evaluate.ts'
import { idealHolding, type Picks } from '../../src/engine/explore.ts'
import {
  NAMED_LISTS,
  namedKey,
  namesInQuote,
  namings,
  type Naming,
} from '../../src/engine/named.ts'
import { inEffect } from '../../src/engine/periods.ts'
import {
  categoryAs,
  bareRate,
  capitalize,
  categoryPhrase,
  earnText,
  hostname,
  inOrder,
  listed,
  possessive,
} from '../../src/engine/text.ts'
import {
  findMerchant,
  onlineCategory,
  resolveMerchantById,
} from '../../src/merchants/resolve.ts'
import type { Card, Rule } from '../../src/schema/card.ts'
import type { Merchant } from '../../src/schema/merchant.ts'
import type { GeneratedPage, PageContext } from './context.ts'
import { quoteText, type Quote } from './rules.ts'
import {
  chipLinks,
  esc,
  finePrint,
  fitDescription,
  fitTitle,
  SITE,
} from './site.ts'
import { pickName, rulePreposition } from '../../src/engine/rule-text.ts'

const EXCLUSION =
  /\bexclud|\bnot at\b|\bnot (be )?(included|eligible|count|qualify)|\bdo(es)? not\b|\bdon['’]t\b|\bisn['’]t\b|\baren['’]t\b|\bwon['’]t\b|\bexcept\b|\bmay not\b/i

const SHOWN = 6 // cards named per line before "and N more"
const SHOWN_LEFT_OUT = 4 // cards a store page names before the rest

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

// The pick that covers the category. An online shopping pick covers nearly
// every store, so it counts only for a category bought only online.
function choicePicks(
  ctx: PageContext,
  card: Card,
  rule: Rule,
  category: string,
  merchantId: string,
  family: string | null,
): Picks | null {
  if (rule.match.choice === undefined) return {}
  const choice = card.choices.find((c) => c.id === rule.match.choice)
  if (!choice) return null
  const options = Object.entries(choice.options)
  const option =
    options.find(
      ([, o]) =>
        (family === null || o.categories.some((c) => related(c, family))) &&
        (o.categories.some((c) => categoryMatches(c, category)) ||
          o.merchants.includes(merchantId)),
    )?.[0] ??
    (family === null && onlineCategory(ctx.catalog, category)
      ? options.find(
          ([, o]) =>
            o.online?.exclude.every((c) => !categoryMatches(c, category)) ??
            false,
        )?.[0]
      : undefined)
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
  const picks = choicePicks(ctx, card, rule, category, merchantId, family)
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

// The cards that pay and the ones that don't, as list items: the ones whose
// terms leave the store out one line per issuer, and what those terms say,
// each wording once with the cards that share it, as the fine print.
function treatmentItems(
  ctx: PageContext,
  list: Treatment[],
  familyWords: string,
  codesAs: string,
  // The store codes outside the category asked about: no card's reasons
  // apply, so they're one line.
  outside = false,
): { items: string[]; fine: string[] } {
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
  const byIssuer = new Map<string, Treatment[]>()
  for (const t of withReason)
    byIssuer.set(t.card.issuer, [...(byIssuer.get(t.card.issuer) ?? []), t])
  for (const [issuer, ts] of [...byIssuer].sort((a, b) =>
    ctx.issuerName(a[0]).localeCompare(ctx.issuerName(b[0])),
  ))
    items.push(
      `<strong>Doesn't count</strong> for ${ts.length === 1 ? listed(ts.map((t) => cardLink(ctx, t.card))) : `${String(ts.length)} ${esc(ctx.issuerName(issuer))} cards: ${listed(ts.map((t) => cardLink(ctx, t.card)))}`}.`,
    )
  const why = new Map<string, Treatment[]>()
  for (const t of withReason) {
    const text = t.quote
      ? ctx.quoteHtml(t.quote)
      : t.note
        ? esc(t.note)
        : 'Its rule leaves this store out by name.'
    why.set(text, [...(why.get(text) ?? []), t])
  }
  const fine = [...why].map(
    ([text, ts]) => `${listed(ts.map((t) => cardLink(ctx, t.card)))}: ${text}`,
  )
  if (silent.length > 0 && outside)
    items.push(
      `<strong>Doesn't count</strong> for the other ${String(silent.length)} cards with a bonus on ${esc(familyWords)}: none of them pays when it counts ${esc(codesAs)}.`,
    )
  else if (silent.length > 0)
    items.push(
      `<strong>Doesn't count</strong> for ${namedList(
        silent.map((t) => cardLink(ctx, t.card)),
      )}: ${silent.length === 1 ? 'its' : 'their'} bonus on ${esc(familyWords)} doesn't pay when it counts ${esc(codesAs)}.`,
    )
  return { items, fine }
}

// Words an issuer uses when its stores are examples, not the whole list.
const EXAMPLES = /\b(e\.g\.|examples?|like|such as|includ(e|es|ing)|sample)\b/i

// A quote that's a run of store names off an issuer's list, not a sentence,
// after any lead-in that ends in a colon ("…rewards include: ALDI Hy-Vee").
function isNameList(quote: string): boolean {
  const colon = quote.lastIndexOf(': ')
  const run = colon === -1 ? quote : quote.slice(colon + 2)
  if (/[,;:()"!?]/.test(run)) return false
  const words = run.split(/\s+/)
  const lower = words.filter((w) => /^[a-z]/.test(w) && !w.includes('.'))
  return lower.length * 4 <= words.length
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// "U.S. Bank's", "Barclays'", "American Express's".
const whose = (name: string) => (/[^s]s$/.test(name) ? `${name}'` : `${name}'s`)

// Who says it: the issuer on its own site, else the company whose site it
// is ("Venmo" for a Synchrony card's page on venmo.com).
function speaker(ctx: PageContext, card: Card, urls: string[]): string {
  const issuer = ctx.catalog.issuers.find((i) => i.id === card.issuer)
  const own = [card.issuer, issuer?.name ?? '', ...(issuer?.search ?? [])]
    .map(squash)
    .filter((w) => w.length >= 3)
  const hosts = urls.map(hostname)
  if (hosts.some((h) => own.some((w) => squash(h).includes(w))))
    return ctx.issuerName(card.issuer)
  const site = hosts[0]?.split('.').at(-2)
  return site ? capitalize(site) : ctx.issuerName(card.issuer)
}

// The options of a rule's pick that cover the store. An online shopping pick
// covers nearly every store, so it counts only when no other pick does.
function pickOptions(card: Card, rule: Rule, merchant: Merchant): string[] {
  const choice = card.choices.find((c) => c.id === rule.match.choice)
  if (!choice) return []
  const ways = [
    merchant.category,
    merchant.in_store?.category,
    merchant.online?.category,
  ].filter((w) => w !== undefined)
  const options = Object.entries(choice.options)
  const covering = options.filter(
    ([, o]) =>
      o.merchants.includes(merchant.id) ||
      o.categories.some((c) => ways.some((w) => categoryMatches(c, w))),
  )
  const online = options.filter(([, o]) => {
    const exclude = o.online?.exclude
    return (
      exclude !== undefined &&
      !ways.every((w) => exclude.some((c) => categoryMatches(c, w)))
    )
  })
  return (covering.length > 0 ? covering : online).map(([id]) => id)
}

// The pick a naming is about: the one that covers a store named as earning,
// the one the data says leaves out a store named as not earning.
const pickOf = (n: Naming, m: Merchant): string[] => {
  if (n.list === 'earning') return pickOptions(n.card, n.rule, m)
  const pick = n.rule.named?.picks?.[m.id]
  return pick === undefined ? [] : [pick]
}

type Piece = {
  quote: Quote
  lead: boolean // names no store on the list
  list: boolean // a run of names, shown as a list
  names: string[] // the stores it names, in the issuer's spelling
}

// The quotes of a naming that are about this store: the pieces of a long
// list that name it alone (not inside a longer name), among stores on the
// same pick, and any lead-in that names no store.
function piecesOf(ctx: PageContext, n: Naming, merchant: Merchant): Piece[] {
  const ids = n.rule.named?.[n.list] ?? []
  const pool = [
    merchant,
    ...NAMED_LISTS.flatMap((l) => n.rule.named?.[l] ?? []).flatMap((id) => {
      const m = findMerchant(ctx.catalog, id)
      return m && m.id !== merchant.id ? [m] : []
    }),
  ]
  const mine = pickOf(n, merchant)
  const samePick = (m: Merchant) =>
    mine.length === 0 || pickOf(n, m).some((o) => mine.includes(o))
  return ctx
    .quotesFor(n.card, namedKey(n.rule.id, n.list))
    .flatMap((q): Piece[] => {
      const found = namesInQuote(q.quote, pool)
      const others = found.filter(
        (f) => f.merchant.id !== merchant.id && ids.includes(f.merchant.id),
      )
      if (!found.some((f) => f.merchant.id === merchant.id))
        return others.length === 0
          ? [{ quote: q, lead: true, list: false, names: [] }]
          : []
      // A piece is about the pick most of the stores it names are on: "Kroger
      // Fuel Center" in a list of gas stations isn't about Kroger's groceries.
      const tally = new Map<string, number>()
      for (const f of found)
        if (f.merchant.id === merchant.id || ids.includes(f.merchant.id))
          for (const o of pickOf(n, f.merchant))
            tally.set(o, (tally.get(o) ?? 0) + 1)
      const most = Math.max(0, ...tally.values())
      if (mine.length > 0 && !mine.some((o) => tally.get(o) === most)) return []
      return [
        {
          quote: q,
          lead: false,
          list: isNameList(q.quote),
          names: found
            .filter(
              (f) =>
                f.merchant.id === merchant.id ||
                (ids.includes(f.merchant.id) && samePick(f.merchant)),
            )
            .map((f) => f.text),
        },
      ]
    })
}

// What issuers' own lists of stores say about this one: a sentence for each
// issuer, list and quote, naming every card that shares it, then the quotes.
// A list of examples says nothing about the stores it leaves out.
function issuerListsHtml(ctx: PageContext, merchant: Merchant): string {
  const link = (url: string) =>
    `<a href="${esc(url)}" rel="nofollow noopener">${esc(hostname(url))}</a>`
  const groups = new Map<
    string,
    { namings: Naming[]; who: string; examples: boolean; lines: string[] }
  >()
  for (const n of namings(openCards(ctx), merchant.id, ctx.today)) {
    const all = piecesOf(ctx, n, merchant)
    const hasList = all.some((p) => p.list)
    // A list shown as names says it's the issuer's examples itself.
    const pieces = hasList ? all.filter((p) => !p.lead) : all
    const onlyStores = pickOf(n, merchant).some(
      (o) =>
        n.card.choices
          .find((c) => c.id === n.rule.match.choice)
          ?.options[o]?.merchants.includes(merchant.id) ?? false,
    )
    const examples =
      all.some((p) => !p.list && EXAMPLES.test(p.quote.quote)) ||
      (hasList && !onlyStores)
    const who = speaker(
      ctx,
      n.card,
      pieces.map((p) => p.quote.url),
    )
    const byUrl = new Map<string, Piece[]>()
    for (const p of pieces)
      byUrl.set(p.quote.url, [...(byUrl.get(p.quote.url) ?? []), p])
    const lines = [...byUrl].flatMap(([url, ps]) => {
      const prose = ps.filter((p) => !p.list)
      const names = [
        ...new Set(ps.filter((p) => p.list).flatMap((p) => p.names)),
      ]
      return [
        ...(prose.length > 0
          ? [
              `“${esc(quoteText(prose.map((p) => p.quote.quote).join(' … ')))}” ${link(url)}`,
            ]
          : []),
        ...(names.length > 0
          ? [
              `${esc(whose(who))} ${examples ? 'examples include' : 'list includes'} ${esc(inOrder(names))}. ${link(url)}`,
            ]
          : []),
      ]
    })
    const key = JSON.stringify([
      who,
      n.list,
      examples,
      countsAs(ctx, n.rule) ??
        n.rule.match.choice ??
        ctx.ruleWhatRaw(n.card, n.rule),
      pickOf(n, merchant),
      lines,
    ])
    const g = groups.get(key)
    if (g) g.namings.push(n)
    else groups.set(key, { namings: [n], who, examples, lines })
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        a.who.localeCompare(b.who) ||
        Number(a.namings[0]?.list !== 'earning') -
          Number(b.namings[0]?.list !== 'earning'),
    )
    .map(({ namings: list, who, examples, lines }) => {
      const [first] = list
      if (!first) return ''
      const sentence = namingSentence(ctx, merchant, list, who, examples)
      return `<p>${sentence}</p><ul class="quotes">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`
    })
    .join('')
}

// The sentence for a group of namings that share an issuer, list and quotes:
// "U.S. Bank names Kroger among its examples of stores where U.S. Bank Cash+
// (2% cash back) pays its bonus on grocery stores, when that's your pick."
// Example wording only when the issuer calls them examples.
function namingSentence(
  ctx: PageContext,
  merchant: Merchant,
  list: Naming[],
  who: string,
  examples: boolean,
): string {
  const [first] = list
  if (!first) return ''
  const { card, rule } = first
  const earning = first.list === 'earning'
  const store = esc(merchant.name)
  const subject = esc(who)
  const sorted = [...list].sort(
    (a, b) =>
      valueOf(ctx, b.card, b.rule.rate) - valueOf(ctx, a.card, a.rule.rate) ||
      a.card.name.localeCompare(b.card.name),
  )
  const one = sorted.length === 1
  const named = namedList(
    sorted.map(
      (n) =>
        `${cardLink(ctx, n.card)}${earning ? ` (${esc(earnText(ctx.catalog, n.rule.rate, n.card.currency))})` : ''}`,
    ),
  )
  const rate = esc(bareRate(rule.rate, card.currency))
  // "Chase Freedom Flex's 5% bonus", but "the 3x bonus on SoFi Unlimited 2%".
  const bonusOn = /\d%$/.test(ctx.shortName(card.id))
    ? `the ${rate} bonus on ${cardLink(ctx, card)}`
    : `<a href="/cards/${card.id}">${esc(possessive(ctx.shortName(card.id)))}</a> ${rate} bonus`
  const cardsWord = one ? named : `these cards: ${named}`
  const as = countsAs(ctx, rule)
  if (as !== null) {
    const category = rule.match.categories?.[0] ?? ''
    if (examples)
      return `${subject} names ${store} among its examples of stores that ${earning ? 'count' : "don't count"} ${esc(as)} for the bonus on ${cardsWord}.`
    if (earning)
      return one
        ? `${subject} says ${store} counts ${esc(as)} for ${bonusOn}.`
        : `${subject} says ${store} counts ${esc(as)} for the bonus on ${cardsWord}.`
    return one
      ? `${subject} leaves ${store} out of ${esc(categoryPhrase(ctx.catalog, category))} for ${bonusOn}.`
      : `${subject} leaves ${store} out of ${esc(categoryPhrase(ctx.catalog, category))} for the bonus on ${cardsWord}.`
  }
  const choice = card.choices.find((c) => c.id === rule.match.choice)
  const picks = pickOf(first, merchant).map((o) =>
    pickName(ctx.catalog, card, choice?.id ?? '', o),
  )
  const merchantsOnly =
    rule.match.merchants !== undefined &&
    rule.match.categories === undefined &&
    rule.match.choice === undefined
  // Of a rule over several categories, the ones the store counts as.
  const ways = [
    merchant.category,
    merchant.in_store?.category,
    merchant.online?.category,
  ].filter((w) => w !== undefined)
  const covering = earning
    ? (rule.match.categories ?? []).filter((c) =>
        ways.some((w) => categoryMatches(c, w)),
      )
    : []
  const what = esc(
    choice && picks.length > 0
      ? inOrder(picks, 'or')
      : covering.length > 0 && choice === undefined
        ? inOrder(covering.map((c) => categoryPhrase(ctx.catalog, c)))
        : `${ctx.ruleWhatRaw(card, rule)}${merchantsOnly ? ' purchases' : ''}`,
  )
  const when =
    earning && choice && picks.length > 0
      ? `, when that's ${choice.pick > 1 ? 'one of your picks' : 'your pick'}`
      : ''
  if (earning)
    return examples
      ? `${subject} names ${store} among its examples of stores where ${one ? `${named} pays its` : 'these cards pay their'} bonus on ${what}${when}${one ? '' : `: ${named}`}.`
      : `${subject} says ${one ? `${named} pays its` : 'these cards pay their'} bonus on ${what} at ${store}${when}${one ? '' : `: ${named}`}.`
  if (!one)
    return examples
      ? `${subject} names ${store} among its examples of stores where these cards don't pay their bonus on ${what}: ${named}.`
      : `${subject} says these cards don't pay their bonus on ${what} at ${store}: ${named}.`
  return examples
    ? `${subject} names ${store} among its examples of stores where ${named} doesn't pay its ${rate} on ${what}.`
    : `${subject} says ${named} doesn't pay its ${rate} on ${what} at ${store}.`
}

// "as a supermarket", for a rule that covers one category and nothing else.
function countsAs(ctx: PageContext, rule: Rule): string | null {
  const { categories, merchants, mccs, choice, any } = rule.match
  return categories?.length === 1 &&
    !merchants?.length &&
    !mccs?.length &&
    choice === undefined &&
    any === undefined
    ? categoryAs(ctx.catalog, categories[0] ?? '')
    : null
}

// "as a supermarket (MCC 5411)"
const codesText = (ctx: PageContext, category: string, mcc?: number) =>
  `${categoryAs(ctx.catalog, category)}${mcc === undefined ? '' : ` (MCC ${String(mcc)})`}`

// Where a merchant's notes say how it codes.
export const hasCodingNotes = (m: Merchant) =>
  m.note !== undefined || m.ambiguity !== undefined

// A store page's "How it codes": the category, the notes, and the rules that
// name it, pay there or leave it out, for each way it may code.
export function howItCodes(
  ctx: PageContext,
  merchant: Merchant,
  categorySlug: (id: string) => string | null,
  // The page's answer already said how it usually counts.
  said = false,
): string {
  const lists = issuerListsHtml(ctx, merchant)
  if (!hasCodingNotes(merchant) && lists === '') return ''
  const ways = [merchant.category, ...(merchant.ambiguity?.may_code_as ?? [])]
  const parts: string[] = []
  // "as <a>a supermarket</a>": the words after "as" link to the category.
  const asLink = (id: string) => {
    const slug = categorySlug(id)
    const words = categoryAs(ctx.catalog, id).replace(/^as /, '')
    return slug
      ? `as <a href="/categories/${slug}">${esc(words)}</a>`
      : `as ${esc(words)}`
  }
  const also = merchant.ambiguity
    ? listed(merchant.ambiguity.may_code_as.map(asLink), 'or')
    : null
  if (!said)
    parts.push(
      `<p>${esc(merchant.name)} usually counts ${asLink(merchant.category)}${merchant.likely_mcc === undefined ? '' : ` (MCC ${String(merchant.likely_mcc)})`}${also === null ? '' : `, and may count ${also}`}.</p>`,
    )
  else if (also !== null)
    parts.push(`<p>${esc(merchant.name)} may also count ${also}.</p>`)
  const notes = [merchant.note, merchant.ambiguity?.note].filter(
    (n) => n !== undefined,
  )
  if (notes.length > 0)
    parts.push(`<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`)
  parts.push(lists)

  const named: string[] = []
  const excluding: { card: Card; rule: Rule; html: string }[] = []
  // A rule whose issuer names the store as not earning it is said above.
  let saidAbove = false
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
      // An issuer that names the store as earning has settled how it codes.
      const leftOut =
        !rule.named?.earning?.includes(merchant.id) &&
        (ex?.merchants?.includes(merchant.id) ||
          ways.some((w) => ex?.categories?.some((c) => categoryMatches(c, w))))
      if (leftOut && rule.named?.not_earning?.includes(merchant.id))
        saidAbove = true
      else if (leftOut) {
        const why = exclusionText(
          ctx,
          card,
          [rule],
          ways.flatMap((w) => topicWords(ctx, merchant, w, '')),
        )
        excluding.push({
          card,
          rule,
          html: `<li>${cardLink(ctx, card)}: its ${esc(earnText(ctx.catalog, rule.rate, card.currency))} on ${esc(ctx.ruleWhatRaw(card, rule))} leaves it out${why.quote ? `: ${ctx.quoteHtml(why.quote)}` : why.note ? `: ${esc(why.note)}` : '.'}</li>`,
        })
      }
    }
  }
  if (named.length > 0)
    parts.push(
      `<h3>Cards whose terms name ${esc(merchant.name)}</h3><ul class="quotes">${named.join('')}</ul>`,
    )
  const leftOutHeading = `${saidAbove ? 'Other cards' : 'Cards'} whose terms leave it out`
  if (excluding.length > SHOWN_LEFT_OUT) {
    // The bonuses worth most as chips, every card with its terms behind a tap.
    const top = [...excluding]
      .sort(
        (a, b) =>
          valueOf(ctx, b.card, b.rule.rate) - valueOf(ctx, a.card, a.rule.rate),
      )
      .slice(0, SHOWN_LEFT_OUT)
    parts.push(
      `<h3>${leftOutHeading}</h3><ul class="rate-chips">${top.map((e) => `<li>${cardLink(ctx, e.card)} <b>${esc(bareRate(e.rule.rate, e.card.currency))}</b></li>`).join('')}</ul>${finePrint(`<ul class="quotes">${excluding.map((e) => e.html).join('')}</ul>`, `All ${String(excluding.length)}, with their terms`)}`,
    )
  } else if (excluding.length > 0)
    parts.push(
      `<h3>${leftOutHeading}</h3><ul class="quotes">${excluding.map((e) => e.html).join('')}</ul>`,
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
      `<p>${way === merchant.category ? 'Counted' : 'If it counts'} ${esc(codesText(ctx, way))}, ${String(paying.length)} ${paying.length === 1 ? 'card pays' : 'cards pay'} a category bonus here: ${namedList(
        paying.map(
          (p) =>
            `${cardLink(ctx, p.card)} (${esc(earnText(ctx.catalog, p.rule.rate, p.card.currency))}${p.rule.requires?.membership ? ` with ${esc(ctx.membershipName(p.rule.requires.membership))}` : ''})`,
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

// The answer word for one store: how many of the cards with a bonus in the
// family pay where it usually codes, and whether another way it may code
// turns that around.
function verdict(
  main: { inside: boolean; paying: number; total: number },
  others: { inside: boolean; paying: number }[],
): string {
  const { inside, paying, total } = main
  if (!inside && others.some((o) => o.inside && o.paying > 0))
    return 'Sometimes'
  if (inside && paying > 0 && others.some((o) => !o.inside)) return 'Usually'
  if (!inside || paying === 0) return 'No'
  if (paying === total) return 'Yes'
  return paying * 2 >= total ? 'Mostly yes' : 'Mostly no'
}

type Answer = {
  merchants: Merchant[]
  word: string
  codes: string
  count: string
  html: string
}

function answerQuestion(
  ctx: PageContext,
  q: Question,
  bestHref: (merchantId: string) => string | null,
): string | null {
  const merchants = q.merchants(allMerchants(ctx))
  if (merchants.length === 0) return null
  const familyWords = categoryPhrase(ctx.catalog, q.family)
  // Stores that code the same way and get the same answer share one.
  const groups = new Map<string, Answer>()
  for (const m of merchants) {
    const ways = [...new Set([m.category, ...(m.ambiguity?.may_code_as ?? [])])]
    const tallies: { inside: boolean; paying: number; total: number }[] = []
    const blocks = ways.map((way, i) => {
      const list = treatments(ctx, m, way, q.family)
      const inside = related(way, q.family)
      tallies.push({
        inside,
        paying: list.filter((t) => t.pays).length,
        total: list.length,
      })
      const { items, fine } = treatmentItems(
        ctx,
        list,
        familyWords,
        codesText(ctx, way),
        !inside,
      )
      const lead =
        i === 0 ? '' : `<p>If it counts ${esc(codesText(ctx, way))}:</p>`
      const quotes =
        fine.length === 0
          ? ''
          : `<ul class="quotes">${fine.map((f) => `<li>${f}</li>`).join('')}</ul>`
      return `${lead}<ul class="quotes">${items.map((t) => `<li>${t}</li>`).join('')}</ul>${finePrint(quotes)}`
    })
    const [main = { inside: false, paying: 0, total: 0 }, ...others] = tallies
    const word = verdict(main, others)
    const codes = codesText(ctx, m.category, m.likely_mcc)
    const cards = `${String(main.total)} cards with a bonus on ${familyWords}`
    const count =
      main.paying === 0
        ? `None of the ${cards} pays there.`
        : main.paying === main.total
          ? `All ${cards} pay there.`
          : main.inside
            ? `${String(main.paying)} of ${cards} pay there.`
            : `${String(main.total - main.paying)} of ${cards} don't pay there.`
    const key = JSON.stringify([word, codes, count, blocks])
    const g = groups.get(key)
    if (g) g.merchants.push(m)
    else
      groups.set(key, {
        merchants: [m],
        word,
        codes,
        count,
        html: blocks.join(''),
      })
  }
  const notesOf = (ms: Merchant[]) => {
    const each = ms.map((m) =>
      [m.note, m.ambiguity?.note].filter((n) => n !== undefined).join(' '),
    )
    if (each.every((n) => n === '')) return ''
    if (each.every((n) => n === each[0]))
      return `<p class="muted">${esc(each[0] ?? '')}</p>`
    return `<ul class="muted">${ms.map((m, i) => (each[i] ? `<li>${esc(m.name)}: ${esc(each[i] ?? '')}</li>` : '')).join('')}</ul>`
  }
  const link = (m: Merchant) => {
    const href = bestHref(m.id)
    return href ? `<a href="${href}">${esc(m.name)}</a>` : esc(m.name)
  }
  const sections = [...groups.values()].map(
    (g) =>
      `<div class="coding-answer"><p class="verdict"><strong>${esc(g.word)}.</strong> ${listed(g.merchants.map(link))} ${g.merchants.length === 1 ? 'codes' : 'code'} ${esc(g.codes)}. ${esc(g.count)}</p>${notesOf(g.merchants)}${g.html}</div>`,
  )
  return `<h2 id="${questionId(q.heading)}">${esc(q.heading)}</h2>${sections.join('')}`
}

export function howStoresCodePage(
  ctx: PageContext,
  bestHref: (merchantId: string) => string | null,
  lastmod: string,
): GeneratedPage {
  const answers = QUESTIONS.map((q) => ({
    q,
    html: answerQuestion(ctx, q, bestHref),
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
      <p class="updated">Updated ${esc(ctx.dayWords(lastmod))}</p>
      <p>Your card's bonus depends on how the store's charge is coded, not on what you bought. A store's page shows every card's rate there.</p>
      ${chipLinks(answers.map((a) => `<a href="#${questionId(a.q.heading)}">${esc(a.q.heading)}</a>`))}
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
