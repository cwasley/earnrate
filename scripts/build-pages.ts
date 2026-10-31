// Writes the static search pages into site-dist/ after `vite build site`:
// /best/<store> and /best/<category>, plus sitemap.xml and robots.txt.
// Every page is plain HTML rendered from the same engine as the app, so
// search engines and AI answer tools can read it without running JavaScript.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, loadCatalog, type Catalog } from '../src/data/load.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  type Exploration,
  type ExploreEntry,
  type ExploreQuery,
  type Requirements,
} from '../src/engine/explore.ts'
import { localToday } from '../src/engine/periods.ts'
import {
  categoryPhrase,
  currencyName,
  earnText,
} from '../src/engine/recommend.ts'
import type { Card, Rule } from '../src/schema/card.ts'
import type { Merchant } from '../src/schema/merchant.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(ROOT, 'site-dist')
const SITE = 'https://earnrate.dev'
const TOP = 10
const ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='7' width='26' height='18' rx='3' fill='%231f6f54'/%3E%3Crect x='3' y='11' width='26' height='3' fill='%23ffffff' opacity='.85'/%3E%3C/svg%3E"
const RELATED = 8

const catalog = await loadCatalog()
const dataVersion = (await readFile(`${DATA_DIR}VERSION`, 'utf8')).trim()
const today = localToday()
const monthYear = new Date(`${today}T12:00:00`).toLocaleDateString('en-US', {
  month: 'long',
  year: 'numeric',
})
const longDate = new Date(`${today}T12:00:00`).toLocaleDateString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const pct = (n: number) => `${String(Number(n.toFixed(2)))}%`
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.+]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const cards = new Map(catalog.cards.map((c) => [c.id, c]))

function shortName(id: string): string {
  const name = cards.get(id)?.name ?? id
  return name
    .replace(/^American Express /, 'Amex ')
    .replace(/^The Platinum Card from American Express$/, 'Amex Platinum')
    .replace(/ (Visa Signature |Visa Infinite )?(Credit )?Card$/, '')
    .replace(/ Card by /, ' by ')
}

const ISSUERS: Record<string, string> = {
  amex: 'American Express',
  'bank-of-america': 'Bank of America',
  'capital-one': 'Capital One',
  chase: 'Chase',
  citi: 'Citi',
  column: 'Bilt',
  sofi: 'SoFi',
  'td-bank': 'TD Bank',
  usbank: 'U.S. Bank',
  'wells-fargo': 'Wells Fargo',
}

const MEMBERSHIPS: Record<string, string> = {
  'amazon-prime': 'Amazon Prime',
  'bank-of-america-account': 'a Bank of America account',
}

function feeText(id: string): string {
  const card = cards.get(id)
  const fee = card?.annual_fee
  if (fee === undefined) return 'Fee not on file'
  if (fee === 0) return 'No annual fee'
  const first = card?.first_year_fee
  if (first !== undefined && first !== fee)
    return `${usd(fee)} a year (${first === 0 ? '$0' : usd(first)} the first year)`
  return `${usd(fee)} a year`
}

const words = (id: string) => id.replace(/[-_.]/g, ' ')

const PICK_PERIODS = {
  month: 'each month',
  quarter: 'each quarter',
  calendar_year: 'each year',
  until_changed: 'until you change it',
}

const CAP_PERIODS: Record<string, string> = {
  month: 'a month',
  quarter: 'a quarter',
  calendar_year: 'a year',
  cardmember_year: 'a card year',
}

function untilText(entry: ExploreEntry): string | null {
  const rule = cards
    .get(entry.cardId)
    ?.rules.find((r) => r.id === entry.matchedRule)
  if (rule?.valid_to === undefined) return null
  return new Date(`${rule.valid_to}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function needs(entry: ExploreEntry): string[] {
  const r: Requirements = entry.requirements
  const lines: string[] = []
  if (r.pick)
    lines.push(
      `Pick ${r.pick.options.map(words).join(' or ')} as a bonus category (${PICK_PERIODS[r.pick.period]})`,
    )
  if (r.activation !== null)
    lines.push(
      `Activate the bonus with ${ISSUERS[entry.issuer] ?? entry.issuer} (free)`,
    )
  const until = untilText(entry)
  if (until !== null) lines.push(`This rate runs through ${until}`)
  if (r.cap)
    lines.push(
      `Up to ${usd(r.cap.amount)} of spending ${CAP_PERIODS[r.cap.period] ?? ''}, then ${earnText(catalog, r.cap.thenRate, r.cap.currency)}`,
    )
  return lines
}

const isUnverified = (e: ExploreEntry) =>
  cards.get(e.cardId)?.rules.find((r) => r.id === e.matchedRule)?.unverified !==
  undefined

type Page = {
  slug: string
  label: string // "Whole Foods Market" or "groceries"
  query: ExploreQuery
  categoryId: string
  merchant: Merchant | null
}

// Booking-portal variants ("Hotel through Amex Travel") answer the same
// question as their portal page, so they don't get pages of their own.
const skipMerchant = (m: Merchant) => / through |\(.*Travel\)/.test(m.name)

const CATEGORY_SLUGS: Record<string, string> = { other: 'everyday-spending' }

function pages(c: Catalog): Page[] {
  const byId = new Map<string, Merchant>()
  for (const m of [...c.merchants.seed, ...c.merchants.overrides])
    byId.set(m.id, m)
  const list: Page[] = []
  for (const m of byId.values()) {
    if (skipMerchant(m)) continue
    list.push({
      slug: m.id,
      label: m.name,
      query: {
        merchant: m.name,
        category: null,
        amount: null,
        channel: null,
        date: today,
      },
      categoryId: m.category,
      merchant: m,
    })
  }
  for (const cat of c.categories) {
    list.push({
      slug: CATEGORY_SLUGS[cat.id] ?? slugify(cat.aliases[0] ?? cat.name),
      label: categoryPhrase(c, cat.id),
      query: {
        merchant: null,
        category: cat.id,
        amount: null,
        channel: null,
        date: today,
      },
      categoryId: cat.id,
      merchant: null,
    })
  }
  const seen = new Set<string>()
  for (const p of list) {
    if (seen.has(p.slug)) throw new Error(`two pages want /best/${p.slug}`)
    seen.add(p.slug)
  }
  return list
}

const options = {
  filters: ALL_PERSONAL_CARDS,
  memberships: [],
  valuations: {},
}

function answer(page: Page, r: Exploration, shown: ExploreEntry[]): string {
  const [top] = shown
  if (!top) return `<p>No card in earnrate's data earns a bonus here.</p>`
  const where = `${page.merchant === null && page.categoryId === 'other' ? 'on' : 'at'} ${esc(page.label)}`
  const codes =
    page.merchant === null || r.merchant.source === 'none'
      ? ''
      : ` ${esc(page.label)} usually codes as ${esc(categoryPhrase(catalog, r.merchant.category))}${r.merchant.likelyMcc === null ? '' : ` (MCC ${String(r.merchant.likelyMcc)})`}.`
  const parts = [
    `<strong><a href="/cards/${top.cardId}">${esc(shortName(top.cardId))}</a></strong> earns the most ${where}: ${pct(top.effectiveReturnPct)}${top.currency === 'cash' ? ' cash back' : ' in points at 1¢ each'}.${codes}`,
  ]
  const first = needs(top)
  if (first.length > 0) parts.push(`${first.join('. ')}.`)
  const noFee = shown.find((e) => e.annualFee === 0)
  if (noFee && noFee !== top)
    parts.push(
      `With no annual fee, <strong>${esc(shortName(noFee.cardId))}</strong> earns ${pct(noFee.effectiveReturnPct)}.`,
    )
  const membership = shown
    .flatMap((e) => e.withMembership.map((m) => ({ entry: e, ...m })))
    .filter((m) => MEMBERSHIPS[m.membership] !== undefined)
    .sort((a, b) => b.effectiveReturnPct - a.effectiveReturnPct)[0]
  if (
    membership &&
    membership.effectiveReturnPct >= (noFee ?? top).effectiveReturnPct
  )
    parts.push(
      `With ${MEMBERSHIPS[membership.membership] ?? ''}, <strong>${esc(shortName(membership.entry.cardId))}</strong> earns ${pct(membership.effectiveReturnPct)}${membership.entry.annualFee === 0 && membership.entry !== noFee ? ', also with no annual fee' : ''}.`,
    )
  return `<p class="answer">${parts.join(' ')}</p>`
}

function gotchas(r: Exploration): string {
  const items: string[] = []
  for (const w of r.warnings) items.push(esc(w))
  const reasons = new Map<string, number>()
  for (const e of r.excluded)
    reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1)
  for (const [reason, count] of reasons)
    items.push(
      `${esc(reason)} ${count === 1 ? 'One card is' : `${String(count)} cards are`} left out.`,
    )
  if (r.merchant.merchantId !== null) {
    const note = [
      ...catalog.merchants.overrides,
      ...catalog.merchants.seed,
    ].find((m) => m.id === r.merchant.merchantId)?.note
    if (note) items.push(esc(note))
  }
  return items.length === 0
    ? ''
    : `<h2>Good to know</h2><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
}

function table(shown: ExploreEntry[]): string {
  const rows = shown
    .map((e, i) => {
      const lines = needs(e)
      const upgrade = e.withMembership[0]
      if (upgrade && MEMBERSHIPS[upgrade.membership])
        lines.push(
          `${pct(upgrade.effectiveReturnPct)} with ${MEMBERSHIPS[upgrade.membership] ?? ''}`,
        )
      return `<li><span class="rank">${String(i + 1)}</span><div><strong><a href="/cards/${e.cardId}">${esc(shortName(e.cardId))}</a></strong> <span class="rate">${pct(e.effectiveReturnPct)}</span><br /><span class="muted">${esc(ISSUERS[e.issuer] ?? e.issuer)} · ${esc(feeText(e.cardId))}</span>${lines.length > 0 ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div></li>`
    })
    .join('')
  return `<ol class="cards">${rows}</ol>`
}

function sources(shown: ExploreEntry[]): string {
  const items = shown
    .slice(0, 3)
    .filter((e) => e.evidence)
    .map((e) => {
      const card = cards.get(e.cardId)
      const ev = e.evidence
      if (!ev || !card) return ''
      const host = new URL(ev.url).hostname.replace(/^www\./, '')
      return `<li><strong><a href="/cards/${e.cardId}">${esc(shortName(e.cardId))}</a>:</strong> “${esc(ev.quote)}” <a href="${esc(ev.url)}" rel="nofollow noopener">${esc(host)}</a>, checked ${esc(card.last_verified)}.</li>`
    })
    .join('')
  return items === ''
    ? ''
    : `<h2>From the issuers' terms</h2><ul class="quotes">${items}</ul>`
}

function related(page: Page, all: Page[]): string {
  const category = all.find(
    (p) => p.merchant === null && p.categoryId === page.categoryId,
  )
  const siblings = all
    .filter(
      (p) =>
        p !== page && p.merchant !== null && p.categoryId === page.categoryId,
    )
    .slice(0, RELATED)
  const links = [
    ...(category && category !== page
      ? [`<a href="/best/${category.slug}">${esc(category.label)}</a>`]
      : []),
    ...siblings.map((p) => `<a href="/best/${p.slug}">${esc(p.label)}</a>`),
  ]
  return links.length === 0
    ? ''
    : `<h2>Related</h2><p class="links">${links.join(' · ')}</p>`
}

function layout(
  title: string,
  description: string,
  canonical: string,
  body: string,
  jsonLd: object,
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="color-scheme" content="light dark" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="earnrate" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${SITE}/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="theme-color" content="#1f6f54" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="icon" href="${ICON}" />
    <link rel="stylesheet" href="/pages.css" />
    <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  </head>
  <body>
    <main>
      <header><a class="wordmark" href="/">earnrate</a></header>
${body}
      <footer>
        <p>earnrate compares ${String(catalog.cards.length)} US cards using each issuer's own terms. No affiliate links, ever: rankings depend only on those terms. Card data ${esc(dataVersion)}, updated ${esc(longDate)}. Rates change, so check the issuer's terms before you apply.</p>
        <p><a href="/">earnrate.dev</a> · <a href="/best/">Best card for every store</a> · <a href="/cards/">All cards</a> · <a href="/privacy">Privacy</a></p>
      </footer>
    </main>
  </body>
</html>
`
}

const ranked = (r: Exploration) =>
  r.ranked.filter((e) => !isUnverified(e)).slice(0, TOP)

function renderPage(page: Page, all: Page[], r: Exploration): string {
  const hidden = r.ranked.filter(isUnverified)
  const shown = ranked(r)
  const top = shown[0]
  const subject = page.label
  const title =
    page.merchant === null
      ? `Best credit card for ${subject} (${monthYear}) | earnrate`
      : `Best credit card to use at ${subject} (${monthYear}) | earnrate`
  const description = top
    ? `${shortName(top.cardId)} earns ${pct(top.effectiveReturnPct)} ${page.merchant === null ? 'on' : 'at'} ${subject}. Compare ${String(r.ranked.length)} cards by rate, annual fee and conditions, quoted from issuer terms. No affiliate links.`
    : `Which credit card earns the most ${page.merchant === null ? 'on' : 'at'} ${subject}, compared across ${String(catalog.cards.length)} cards from issuer terms.`
  const canonical = `${SITE}/best/${page.slug}`
  const appLink = `/#best=${encodeURIComponent(page.merchant?.name ?? catalog.categories.find((c) => c.id === page.categoryId)?.name ?? page.label).replace(/%20/g, '+')}`
  const body = `
      <h1>Best credit card ${page.merchant === null ? 'for' : 'to use at'} ${esc(subject)}</h1>
      <p class="updated">Updated ${esc(longDate)}</p>
      ${answer(page, r, shown)}
      <p><a class="button" href="${appLink}">Check with your own cards</a></p>
      <h2>Top ${String(shown.length)} cards ${page.merchant === null ? 'for' : 'at'} ${esc(subject)}</h2>
      ${table(shown)}
      ${hidden.length > 0 ? `<p class="muted">Not ranked: ${hidden.map((e) => esc(shortName(e.cardId))).join(', ')}, whose rate here isn't confirmed against the issuer's terms yet.</p>` : ''}
      ${gotchas(r)}
      ${sources(shown)}
      <h2>How this is ranked</h2>
      <p>Every personal card earnrate tracks, each set up at its best for this purchase: the right bonus-category pick, any activation done, and no spending cap used up yet. Points are counted at 1¢, what most are worth as cash or travel credit; transferring them to airlines or hotels can be worth more. Annual fees aren't subtracted here; to weigh them against your own spending, use <a href="/#spending">My spending</a>.</p>
      ${related(page, all)}`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: canonical,
    dateModified: today,
    mainEntity: {
      '@type': 'ItemList',
      name: `Best credit cards ${page.merchant === null ? 'for' : 'at'} ${subject}`,
      itemListElement: shown.map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: cards.get(e.cardId)?.name ?? e.cardId,
        description: `${pct(e.effectiveReturnPct)} back; ${feeText(e.cardId)}`,
      })),
    },
  }
  return layout(title, description, canonical, body, jsonLd)
}

function renderIndex(all: Page[]): string {
  const section = (heading: string, list: Page[]) =>
    `<h2>${heading}</h2><p class="links">${list
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((p) => `<a href="/best/${p.slug}">${esc(p.label)}</a>`)
      .join(' · ')}</p>`
  const body = `
      <h1>Best credit card for every store and category</h1>
      <p class="updated">Updated ${esc(longDate)}</p>
      <p>Which of ${String(catalog.cards.length)} US credit cards earns the most, store by store, from each issuer's own terms. No affiliate links.</p>
      ${section(
        'Categories',
        all.filter((p) => p.merchant === null),
      )}
      ${section(
        'Stores',
        all.filter((p) => p.merchant !== null),
      )}`
  return layout(
    'Best credit card for every store and category | earnrate',
    `Which credit card earns the most at ${String(all.filter((p) => p.merchant).length)} stores and ${String(all.filter((p) => !p.merchant).length)} spending categories, from issuer terms. No affiliate links.`,
    `${SITE}/best/`,
    body,
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      url: `${SITE}/best/`,
    },
  )
}

const merchantNames = new Map(
  [...catalog.merchants.seed, ...catalog.merchants.overrides].map((m) => [
    m.id,
    m.name,
  ]),
)

const listWords = (items: string[], joiner = 'and') =>
  items.length <= 2
    ? items.join(` ${joiner} `)
    : `${items.slice(0, -1).join(', ')} ${joiner} ${items.at(-1) ?? ''}`

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function ruleWhat(card: Card, rule: Rule): string {
  return capitalize(ruleWhatRaw(card, rule))
}

function ruleWhatRaw(card: Card, rule: Rule): string {
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
    parts.push(
      listWords(m.merchants.map((id) => merchantNames.get(id) ?? words(id))),
    )
  if (m.categories?.length) {
    const cats = listWords(
      m.categories.map((id) => categoryPhrase(catalog, id)),
    )
    parts.push(m.merchants?.length ? `when it codes as ${cats}` : cats)
  }
  if (m.mccs?.length)
    parts.push(`purchases coded MCC ${m.mccs.map(String).join(', ')}`)
  return parts.join(' ')
}

function ruleConditions(card: Card, rule: Rule): string[] {
  const lines: string[] = []
  const ex = rule.exclude
  if (ex) {
    const names = [
      ...(ex.categories ?? []).map((id) => categoryPhrase(catalog, id)),
      ...(ex.merchants ?? []).map((id) => merchantNames.get(id) ?? words(id)),
    ]
    if (names.length > 0) lines.push(`Not at ${listWords(names, 'or')}`)
  }
  if (rule.channel === 'online') lines.push('Online only')
  if (rule.channel === 'in_store') lines.push('In store only')
  if (rule.geography === 'us_only') lines.push('U.S. purchases only')
  if (rule.requires?.membership !== undefined)
    lines.push(
      `With ${MEMBERSHIPS[rule.requires.membership] ?? words(rule.requires.membership)}`,
    )
  if (rule.requires?.activation === true)
    lines.push(`Activate it with ${ISSUERS[card.issuer] ?? card.issuer} first`)
  if (rule.valid_from !== undefined || rule.valid_to !== undefined)
    lines.push(
      rule.valid_from !== undefined && rule.valid_to !== undefined
        ? `${shortDate(rule.valid_from)} to ${shortDate(rule.valid_to)}`
        : rule.valid_to !== undefined
          ? `Through ${shortDate(rule.valid_to)}`
          : `From ${shortDate(rule.valid_from ?? '')}`,
    )
  const cap =
    typeof rule.cap === 'string'
      ? card.caps.find((c) => c.id === rule.cap)
      : rule.cap
  if (cap)
    lines.push(
      `Up to ${usd(cap.amount)} of spending ${CAP_PERIODS[cap.period] ?? ''}${typeof rule.cap === 'string' ? ' (shared with its other bonus categories on this cap)' : ''}, then ${earnText(catalog, cap.then_rate, card.currency)}`,
    )
  if (rule.unverified !== undefined)
    lines.push("Not yet confirmed against the issuer's terms")
  return lines
}

function evidenceFor(card: Card, ruleId: string): string {
  const ev = card.evidence.find((e) => e.rule === ruleId)
  if (!ev) return ''
  const host = new URL(ev.url).hostname.replace(/^www\./, '')
  return `<p class="muted">“${esc(ev.quote)}” <a href="${esc(ev.url)}" rel="nofollow noopener">${esc(host)}</a></p>`
}

function rulesList(card: Card): string {
  const rules = [...card.rules].sort((a, b) => b.rate - a.rate)
  const items = rules.map((rule) => {
    const lines = ruleConditions(card, rule)
    return `<li><span class="rank">${esc(String(Number(rule.rate.toFixed(2))))}</span><div><strong>${esc(ruleWhat(card, rule))}</strong> <span class="rate">${esc(earnText(catalog, rule.rate, card.currency))}</span>${rule.note ? `<br /><span class="muted">${esc(rule.note)}</span>` : ''}${lines.length > 0 ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${evidenceFor(card, rule.id)}</div></li>`
  })
  items.push(
    `<li><span class="rank">${esc(String(card.base_rate))}</span><div><strong>Everything else</strong> <span class="rate">${esc(earnText(catalog, card.base_rate, card.currency))}</span>${evidenceFor(card, 'base_rate')}</div></li>`,
  )
  return `<ol class="cards">${items.join('')}</ol>`
}

function choicesText(card: Card): string {
  if (card.choices.length === 0) return ''
  const items = card.choices.map((c) => {
    const options = Object.keys(c.options).map(words)
    const when = PICK_PERIODS[c.period]
    return `<li>Pick ${String(c.pick)} of: ${esc(listWords(options))} (${esc(when)})${c.default ? `. If you don't pick, it's ${esc(listWords(c.default.map(words)))}` : ''}.</li>`
  })
  return `<h2>Categories you choose</h2><ul>${items.join('')}</ul>`
}

function offerText(card: Card): string {
  const o = card.welcome_offer
  if (!o || (o.valid_to !== undefined && o.valid_to < today)) return ''
  const reward =
    o.points !== undefined
      ? `${o.points.toLocaleString('en-US')} ${currencyName(catalog, card.currency)}`
      : usd(o.dollars ?? 0)
  const spend =
    o.spend > 0
      ? `after ${usd(o.spend)} in purchases in ${String(o.months)} month${o.months === 1 ? '' : 's'}`
      : 'with no spending required'
  return `<h2>Public welcome offer</h2><p>${esc(reward)} ${esc(spend)}${o.valid_to ? `, through ${esc(shortDate(o.valid_to))}` : ''}, per the issuer's page. Offers vary by person and by how you apply.${o.note ? ` ${esc(o.note)}` : ''}</p>`
}

function placements(
  card: Card,
  all: Page[],
  byPage: Map<string, Exploration>,
): { page: Page; rank: number; pct: number }[] {
  const found: { page: Page; rank: number; pct: number }[] = []
  for (const page of all) {
    const r = byPage.get(page.slug)
    if (!r) continue
    const list = ranked(r)
    const i = list.findIndex((e) => e.cardId === card.id)
    const entry = list[i]
    if (
      entry &&
      i < 3 &&
      entry.effectiveReturnPct > card.base_rate * entry.centsPerUnit + 1e-9
    )
      found.push({ page, rank: i + 1, pct: entry.effectiveReturnPct })
  }
  return found.sort((a, b) => a.rank - b.rank || b.pct - a.pct)
}

// Categories bought as a service read "on" (3x on flights); places, "at".
const ON_CATEGORIES = [
  'travel',
  'transit',
  'streaming',
  'tv_internet',
  'phone',
  'utilities',
  'online_retail',
  'ev_charging',
  'shipping',
  'online_advertising',
  'entertainment',
]

const isPortal = (id: string) =>
  /travel|through|entertainment/i.test(merchantNames.get(id) ?? id)

// The card's best everyday categories, then its best single-store bonus
// (Prime Visa at Amazon) unless it's an issuer's travel site, which stay in
// the full list below.
function headlineFor(card: Card): string {
  const current = card.rules.filter((r) => r.valid_to === undefined)
  const everyday = current
    .filter(
      (r) =>
        r.requires?.membership === undefined &&
        (r.match.categories?.length || r.match.choice !== undefined) &&
        !r.match.merchants?.length,
    )
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 4)
  const byRate = new Map<number, string[]>()
  for (const r of everyday) {
    const on =
      r.match.choice !== undefined ||
      (r.match.categories ?? []).every((c) =>
        ON_CATEGORIES.some((o) => c === o || c.startsWith(`${o}.`)),
      )
    byRate.set(r.rate, [
      ...(byRate.get(r.rate) ?? []),
      `${on ? 'on' : 'at'} ${ruleWhatRaw(card, r)}`,
    ])
  }
  const clauses = [...byRate].map(
    ([rate, whats]) =>
      `${earnText(catalog, rate, card.currency)} ${listWords(whats)}`,
  )

  const stores = current
    .filter(
      (r) =>
        r.match.merchants?.length &&
        !r.match.categories?.length &&
        r.match.merchants.every((id) => !isPortal(id)) &&
        r.rate > card.base_rate &&
        r.rate > (everyday[0]?.rate ?? 0),
    )
    .sort((a, b) => b.rate - a.rate)
  const best = stores[0]
  if (best) {
    const same = stores.filter(
      (r) =>
        r.rate === best.rate &&
        r.requires?.membership === best.requires?.membership,
    )
    const names = [
      ...new Set(
        same.flatMap((r) =>
          (r.match.merchants ?? []).map((id) => merchantNames.get(id) ?? id),
        ),
      ),
    ]
    const membership = best.requires?.membership
    clauses.unshift(
      `${earnText(catalog, best.rate, card.currency)} at ${listWords(names)}${membership ? ` with ${MEMBERSHIPS[membership] ?? words(membership)}` : ''}`,
    )
  }

  const rotating = card.caps.find((c) => c.rotating)
  const rotatingRates = rotating
    ? card.rules.filter((r) => r.cap === rotating.id).map((r) => r.rate)
    : []
  if (rotatingRates.length > 0)
    clauses.unshift(
      `${earnText(catalog, Math.max(...rotatingRates), card.currency)} on categories that rotate each quarter`,
    )

  const base = `${earnText(catalog, card.base_rate, card.currency)} on everything${clauses.length > 0 ? ' else' : ''}`
  if (card.only_at) return listWords(clauses) || base
  return clauses.length > 0 ? `${clauses.join('; ')}; and ${base}` : base
}

function renderCard(
  card: Card,
  all: Page[],
  byPage: Map<string, Exploration>,
): string {
  const name = shortName(card.id)
  const issuer = ISSUERS[card.issuer] ?? card.issuer
  const currency = catalog.currencies.find((c) => c.id === card.currency)
  const headline = headlineFor(card)
  const closed = card.applications_closed !== undefined && !card.only_at
  const where = closed ? [] : placements(card, all, byPage)
  const firsts = where.filter((w) => w.rank === 1).slice(0, 30)
  const others = where.filter((w) => w.rank > 1).slice(0, 12)
  const link = (w: { page: Page; pct: number }) =>
    `<a href="/best/${w.page.slug}">${esc(w.page.label)}</a> (${pct(w.pct)})`
  const value =
    currency && card.currency !== 'cash'
      ? ` earnrate counts ${esc(currency.name)} at ${String(currency.value_cents)}¢ each${currency.range ? `; transferring to airlines or hotels can be worth up to about ${String(currency.range[1])}¢` : ''}.`
      : ''
  const title = `${name}: rewards rates, annual fee and where to use it (${monthYear}) | earnrate`
  const description = `${card.name}: ${headline}. ${feeText(card.id)}. Every earning rule quoted from ${issuer}'s terms, and the stores where it beats other cards. No affiliate links.`
  const canonical = `${SITE}/cards/${card.id}`
  const body = `
      <h1>${esc(card.name)}</h1>
      <p class="updated">${esc(issuer)} · ${esc(card.business ? 'Business card' : 'Personal card')} · Checked against ${esc(issuer)}'s terms ${esc(shortDate(card.last_verified))}</p>
      <p class="answer">The ${esc(name)} earns <strong>${esc(headline)}</strong>. ${esc(feeText(card.id))}.${value}${closed ? ` ${esc(issuer)} stopped taking applications for it on ${esc(shortDate(card.applications_closed ?? ''))}; cardholders keep earning.` : ''}${card.only_at ? ` It works only at ${esc(listWords(card.only_at.map((id) => merchantNames.get(id) ?? words(id))))}.` : ''}</p>
      <p><a class="button" href="/#wallet">Add it to your wallet</a></p>
      ${
        firsts.length > 0
          ? `<h2>Where it's the best ${card.business ? 'business ' : ''}card</h2><p class="links">${firsts.map(link).join(' · ')}</p>`
          : ''
      }
      ${
        others.length > 0
          ? `<h2>Where it's in the top 3</h2><p class="links">${others.map(link).join(' · ')}</p>`
          : ''
      }
      <h2>Earning rates</h2>
      ${rulesList(card)}
      ${choicesText(card)}
      ${offerText(card)}
      <h2>Sources</h2>
      <ul>${card.source_urls.map((u) => `<li><a href="${esc(u)}" rel="nofollow noopener">${esc(new URL(u).hostname.replace(/^www\./, '') + new URL(u).pathname)}</a></li>`).join('')}</ul>
      <p class="muted">Rankings compare ${card.business ? 'business' : 'personal'} cards, each set up at its best for the purchase, with points at earnrate's default value. Rates change; check ${esc(issuer)}'s terms before you apply.</p>`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CreditCard',
    name: card.name,
    url: canonical,
    provider: { '@type': 'BankOrCreditUnion', name: issuer },
    feesAndCommissionsSpecification: feeText(card.id),
    description: `${headline}.`,
  }
  return layout(title, description, canonical, body, jsonLd)
}

function renderCardIndex(): string {
  const byIssuer = new Map<string, Card[]>()
  for (const card of catalog.cards)
    byIssuer.set(card.issuer, [...(byIssuer.get(card.issuer) ?? []), card])
  const sections = [...byIssuer]
    .sort((a, b) =>
      (ISSUERS[a[0]] ?? a[0]).localeCompare(ISSUERS[b[0]] ?? b[0]),
    )
    .map(
      ([issuer, list]) =>
        `<h2>${esc(ISSUERS[issuer] ?? issuer)}</h2><p class="links">${list
          .map((c) => `<a href="/cards/${c.id}">${esc(shortName(c.id))}</a>`)
          .join(' · ')}</p>`,
    )
    .join('')
  return layout(
    'Credit card rewards rates, from issuer terms | earnrate',
    `Earning rates, caps and annual fees for ${String(catalog.cards.length)} US credit cards, each quoted from the issuer's own terms. No affiliate links.`,
    `${SITE}/cards/`,
    `
      <h1>Credit cards earnrate tracks</h1>
      <p class="updated">Updated ${esc(longDate)}</p>
      <p>Every earning rule for ${String(catalog.cards.length)} US cards, quoted from the issuer's own terms, and where each card beats the others.</p>
      ${sections}`,
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      url: `${SITE}/cards/`,
    },
  )
}

const all = pages(catalog)
const results = new Map(
  all.map((p) => [p.slug, exploreCards(catalog, p.query, options)]),
)
const businessResults = new Map(
  all.map((p) => [
    p.slug,
    exploreCards(catalog, p.query, {
      ...options,
      filters: { ...ALL_PERSONAL_CARDS, business: true },
    }),
  ]),
)
await mkdir(path.join(OUT, 'best'), { recursive: true })
await mkdir(path.join(OUT, 'cards'), { recursive: true })
for (const page of all) {
  const r = results.get(page.slug)
  if (!r) continue
  await writeFile(
    path.join(OUT, 'best', `${page.slug}.html`),
    renderPage(page, all, r),
  )
}
await writeFile(path.join(OUT, 'best', 'index.html'), renderIndex(all))
for (const card of catalog.cards) {
  await writeFile(
    path.join(OUT, 'cards', `${card.id}.html`),
    renderCard(card, all, card.business ? businessResults : results),
  )
}
await writeFile(path.join(OUT, 'cards', 'index.html'), renderCardIndex())
await writeFile(
  path.join(OUT, '404.html'),
  layout(
    'Page not found | earnrate',
    "This page doesn't exist.",
    `${SITE}/`,
    `
      <h1>That page doesn't exist</h1>
      <p>Try the <a href="/">card comparison</a>, or the <a href="/best/">best card for every store and category</a>.</p>`,
    { '@context': 'https://schema.org', '@type': 'WebPage' },
  ).replace(
    '<meta name="description"',
    '<meta name="robots" content="noindex" />\n    <meta name="description"',
  ),
)

const urls = [
  `${SITE}/`,
  `${SITE}/best/`,
  ...all.map((p) => `${SITE}/best/${p.slug}`),
  `${SITE}/cards/`,
  ...catalog.cards.map((c) => `${SITE}/cards/${c.id}`),
  `${SITE}/privacy`,
]
await writeFile(
  path.join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`,
)
await writeFile(
  path.join(OUT, 'robots.txt'),
  `User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /

Sitemap: ${SITE}/sitemap.xml
`,
)
console.log(
  `Wrote ${String(all.length)} comparison pages, ${String(catalog.cards.length)} card pages, sitemap.xml and robots.txt.`,
)
