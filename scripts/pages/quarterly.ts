// /quarterly/ and /quarterly/<yyyy-qN>: each rotating card's categories for
// a quarter (Freedom Flex, Discover it) and the cards whose picks reset each
// quarter (Cash+), straight from the card files, plus the cards that earn
// the most on that quarter's categories.
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  type ExploreEntry,
} from '../../src/engine/explore.ts'
import { periodEnd, periodKey } from '../../src/engine/periods.ts'
import { rotationGap, rotationGapText } from '../../src/engine/rotation.ts'
import {
  categoryPhrase,
  earnText,
  listed,
  pct,
  shortDate,
  words,
  capSentence,
} from '../../src/engine/text.ts'
import { findMerchant } from '../../src/merchants/resolve.ts'
import { optionName } from '../../src/engine/rule-text.ts'
import type { Cap, Card, Choice, Rule } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { GeneratedPage, PageContext } from './context.ts'
import { chipLinks, esc, fitDescription, fitTitle, SITE } from './site.ts'

const TOP = 3

export type QuarterCard =
  | {
      kind: 'rotating'
      card: Card
      cap: Cap
      rules: Rule[] // its rules on the rotating cap for this quarter
      gap: string | null // the quarter key, when none are in the data
    }
  | { kind: 'pick'; card: Card; choices: Choice[]; rules: Rule[] }

export type Quarter = {
  key: string // "2026-Q4"
  slug: string // "2026-q4"
  label: string // "Q4 2026"
  start: string
  end: string
  cards: QuarterCard[]
}

const quarterStart = (key: string) => {
  const [year, q] = key.split('-Q')
  return `${year ?? ''}-${String((Number(q) - 1) * 3 + 1).padStart(2, '0')}-01`
}

const rotatingCaps = (card: Card) =>
  card.caps.filter((c) => c.rotating && c.period === 'quarter')

const quarterlyChoices = (card: Card) =>
  card.choices.filter((c) => c.period === 'quarter')

export const quarterlyCardIds = (catalog: Catalog) =>
  catalog.cards
    .filter((c) => rotatingCaps(c).length > 0 || quarterlyChoices(c).length > 0)
    .map((c) => c.id)

// Every quarter some rotating card has rules for, and always the current one.
export function quarters(catalog: Catalog, today: string): Quarter[] {
  const keys = new Set<string>([periodKey('quarter', today, null) ?? ''])
  for (const card of catalog.cards)
    for (const cap of rotatingCaps(card))
      for (const r of card.rules)
        if (r.cap === cap.id && r.valid_from !== undefined)
          keys.add(periodKey('quarter', r.valid_from, null) ?? '')
  return [...keys]
    .filter((k) => k !== '')
    .sort()
    .map((key) => {
      const start = quarterStart(key)
      const end = periodEnd('quarter', key, null) ?? start
      const cards: QuarterCard[] = []
      for (const card of catalog.cards) {
        for (const cap of rotatingCaps(card)) {
          const rules = card.rules.filter(
            (r) =>
              r.cap === cap.id &&
              (r.valid_from ?? '') <= end &&
              (r.valid_to ?? '9999') >= start,
          )
          cards.push({
            kind: 'rotating',
            card,
            cap,
            rules,
            gap: rules.length === 0 ? rotationGap(card, start) : null,
          })
        }
        const choices = quarterlyChoices(card)
        if (choices.length > 0)
          cards.push({
            kind: 'pick',
            card,
            choices,
            rules: card.rules.filter((r) =>
              choices.some((c) => c.id === r.match.choice),
            ),
          })
      }
      return {
        key,
        slug: key.toLowerCase(),
        label: `Q${key.slice(-1)} ${key.slice(0, 4)}`,
        start,
        end,
        cards,
      }
    })
}

// The rate most of the quarter's rotating rules pay: the "5%" in "5%
// categories".
function headlineRate(list: QuarterCard[]): number | null {
  const counts = new Map<number, number>()
  for (const q of list)
    if (q.kind === 'rotating')
      for (const r of q.rules) counts.set(r.rate, (counts.get(r.rate) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null
}

type Target = {
  key: string
  label: string
  link: string | null
  categories: string[]
  merchants: string[]
}

function targetsOf(ctx: PageContext, q: Quarter, slugs: BestSlugs): Target[] {
  const seen = new Map<string, Target>()
  for (const qc of q.cards) {
    if (qc.kind !== 'rotating') continue
    for (const r of qc.rules) {
      for (const c of r.match.categories ?? []) {
        const t: Target = {
          key: `c:${c}`,
          label: categoryPhrase(ctx.catalog, c),
          link: slugs.category(c),
          categories: [c],
          merchants: [],
        }
        if (!seen.has(t.key)) seen.set(t.key, t)
      }
      const ms = r.match.merchants ?? []
      if (ms.length > 0 && !r.match.categories?.length) {
        const key = `m:${[...ms].sort().join(',')}`
        const names = ms.map((id) => ctx.merchantName(id) ?? words(id))
        if (!seen.has(key))
          seen.set(key, {
            key,
            label:
              ms.length <= 3
                ? listed(names)
                : `the ${String(ms.length)} services ${ctx.shortName(qc.card.id)} lists (${listed(names.slice(0, 3))} and others)`,
            link: ms.length === 1 ? slugs.merchant(ms[0] ?? '') : null,
            categories: [],
            merchants: ms,
          })
      }
    }
  }
  return [...seen.values()]
}

export type BestSlugs = {
  category: (id: string) => string | null
  merchant: (id: string) => string | null
}

// The cards that earn the most on a target, ranked by the engine; a group of
// merchants ranks each card by the least it earns at any of them.
function topFor(ctx: PageContext, t: Target, date: string): ExploreEntry[] {
  const options = {
    filters: ALL_PERSONAL_CARDS,
    memberships: [],
    valuations: {},
  }
  const ok = (e: ExploreEntry) =>
    ctx.cards.get(e.cardId)?.rules.find((r) => r.id === e.matchedRule)
      ?.unverified === undefined
  const query = { amount: null, channel: null, date }
  if (t.categories.length > 0) {
    const c = t.categories[0] ?? ''
    return exploreCards(
      ctx.catalog,
      { ...query, merchant: null, category: c },
      options,
    )
      .ranked.filter(ok)
      .slice(0, TOP)
  }
  const runs = t.merchants.map(
    (id) =>
      exploreCards(
        ctx.catalog,
        {
          ...query,
          merchant: findMerchant(ctx.catalog, id)?.name ?? id,
          category: null,
        },
        options,
      ).ranked,
  )
  const least = new Map<string, ExploreEntry>()
  for (const run of runs)
    for (const e of run.filter(ok)) {
      const prev = least.get(e.cardId)
      if (!prev || e.effectiveReturnPct < prev.effectiveReturnPct)
        least.set(e.cardId, e)
    }
  for (const [id] of least)
    if (runs.some((run) => !run.some((e) => e.cardId === id))) least.delete(id)
  return [...least.values()]
    .sort((a, b) => b.effectiveReturnPct - a.effectiveReturnPct)
    .slice(0, TOP)
}

export function activationQuotes(card: Card, rules: Rule[]) {
  const ids = new Set(rules.map((r) => r.id))
  const seen = new Set<string>()
  return card.evidence.filter((e) => {
    if (!ids.has(e.rule) || !/activat/i.test(e.quote) || seen.has(e.quote))
      return false
    seen.add(e.quote)
    return true
  })
}

// `said`: lines and quotes the card's summary already shows.
function ruleItems(
  ctx: PageContext,
  card: Card,
  rules: Rule[],
  said: Set<string> = new Set(),
): string {
  const items = [...rules]
    .sort((a, b) => b.rate - a.rate)
    .map((rule) => {
      // The card's summary line says the cap and activation once for all
      // its categories.
      const lines = ctx
        .ruleConditions(card, rule, { cap: true, activation: true })
        .filter((l) => !said.has(l))
      const quotes = ctx
        .quotesFor(card, rule.id)
        .filter((q) => !said.has(q.quote))
      return `<li><span class="rank">${esc(String(rule.rate))}</span><div><span class="row-head"><strong>${esc(ctx.ruleWhat(card, rule))}</strong> <span class="rate">${esc(earnText(ctx.catalog, rule.rate, card.currency))}</span></span>${rule.note ? `<span class="muted row-note">${esc(rule.note)}</span>` : ''}${lines.length > 0 ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${quotes.map((q) => `<p class="muted">${ctx.quoteHtml(q)}</p>`).join('')}</div></li>`
    })
  return `<ol class="cards rules">${items.join('')}</ol>`
}

function cardSection(ctx: PageContext, q: Quarter, qc: QuarterCard): string {
  const { card } = qc
  const issuer = ctx.issuerName(card.issuer)
  const head = `<div class="card-head small">${ctx.art(card.id, 64)}<h3><a href="/cards/${card.id}">${esc(card.name)}</a></h3></div>`
  if (qc.kind === 'pick') {
    const option = (choice: Choice, id: string) =>
      (choice.options[id]?.merchants.length ?? 0) > 3
        ? words(id)
        : optionName(ctx.catalog, card, choice.id, id)
    const picks = qc.choices.map((choice) => {
      const rates = qc.rules
        .filter((r) => r.match.choice === choice.id)
        .map((r) => earnText(ctx.catalog, r.rate, card.currency))
      const options = Object.keys(choice.options).map((id) =>
        option(choice, id),
      )
      return `<li>Pick ${String(choice.pick)} for ${esc(listed(rates))}: ${esc(options.join('; '))}.${choice.default ? ` If you don't pick, it's ${esc(listed(choice.default.map((id) => option(choice, id))))}.` : ''}</li>`
    })
    const unpicked = qc.choices.some((c) => !c.default)
      ? ` Until you pick, they earn its base rate of ${esc(earnText(ctx.catalog, card.base_rate, card.currency))}.`
      : ''
    return `<section class="quarter-card">${head}<p>Its picks apply from ${esc(shortDate(q.start))} to ${esc(shortDate(q.end))}, and you choose again each quarter.${unpicked}</p><ul>${picks.join('')}</ul>${ruleItems(ctx, card, qc.rules)}</section>`
  }
  if (qc.rules.length === 0)
    return `<section class="quarter-card">${head}<p class="answer">${esc(rotationGapText(ctx.shortName(card.id), qc.gap ?? q.key))}</p></section>`
  const { cap } = qc
  const deadlines = [
    ...new Set(
      qc.rules.map((r) => r.activate_by).filter((d) => d !== undefined),
    ),
  ]
  const needsActivation = qc.rules.some((r) => r.requires?.activation === true)
  const from = qc.rules.map((r) => r.valid_from ?? q.start).sort()[0] ?? q.start
  const to =
    qc.rules
      .map((r) => r.valid_to ?? q.end)
      .sort()
      .at(-1) ?? q.end
  const activation = needsActivation
    ? deadlines.length > 0
      ? `Activate with ${issuer} by ${listed(deadlines.map(shortDate), 'or')}; it's free.`
      : `Activate with ${issuer} first; it's free. ${issuer} hasn't given a deadline in the pages earnrate reads.`
    : 'No activation needed.'
  const quotes = activationQuotes(card, qc.rules)
  // The issuer's page that says how to activate, for the next step.
  const page = (quotes.find((e) => /activat/i.test(e.quote)) ?? quotes[0])?.url
  const go =
    needsActivation && page
      ? ` <a href="${esc(page)}" rel="nofollow noopener">${esc(issuer)}'s activation details</a>.`
      : ''
  const said = new Set([
    `${shortDate(from)} to ${shortDate(to)}`,
    ...quotes.map((e) => e.quote),
  ])
  return `<section class="quarter-card">${head}<p class="answer">${esc(shortDate(from))} to ${esc(shortDate(to))}. ${esc(capSentence(cap, earnText(ctx.catalog, cap.then_rate, card.currency), 'combined purchases in these categories'))}. ${esc(activation)}${go}</p>${quotes.length > 0 ? `<p><strong>From ${esc(issuer)}'s terms:</strong></p><ul class="quotes">${quotes.map((e) => `<li>${ctx.quoteHtml(e)}</li>`).join('')}</ul>` : ''}${ruleItems(ctx, card, qc.rules, said)}</section>`
}

function topSection(ctx: PageContext, q: Quarter, slugs: BestSlugs): string {
  const date = ctx.today > q.start ? ctx.today : q.start
  const blocks = targetsOf(ctx, q, slugs).map((t) => {
    const top = topFor(ctx, t, date)
    if (top.length === 0) return ''
    const rows = top
      .map(
        (e, i) =>
          `<li><span class="rank">${String(i + 1)}</span>${ctx.art(e.cardId)}<div><span class="row-head"><strong><a href="/cards/${e.cardId}">${esc(ctx.shortName(e.cardId))}</a></strong> <span class="rate">${pct(e.effectiveReturnPct)}</span></span><span class="muted row-note">${esc(ctx.issuerName(e.issuer))} · ${esc(ctx.feeLabel(e.cardId))}</span></div></li>`,
      )
      .join('')
    const heading = t.link
      ? `<a href="/best/${t.link}">${esc(t.label)}</a>`
      : esc(t.label)
    return `<h3>On ${heading}</h3><ol class="cards">${rows}</ol>`
  })
  if (blocks.every((b) => b === '')) return ''
  return `<h2>Cards that earn the most on this quarter's categories</h2><p>Ranked by earnrate's engine for ${esc(shortDate(date))}, across every personal card it tracks, each set up at its best: categories activated or picked, and no cap used yet. Points count at earnrate's default value.</p>${blocks.join('')}`
}

const namesFor = (ctx: PageContext, ids: string[], style: number) =>
  listed(
    ids.map((id, i) => {
      const card = ctx.cards.get(id)
      if (!card) return id
      if (style === 0) return ctx.shortName(id)
      if (style === 1)
        return i === 0 ? ctx.shortName(id) : ctx.issuerName(card.issuer)
      return ctx.issuerName(card.issuer)
    }),
  )

function titleFor(ctx: PageContext, q: Quarter, hub: boolean): string {
  const posted = q.cards.filter(
    (c) => c.kind === 'rotating' && c.rules.length > 0,
  )
  const rotating = q.cards.filter((c) => c.kind === 'rotating')
  const ids = [
    ...new Set((posted.length > 0 ? posted : rotating).map((c) => c.card.id)),
  ]
  const rate = headlineRate(q.cards)
  const what = rate === null ? 'bonus categories' : `${pct(rate)} categories`
  const when = hub ? `this quarter (${q.label})` : q.label
  const sep = hub ? ' ' : ', '
  return fitTitle([
    ...[0, 1, 2].map((s) => `${namesFor(ctx, ids, s)} ${what}${sep}${when}`),
    ...(hub
      ? [0, 1, 2].map((s) => `${namesFor(ctx, ids, s)} ${what} this quarter`)
      : []),
    `Rotating ${what}, ${q.label}`,
  ])
}

function descriptionFor(ctx: PageContext, q: Quarter): string {
  const parts = q.cards
    .filter((c) => c.kind === 'rotating')
    .map((c) =>
      c.rules.length === 0
        ? `${ctx.shortName(c.card.id)}: not posted yet`
        : `${ctx.shortName(c.card.id)}: ${listed(c.rules.map((r) => `${pct(r.rate)} ${ctx.ruleWhatRaw(c.card, r)}`))}`,
    )
  const tail = 'Caps, activation deadlines and issuer terms.'
  return fitDescription([
    `${q.label}: ${parts.join('; ')}. ${tail}`,
    `${q.label}: ${listed(parts.map((p) => p.split(':')[0] ?? ''))} quarterly bonus categories, rates, caps, activation deadlines and issuer terms.`,
    `${q.label} rotating bonus categories, rates, caps and activation deadlines, from issuer terms.`,
  ])
}

function renderQuarter(
  ctx: PageContext,
  q: Quarter,
  all: Quarter[],
  slugs: BestSlugs,
  hub: boolean,
  updated: string,
): { title: string; description: string; body: string } {
  const title = titleFor(ctx, q, hub)
  const description = descriptionFor(ctx, q)
  const rotating = q.cards.filter((c) => c.kind === 'rotating')
  const picks = q.cards.filter((c) => c.kind === 'pick')
  const others = all.filter((o) => o.key !== q.key)
  const current = periodKey('quarter', ctx.today, null)
  const nav =
    others.length === 0
      ? ''
      : `<h2>Other quarters</h2>${chipLinks(
          others.map(
            (o) =>
              `<a href="/quarterly/${o.slug}">${esc(o.label)}${o.key === current ? ' (this quarter)' : ''}</a>`,
          ),
        )}`
  const h1 = title.replace(/ \| earnrate$/, '')
  const body = `
      <h1>${esc(h1)}</h1>
      <p class="updated">${esc(shortDate(q.start))} to ${esc(shortDate(q.end))} · Updated ${esc(ctx.dayWords(updated))}</p>
      ${hub ? `<p>This page always shows the current quarter. For a link that stays on ${esc(q.label)}, use <a href="/quarterly/${q.slug}">/quarterly/${q.slug}</a>.</p>` : ''}
      <h2>Rotating categories</h2>
      ${rotating.map((c) => cardSection(ctx, q, c)).join('')}
      ${picks.length > 0 ? `<h2>Categories you pick each quarter</h2>${picks.map((c) => cardSection(ctx, q, c)).join('')}` : ''}
      ${q.end === `${ctx.today.slice(0, 4)}-12-31` ? `<p>Statement credits, spend bonuses and caps that end or start over with the year, on every card: <a href="/year-end/">year-end deadlines</a>.</p>` : ''}
      ${topSection(ctx, q, slugs)}
      ${nav}
      <p class="muted">Every rate, cap, date and quote here is from the card's file in earnrate, checked against the issuer's pages on the date each card page shows. Check the issuer's terms before you rely on them.</p>`
  return { title, description, body }
}

export function quarterlyPages(
  ctx: PageContext,
  slugs: BestSlugs,
  lastmod: (files: string[]) => string,
): GeneratedPage[] {
  const all = quarters(ctx.catalog, ctx.today)
  const date = lastmod(
    quarterlyCardIds(ctx.catalog).map((id) => `data/cards/${id}.yaml`),
  )
  const current = periodKey('quarter', ctx.today, null)
  const page = (q: Quarter, hub: boolean): GeneratedPage => {
    const { title, description, body } = renderQuarter(
      ctx,
      q,
      all,
      slugs,
      hub,
      date,
    )
    const path = hub ? '/quarterly/' : `/quarterly/${q.slug}`
    return {
      file: hub ? 'quarterly/index.html' : `quarterly/${q.slug}.html`,
      path,
      lastmod: date,
      html: ctx.layout({
        title,
        description,
        path,
        body,
        crumbs: hub
          ? [{ name: 'Quarterly categories', path: '/quarterly/' }]
          : [
              { name: 'Quarterly categories', path: '/quarterly/' },
              { name: q.label, path },
            ],
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: title,
          description,
          url: `${SITE}${path}`,
          dateModified: date,
          temporalCoverage: `${q.start}/${q.end}`,
        },
      }),
    }
  }
  const now = all.find((q) => q.key === current)
  return [...(now ? [page(now, true)] : []), ...all.map((q) => page(q, false))]
}
