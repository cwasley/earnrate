// /categories/<category>: what each issuer's bonus in a category covers and
// leaves out, side by side, quoted from the card files' evidence.
import { categoryMatches } from '../../src/engine/evaluate.ts'
import { optionName } from '../../src/engine/rule-text.ts'
import {
  capitalize,
  earnText,
  listed,
  PICK_PERIODS,
} from '../../src/engine/text.ts'
import { findMerchant } from '../../src/merchants/resolve.ts'
import type { Card, Rule } from '../../src/schema/card.ts'
import type { GeneratedPage, PageContext } from './context.ts'
import { chipLinks, esc, fitDescription, fitTitle, SITE } from './site.ts'

// The categories people search definitions for, by the word they use.
const CATEGORY_PAGES: { slug: string; category: string }[] = [
  { slug: 'dining', category: 'dining' },
  { slug: 'groceries', category: 'grocery' },
  { slug: 'gas', category: 'gas' },
  { slug: 'travel', category: 'travel' },
  { slug: 'streaming', category: 'streaming' },
  { slug: 'transit', category: 'transit' },
]

// The definition page for a category or its parent, for links from stores.
export function categoryPageFor(category: string): string | null {
  return (
    CATEGORY_PAGES.find((p) => categoryMatches(p.category, category))?.slug ??
    null
  )
}

const related = (a: string, b: string) =>
  categoryMatches(a, b) || categoryMatches(b, a)

type Definition = {
  card: Card
  rule: Rule
  option: string | null // the pick that covers it, for a choice rule
  tiers: Rule[] // the same rule at a higher rate with a membership
}

// Rules that differ only by a membership tier (BofA's Preferred Rewards)
// read as one: the plain rule, with its best tier.
function foldTiers(defs: Definition[]): Definition[] {
  const kept: Definition[] = []
  for (const d of defs) {
    const same = kept.find(
      (k) =>
        k.card === d.card &&
        k.option === d.option &&
        JSON.stringify(k.rule.match) === JSON.stringify(d.rule.match),
    )
    if (!same) {
      kept.push(d)
      continue
    }
    if (
      same.rule.requires?.membership !== undefined &&
      d.rule.requires?.membership === undefined
    ) {
      same.tiers.push(same.rule)
      same.rule = d.rule
    } else same.tiers.push(d.rule)
  }
  return kept
}

// The quotes that say what's covered; ones that only state the rate or cap
// are on the card's page.
const RATE_ONLY = /\d%|\d+x\b|\$\d|\bbonus of\b|\btier\b/i
function definingQuotes(ctx: PageContext, card: Card, rule: Rule) {
  const all = ctx.quotesFor(card, rule.id)
  const defining = all.filter((q) => !RATE_ONLY.test(q.quote))
  return defining.length > 0 ? defining : all.slice(0, 1)
}

function definitions(ctx: PageContext, family: string): Definition[] {
  const found: Definition[] = []
  for (const card of ctx.catalog.cards) {
    if (card.applications_closed !== undefined) continue
    for (const rule of card.rules) {
      if (rule.rate <= card.base_rate || rule.unverified !== undefined) continue
      if (rule.valid_to !== undefined && rule.valid_to < ctx.today) continue
      const m = rule.match
      if (m.choice !== undefined) {
        const choice = card.choices.find((c) => c.id === m.choice)
        const option = Object.entries(choice?.options ?? {}).find(([, o]) =>
          o.categories.some((c) => related(c, family)),
        )?.[0]
        if (option !== undefined) found.push({ card, rule, option, tiers: [] })
        continue
      }
      if (
        m.categories?.some((c) => related(c, family)) &&
        !m.merchants?.length
      ) {
        found.push({ card, rule, option: null, tiers: [] })
        continue
      }
      const ms = m.merchants ?? []
      if (
        ms.length >= 3 &&
        !m.categories?.length &&
        ms.every((id) => {
          const cat = findMerchant(ctx.catalog, id)?.category
          return cat !== undefined && related(cat, family)
        })
      )
        found.push({ card, rule, option: null, tiers: [] })
    }
  }
  return foldTiers(found)
}

function definitionBlock(ctx: PageContext, defs: Definition[]): string {
  const [first] = defs
  if (!first) return ''
  const { card, rule, option } = first
  const choice = card.choices.find((c) => c.id === rule.match.choice)
  const what =
    option && choice
      ? `${optionName(ctx.catalog, card, choice.id, option)} (${choice.pick === 1 ? 'the category' : `one of the ${String(choice.pick)} categories`} you pick${choice.period === 'until_changed' ? '' : ` ${PICK_PERIODS[choice.period]}`})`
      : ctx.ruleWhatRaw(card, rule)
  const lines = ctx
    .ruleConditions(card, rule)
    .filter((l) => !/^Up to \$/.test(l))
  const quotes = definingQuotes(ctx, card, rule)
  const rateOf = (d: Definition) => {
    const top = [...d.tiers].sort((a, b) => b.rate - a.rate)[0]
    const earn = earnText(ctx.catalog, d.rule.rate, d.card.currency)
    const membership = top?.requires?.membership
    return top && membership
      ? `${earn}, up to ${earnText(ctx.catalog, top.rate, d.card.currency)} with ${ctx.membershipName(membership)}`
      : earn
  }
  const cardsLine = listed(
    defs.map(
      (d) =>
        `<a href="/cards/${d.card.id}">${esc(ctx.shortName(d.card.id))}</a> (${esc(rateOf(d))})`,
    ),
  )
  return `<div class="definition"><p><strong>${esc(capitalize(what))}</strong>: ${cardsLine}</p>${rule.note ? `<p class="muted">${esc(rule.note)}</p>` : ''}${lines.length > 0 ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${quotes.length > 0 ? `<ul class="quotes">${quotes.map((q) => `<li>${ctx.quoteHtml(q)}</li>`).join('')}</ul>` : ''}</div>`
}

export function categoryPages(
  ctx: PageContext,
  bestSlug: (category: string) => string | null,
  lastmod: (files: string[]) => string,
): GeneratedPage[] {
  const built = CATEGORY_PAGES.flatMap((p) => {
    const defs = definitions(ctx, p.category)
    if (defs.length === 0) return []
    const byIssuer = new Map<string, Map<string, Definition[]>>()
    for (const d of defs) {
      // Cards whose rule reads and is quoted the same share one block.
      const key = JSON.stringify([
        d.option,
        ctx.ruleWhatRaw(d.card, d.rule),
        d.rule.note ?? '',
        ctx.ruleConditions(d.card, d.rule).filter((l) => !/^Up to \$/.test(l)),
        definingQuotes(ctx, d.card, d.rule).map((q) => q.quote),
      ])
      const issuer =
        byIssuer.get(d.card.issuer) ?? new Map<string, Definition[]>()
      issuer.set(key, [...(issuer.get(key) ?? []), d])
      byIssuer.set(d.card.issuer, issuer)
    }
    const issuers = [...byIssuer].sort((a, b) =>
      ctx.issuerName(a[0]).localeCompare(ctx.issuerName(b[0])),
    )
    const names = issuers.map(([id]) => ctx.issuerName(id))
    const label = p.slug
    const title = fitTitle([
      `What counts as ${label}? Each card issuer's terms`,
      `What counts as ${label}? Issuer definitions`,
      `What counts as ${label}`,
    ])
    const description = fitDescription([
      `How ${listed(names)} define ${label} for their card bonuses, with what's left out, quoted from each card's terms.`,
      `How ${String(names.length)} card issuers define ${label} for their bonuses, with what's left out, quoted from each card's terms.`,
    ])
    const ranking = bestSlug(p.category)
    const path = `/categories/${p.slug}`
    const body = `
      <h1>What counts as ${esc(label)}</h1>
      <p class="updated">${String(defs.length)} bonus rules from ${String(issuers.length)} issuers · Updated ${esc(ctx.todayWords)}</p>
      <p>Each issuer decides what its ${esc(label)} bonus covers, mostly by how the store's charge is coded. Here is every bonus on ${esc(label)} in earnrate's data, grouped by issuer, with the issuer's own words.${ranking ? ` For which card earns the most, see the <a href="/best/${ranking}">${esc(label)} ranking</a>.` : ''}</p>
      <div class="issuers">${issuers
        .map(
          ([id, blocks]) =>
            `<section class="issuer"><h2>${esc(ctx.issuerName(id))}</h2>${[...blocks.values()].map((d) => definitionBlock(ctx, d)).join('')}</section>`,
        )
        .join('')}</div>
      <p class="muted">Open cards only. Caps and rates are on each card's page; rotating and limited-time bonuses show their dates.</p>
      <h2>Other categories</h2>
      ${chipLinks(
        CATEGORY_PAGES.filter((o) => o !== p).map(
          (o) => `<a href="/categories/${o.slug}">${esc(o.slug)}</a>`,
        ),
      )}`
    const cardFiles = [
      ...new Set(defs.map((d) => `data/cards/${d.card.id}.yaml`)),
    ]
    const date = lastmod([...cardFiles, 'data/categories.yaml'])
    const page: GeneratedPage = {
      file: `categories/${p.slug}.html`,
      path,
      lastmod: date,
      html: ctx.layout({
        title,
        description,
        path,
        body,
        crumbs: [
          { name: 'Categories', path: '/categories/' },
          { name: capitalize(label), path },
        ],
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: title,
          description,
          url: `${SITE}${path}`,
          dateModified: date,
        },
      }),
    }
    return [
      {
        page,
        label,
        issuers: issuers.length,
        rules: defs.length,
        files: cardFiles,
      },
    ]
  })
  const indexDate = lastmod([
    ...new Set(built.flatMap((b) => b.files)),
    'data/categories.yaml',
  ])
  const title = fitTitle([
    'What each card issuer counts as dining, groceries and gas',
    'What each issuer counts in a bonus category',
  ])
  const description = fitDescription([
    `What ${listed(built.map((b) => b.label))} mean to each card issuer, quoted side by side from their terms.`,
  ])
  const index: GeneratedPage = {
    file: 'categories/index.html',
    path: '/categories/',
    lastmod: indexDate,
    html: ctx.layout({
      title,
      description,
      path: '/categories/',
      crumbs: [{ name: 'Categories', path: '/categories/' }],
      body: `
      <h1>What each category covers</h1>
      <p class="updated">Updated ${esc(ctx.todayWords)}</p>
      <p>The same word means different things to different issuers. Each page puts their definitions and exclusions side by side, from the cards' terms.</p>
      <ul>${built.map((b) => `<li><a href="/categories/${b.page.path.split('/').at(-1) ?? ''}">${esc(capitalize(b.label))}</a>: ${String(b.rules)} bonus rules from ${String(b.issuers)} issuers</li>`).join('')}</ul>`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        url: `${SITE}/categories/`,
      },
    }),
  }
  return [index, ...built.map((b) => b.page)]
}
