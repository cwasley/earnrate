// Plain HTML from the same engine as the app, so search engines and AI
// answer tools can read it without running JavaScript.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, loadCatalog, loadChanges } from '../src/data/load.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  type Exploration,
  type ExploreEntry,
  type ExploreQuery,
} from '../src/engine/explore.ts'
import { EPSILON } from '../src/engine/compare.ts'
import {
  membershipNeeded,
  membershipText,
  paidMemberships,
} from '../src/engine/memberships.ts'
import { findCategory, findMerchant } from '../src/merchants/resolve.ts'
import { addDays, inEffect, localToday } from '../src/engine/periods.ts'
import {
  capitalize,
  categoryPhrase,
  creditBack,
  creditTerms,
  CREDIT_GROUP,
  creditsOnlyIf,
  currencyName,
  earnText,
  ENROLL_FIRST,
  hostname,
  ifCreditsUsedText,
  listed,
  longDate,
  money,
  num,
  pct,
  PAYMENT_PHRASES,
  PICK_PERIODS,
  shortDate,
  wholeDollars,
  words,
  foreignFeeText,
  freeNightText,
  freeNightValueText,
  possessive,
} from '../src/engine/text.ts'
import { allCreditsYear, nightValue } from '../src/engine/credits.ts'
import { cardColor } from '../src/format/card-art.ts'
import type { Card } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import type { Category } from '../src/schema/category.ts'
import type { Merchant } from '../src/schema/merchant.ts'
import { OFFERS_MAY_DIFFER, offerTerms } from '../src/engine/offers.ts'
import { milestoneStarts, milestoneWhat } from '../src/engine/milestones.ts'
import {
  creditWhere,
  introWhat,
  rulePreposition,
} from '../src/engine/rule-text.ts'
import { changeDates, latest } from './lastmod.ts'
import { pageContext, type GeneratedPage } from './pages/context.ts'
import { categoryPageFor, categoryPages } from './pages/categories.ts'
import {
  changesFeed,
  changesPage,
  recentChangesSection,
} from './pages/changes.ts'
import {
  hasCodingNotes,
  howItCodes,
  howStoresCodePage,
} from './pages/coding.ts'
import { feeWorthKit, feeWorthSection } from './pages/fee-worth.ts'
import { button, pageActions, textLink, type Visitor } from './pages/actions.ts'
import { storeIndexReasons } from './pages/indexing.ts'
import { drawImages, type OgImage } from './pages/og.ts'
import { quarterlyCardIds, quarterlyPages } from './pages/quarterly.ts'
import {
  chipLinks,
  esc,
  fitDescription,
  fitTitle,
  SITE,
  slugify,
} from './pages/site.ts'
import {
  comparePairs,
  comparer,
  TRANSFER_VALUES,
  type CompareCell,
  type ComparePair,
  type CompareRow,
  type Comparison,
} from './compare.ts'
import {
  type Simulation,
  TYPICAL_MONTHLY_SPEND,
} from '../src/engine/simulate.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// Tests build into a temporary directory.
const OUT = process.env.EARNRATE_PAGES_OUT ?? path.join(ROOT, 'site-dist')
const TOP = 10
const RELATED = 8

const catalog = await loadCatalog()
const releases = await loadChanges()
const dataVersion = (await readFile(`${DATA_DIR}VERSION`, 'utf8')).trim()
const today = process.env.EARNRATE_PAGES_TODAY ?? localToday()
const ctx = pageContext(catalog, { today, dataVersion })
const { thisQuarter, dayWords, art, layout } = ctx
const { ruleWhat, ruleWhatRaw, ruleConditions, evidenceFor } = ctx
const { merchantName, readsOn } = ctx
const {
  cards,
  shortName,
  feeLabel,
  requirementLines,
  membershipName,
  issuerName,
} = ctx

// Memberships worth calling out on a search page: the ones most people would
// know, which the site asks about too.
const HIGHLIGHTED = catalog.memberships
  .filter((m) => m.ask !== undefined)
  .map((m) => m.id)

function untilText(entry: ExploreEntry): string | null {
  const rule = cards
    .get(entry.cardId)
    ?.rules.find((r) => r.id === entry.matchedRule)
  if (rule?.valid_to === undefined) return null
  return longDate(rule.valid_to)
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
const skipMerchant = (m: Merchant) => m.kind === 'booking'

const categoryAddress = (cat: Category) =>
  cat.slug ?? slugify(cat.aliases[0] ?? cat.name)

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
    if (cat.page !== undefined) continue
    list.push({
      slug: categoryAddress(cat),
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

// The cards that earn as much as the first, in ranking order.
const tiedAtTop = (r: Exploration) => {
  const list = r.ranked.filter((e) => !isUnverified(e))
  const [top] = list
  return top
    ? list.filter(
        (e) =>
          Math.abs(e.effectiveReturnPct - top.effectiveReturnPct) < EPSILON,
      )
    : []
}

const TIED_NAMED = 3

// "6 cards tie for the most at Gap: 2% cash back. Citi Double Cash,
// Fidelity Rewards, SoFi Unlimited 2% and 3 more, all with no annual fee."
function tieText(tied: ExploreEntry[], where: string): string {
  const [top] = tied
  if (!top) return ''
  const cash = tied.every((e) => e.currency === 'cash')
  const names = tied
    .slice(0, TIED_NAMED)
    .map(
      (e) =>
        `<strong><a href="/cards/${e.cardId}">${esc(shortName(e.cardId))}</a></strong>`,
    )
  const rest = tied.length - names.length
  const free = tied.filter((e) => e.annualFee === 0).length
  const fees =
    free === tied.length
      ? ', all with no annual fee'
      : free > 0
        ? `; ${String(free)} of them have no annual fee`
        : ''
  return `${String(tied.length)} cards tie for the most ${where}: ${pct(top.effectiveReturnPct)}${cash ? ' cash back' : ' back'}. ${rest > 0 ? `${names.join(', ')} and ${String(rest)} more` : listed(names)}${fees}.`
}

function answer(page: Page, r: Exploration, shown: ExploreEntry[]): string {
  if (r.categoryNote !== null)
    return `<p class="answer">${esc(r.categoryNote)}</p>`
  const [top] = shown
  if (!top) return `<p>No card in earnrate's data earns a bonus here.</p>`
  const tied = tiedAtTop(r)
  const where = `${page.merchant === null && (page.categoryId === 'other' || readsOn(page.categoryId)) ? 'on' : 'at'} ${esc(page.label)}`
  const codes =
    page.merchant === null || r.merchant.source === 'none'
      ? ''
      : ` ${esc(page.label)} usually codes as ${esc(categoryPhrase(catalog, r.merchant.category))}${r.merchant.likelyMcc === null ? '' : ` (MCC ${String(r.merchant.likelyMcc)})`}.`
  const credit = r.credits[0]
  const parts = [
    ...(credit
      ? [
          `<strong><a href="/cards/${credit.cardId}">${esc(shortName(credit.cardId))}</a></strong> gives ${esc(credit.back)} ${where} with its statement credit${credit.enroll ? ` (${esc(ENROLL_FIRST)})` : ''}.`,
        ]
      : []),
    tied.length > 1
      ? `${tieText(tied, `${where}${credit ? ' by rate' : ''}`)}${codes}`
      : `<strong><a href="/cards/${top.cardId}">${esc(shortName(top.cardId))}</a></strong> earns the most ${where}${credit ? ' by rate' : ''}: ${pct(top.effectiveReturnPct)}${top.currency === 'cash' ? ' cash back' : ` in points at ${num(top.centsPerUnit)}¢ each`}.${codes}`,
  ]
  const topCard = cards.get(top.cardId)
  const needs = topCard
    ? membershipNeeded(
        catalog,
        topCard,
        paidMemberships(catalog, {
          memberships: [],
          merchantIds: [r.merchant.merchantId],
        }),
      )
    : []
  const first = [
    ...requirementLines(top.cardId, top.requirements, untilText(top)),
    // "Needs a Costco membership", except where buying means being a member.
    ...needs.map((c) => c.replace(/\.$/, '')),
  ]
  // With a tie, each card's conditions are in the table below.
  if (first.length > 0 && tied.length < 2) parts.push(`${first.join('. ')}.`)
  const noFee = shown.find(
    (e) => e.annualFee === 0 && !cards.get(e.cardId)?.requires_membership,
  )
  if (noFee && noFee !== top && !tied.includes(noFee))
    parts.push(
      `With no annual fee, <strong>${esc(shortName(noFee.cardId))}</strong> earns ${pct(noFee.effectiveReturnPct)}.`,
    )
  const membership = shown
    .flatMap((e) => e.withMembership.map((m) => ({ entry: e, ...m })))
    .filter((m) => HIGHLIGHTED.includes(m.membership))
    .sort((a, b) => b.effectiveReturnPct - a.effectiveReturnPct)[0]
  if (
    membership &&
    membership.effectiveReturnPct >= (noFee ?? top).effectiveReturnPct
  )
    parts.push(
      `With ${membershipName(membership.membership)}, <strong>${esc(shortName(membership.entry.cardId))}</strong> earns ${pct(membership.effectiveReturnPct)}${membership.entry.annualFee === 0 && membership.entry !== noFee ? ', also with no annual fee' : ''}.`,
    )
  return `<p class="answer">${parts.join(' ')}</p>`
}

function gotchas(r: Exploration, merchant: Merchant | null): string {
  // "How it codes" below already gives the store's own notes.
  const coding = merchant !== null && hasCodingNotes(merchant)
  const shownBelow = [merchant?.note, merchant?.ambiguity?.note].filter(
    (n) => n !== undefined,
  )
  const items: string[] = []
  for (const w of r.warnings)
    if (!coding || !shownBelow.some((n) => w.includes(n))) items.push(esc(w))
  const reasons = new Map<string, number>()
  for (const e of r.excluded)
    reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1)
  for (const [reason, count] of reasons)
    items.push(
      `${esc(reason)} ${count === 1 ? 'One card is' : `${String(count)} cards are`} left out.`,
    )
  if (r.merchant.merchantId !== null && !coding) {
    const note = findMerchant(catalog, r.merchant.merchantId)?.note
    if (note) items.push(esc(note))
  }
  return items.length === 0
    ? ''
    : `<h2>Good to know</h2><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
}

function table(shown: ExploreEntry[]): string {
  const rows = shown
    .map((e, i) => {
      const lines = requirementLines(e.cardId, e.requirements, untilText(e))
      const upgrade = e.withMembership[0]
      if (upgrade && HIGHLIGHTED.includes(upgrade.membership))
        lines.push(
          `${pct(upgrade.effectiveReturnPct)} with ${membershipName(upgrade.membership)}`,
        )
      return `<li><span class="rank">${String(i + 1)}</span>${art(e.cardId)}<div><span class="row-head"><strong><a href="/cards/${e.cardId}">${esc(shortName(e.cardId))}</a></strong> <span class="rate">${pct(e.effectiveReturnPct)}</span></span><span class="muted row-note">${esc(issuerName(e.issuer))} · ${esc(feeLabel(e.cardId))}</span>${lines.length > 0 ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div></li>`
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
      const host = hostname(ev.url)
      return `<li><strong><a href="/cards/${e.cardId}">${esc(shortName(e.cardId))}</a>:</strong> “${esc(ev.quote)}” <a href="${esc(ev.url)}" rel="nofollow noopener">${esc(host)}</a>, checked ${esc(card.last_verified)}.</li>`
    })
    .join('')
  return items === ''
    ? ''
    : `<h2>From the issuers' terms</h2><ul class="quotes">${items}</ul>`
}

// A category page lists every store that usually codes as it, so it can
// answer for stores whose own pages aren't indexed.
const STORES_OPEN = 24

function categoryStores(page: Page, all: Page[]): string {
  const stores = all
    .filter((p) => p.merchant !== null && p.categoryId === page.categoryId)
    .sort((a, b) => a.label.localeCompare(b.label))
  if (stores.length === 0) return ''
  const heading = `${String(stores.length)} ${stores.length === 1 ? 'store' : 'stores'} that usually code as ${esc(page.label)}`
  const chips = chipLinks(
    stores.map((p) => `<a href="/best/${p.slug}">${esc(p.label)}</a>`),
  )
  return stores.length > STORES_OPEN
    ? `<h2>Stores</h2><details class="group"><summary><span>${heading}</span></summary>${chips}</details>`
    : `<h2>${capitalize(heading)}</h2>${chips}`
}

function related(page: Page, all: Page[]): string {
  if (page.merchant === null) return categoryStores(page, all)
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
  return links.length === 0 ? '' : `<h2>Related</h2>${chipLinks(links)}`
}

// Cards with a statement credit at the store, before the ranking: dollars,
// never a percentage.
function creditGroup(r: Exploration): string {
  if (r.credits.length === 0) return ''
  const rows = r.credits
    .map((c) => {
      const ev = c.evidence
      return `<li>${art(c.cardId)}<div><span class="row-head"><strong><a href="/cards/${c.cardId}">${esc(shortName(c.cardId))}</a></strong> <span class="rate">${esc(money(c.amount))} back</span></span><span class="muted row-note">${esc(issuerName(c.issuer))} · ${esc(feeLabel(c.cardId))}</span><ul><li>${esc(capitalize(c.text))}${c.enroll ? `. ${esc(capitalize(ENROLL_FIRST))}` : ''}.</li>${c.note ? `<li>${esc(c.note)}</li>` : ''}</ul>${ev ? `<p class="muted">“${esc(ev.quote)}” <a href="${esc(ev.url)}" rel="nofollow noopener">${esc(hostname(ev.url))}</a></p>` : ''}</div></li>`
    })
    .join('')
  return `<h2>${esc(CREDIT_GROUP)}</h2><ol class="cards credits">${rows}</ol>`
}

const ranked = (r: Exploration) =>
  r.ranked.filter((e) => !isUnverified(e)).slice(0, TOP)

function renderPage(page: Page, all: Page[], r: Exploration): string {
  const hidden = r.ranked.filter(isUnverified)
  const shown = ranked(r)
  const top = shown[0]
  const subject = page.label
  const lead = page.merchant === null ? 'for' : 'to use at'
  const title = fitTitle([
    `Best credit card ${lead} ${subject} (${thisQuarter})`,
    `Best credit card ${lead} ${subject}`,
    `Best card ${page.merchant === null ? 'for' : 'at'} ${subject}`,
  ])
  const where = page.merchant === null ? 'on' : 'at'
  const tied = tiedAtTop(r)
  const ranking = fitDescription(
    top && tied.length > 1
      ? [
          `${shortName(top.cardId)} and ${String(tied.length - 1)} other ${tied.length === 2 ? 'card' : 'cards'} earn ${pct(top.effectiveReturnPct)} ${where} ${subject}, the most of any card. Compare ${String(r.ranked.length)} cards by rate, annual fee and conditions, quoted from issuer terms. No affiliate links.`,
          `${shortName(top.cardId)} and ${String(tied.length - 1)} other ${tied.length === 2 ? 'card' : 'cards'} earn ${pct(top.effectiveReturnPct)} ${where} ${subject}, the most of any card. ${String(r.ranked.length)} cards compared from issuer terms.`,
          `${String(tied.length)} cards tie for the most ${where} ${subject}: ${pct(top.effectiveReturnPct)}.`,
        ]
      : top
        ? [
            `${shortName(top.cardId)} earns ${pct(top.effectiveReturnPct)} ${where} ${subject}. Compare ${String(r.ranked.length)} cards by rate, annual fee and conditions, quoted from issuer terms. No affiliate links.`,
            `${shortName(top.cardId)} earns ${pct(top.effectiveReturnPct)} ${where} ${subject}. ${String(r.ranked.length)} cards compared from issuer terms. No affiliate links.`,
            `${shortName(top.cardId)} earns ${pct(top.effectiveReturnPct)} ${where} ${subject}, of ${String(r.ranked.length)} cards compared.`,
          ]
        : [
            `Which credit card earns the most ${where} ${subject}, compared across ${String(catalog.cards.length)} cards from issuer terms.`,
            `Which credit card earns the most ${where} ${subject}.`,
          ],
  )
  const description =
    r.categoryNote === null
      ? ranking
      : fitDescription([
          r.categoryNote,
          r.categoryNote.split(/(?<=\.)\s+/)[0] ?? '',
          `What to know before paying for ${subject} by credit card.`,
        ])
  const canonical = `${SITE}/best/${page.slug}`
  const definitions = categoryPageFor(page.categoryId)
  const appLink = `/#wallet=${encodeURIComponent(page.merchant?.name ?? catalog.categories.find((c) => c.id === page.categoryId)?.name ?? page.label).replace(/%20/g, '+')}`
  const body = `
      <h1>Best credit card ${page.merchant === null ? 'for' : 'to use at'} ${esc(subject)}</h1>
      <p class="updated">Updated ${esc(dayWords(dataDate))}</p>
      ${answer(page, r, shown)}
      ${pageActions([
        {
          when: ['none'],
          html: button(
            appLink,
            `Add your cards to see which to use ${page.merchant === null ? 'for these' : 'here'}`,
          ),
        },
        {
          when: ['other', 'holds'],
          html: button(appLink, 'Check with your own cards'),
        },
      ])}
      ${creditGroup(r)}
      <h2>Top ${String(shown.length)} cards${r.credits.length > 0 ? ' by rate' : ''} ${page.merchant === null ? 'for' : 'at'} ${esc(subject)}</h2>
      ${table(shown)}
      ${hidden.length > 0 ? `<p class="muted">Not ranked: ${hidden.map((e) => esc(shortName(e.cardId))).join(', ')}, whose rate here isn't confirmed against the issuer's terms yet.</p>` : ''}
      ${gotchas(r, page.merchant)}
      ${page.merchant ? howItCodes(ctx, page.merchant, categoryPageFor) : ''}
      ${sources(shown)}
      <h2>How this is ranked</h2>
      <p>Every personal card earnrate tracks that's open to new applicants, each set up at its best for this purchase: the right bonus-category pick, any activation done, and no spending cap used up yet. Points are counted at what each program's points are worth as cash or travel credit (1¢ for most); transferring them to airlines or hotels can be worth more. Annual fees aren't subtracted here; to weigh them against your own spending, use <a href="/#spending">My spending</a>.</p>
      ${related(page, all)}
      ${definitions ? `<p>What counts as ${esc(definitions)} for each issuer: <a href="/categories/${definitions}">their definitions, side by side</a>.</p>` : ''}`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: canonical,
    dateModified: dataDate,
    mainEntity: {
      '@type': 'ItemList',
      name: `Best credit cards ${page.merchant === null ? 'for' : 'at'} ${subject}`,
      itemListElement: shown.map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: cards.get(e.cardId)?.name ?? e.cardId,
        description: `${pct(e.effectiveReturnPct)} back; ${feeLabel(e.cardId)}`,
      })),
    },
  }
  // The image names the top card, which a note says not to lead with.
  const image = top !== undefined && r.categoryNote === null
  if (image)
    images.push({
      file: `og/best/${page.slug}.jpg`,
      color: cardColor(catalog, top.cardId),
      kicker: `Best card ${page.merchant === null ? 'for' : 'at'}`,
      name: page.merchant?.name ?? capitalize(subject),
      line: `${shortName(top.cardId)}: ${pct(top.effectiveReturnPct)}${top.currency === 'cash' ? ' cash back' : ' in points'}`,
    })
  return layout({
    title,
    description,
    path: `/best/${page.slug}`,
    body,
    jsonLd,
    crumbs: [
      { name: 'Best cards', path: '/best/' },
      {
        name: page.merchant?.name ?? capitalize(subject),
        path: `/best/${page.slug}`,
      },
    ],
    ...(image ? { image: `/og/best/${page.slug}.jpg` } : {}),
    noindex: !isIndexed(page),
  })
}

// Narrows the lists as you type, matching names and aliases. It runs only in
// the page: nothing typed is sent anywhere, and without it the lists still work.
const FILTER_SCRIPT = `(() => {
  const input = document.getElementById('filter')
  const wrap = input.closest('.filter')
  const none = document.getElementById('no-match')
  const ask = none.querySelector('a')
  const sections = [...document.querySelectorAll('[data-section]')]
  wrap.hidden = false
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase()
    let total = 0
    for (const s of sections) {
      let shown = 0
      for (const li of s.querySelectorAll('li')) {
        const hit = q === '' || li.dataset.q.includes(q)
        li.hidden = !hit
        if (hit) shown++
      }
      s.hidden = shown === 0
      s.querySelector('.count').textContent = q === '' ? '' : ' (' + shown + ')'
      total += shown
    }
    none.hidden = total > 0
    ask.href = '/#best=' + encodeURIComponent(input.value.trim())
    ask.textContent = 'Ask earnrate.dev about \u201c' + input.value.trim() + '\u201d'
  })
})()`

function renderIndex(all: Page[]): string {
  const section = (heading: string, list: Page[]) =>
    `<section data-section><h2>${heading}<span class="count"></span></h2><ul class="link-list">${list
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(
        (p) =>
          `<li data-q="${esc([p.label, ...(p.merchant?.aliases ?? [])].join(' ').toLowerCase())}"><a href="/best/${p.slug}">${esc(p.label)}</a></li>`,
      )
      .join('')}</ul></section>`
  const body = `
      <h1>Best credit card for every store and category</h1>
      <p class="updated">Updated ${esc(dayWords(dataDate))}</p>
      <p>Which of ${String(catalog.cards.length)} U.S. credit cards earns the most, store by store, from each issuer's own terms. No affiliate links.</p>
      <div class="filter" hidden>
        <label for="filter">Find a store or category</label>
        <input id="filter" type="search" placeholder="Costco, gas, Netflix…" autocomplete="off" spellcheck="false" />
      </div>
      <p id="no-match" class="next" hidden>No page for that yet. <a href="/">Ask earnrate.dev</a>, which also knows stores without a page.</p>
      ${section(
        'Categories',
        all.filter((p) => p.merchant === null),
      )}
      ${section(
        'Stores',
        all.filter((p) => p.merchant !== null),
      )}
      <script>${FILTER_SCRIPT}</script>`
  return layout({
    title: fitTitle(['Best credit card for every store and category']),
    description: `Which credit card earns the most at ${String(all.filter((p) => p.merchant).length)} stores and ${String(all.filter((p) => !p.merchant).length)} spending categories, from issuer terms. No affiliate links.`,
    path: '/best/',
    body,
    crumbs: [{ name: 'Best cards', path: '/best/' }],
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      url: `${SITE}/best/`,
    },
  })
}

function rulesList(card: Card): string {
  const rules = [...card.rules].sort((a, b) => b.rate - a.rate)
  const items = rules.map((rule) => {
    const lines = ruleConditions(card, rule)
    return `<li><span class="rank">${esc(num(rule.rate))}</span><div><span class="row-head"><strong>${esc(ruleWhat(card, rule))}</strong> <span class="rate">${esc(earnText(catalog, rule.rate, card.currency))}</span></span>${rule.note ? `<span class="muted row-note">${esc(rule.note)}</span>` : ''}${lines.length > 0 ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${evidenceFor(card, rule.id)}</div></li>`
  })
  items.push(
    `<li><span class="rank">${esc(String(card.base_rate))}</span><div><span class="row-head"><strong>Everything else</strong> <span class="rate">${esc(earnText(catalog, card.base_rate, card.currency))}</span></span>${evidenceFor(card, 'base_rate')}</div></li>`,
  )
  return `<ol class="cards rules">${items.join('')}</ol>`
}

function choicesText(card: Card): string {
  if (card.choices.length === 0) return ''
  const items = card.choices.map((c) => {
    const options = Object.keys(c.options).map(words)
    const when = PICK_PERIODS[c.period]
    return c.automatic
      ? `<li>${esc(capitalize(`${issuerName(card.issuer)} applies it to ${c.pick === 1 ? 'the one' : `the ${String(c.pick)}`} with the most spending ${when}`))}, of: ${esc(listed(options))}. Set the one you expect in your wallet.</li>`
      : `<li>Pick ${String(c.pick)} of: ${esc(listed(options))} (${esc(when)})${c.default ? `. If you don't pick, it's ${esc(listed(c.default.map(words)))}` : ''}.</li>`
  })
  const heading = card.choices.every((c) => c.automatic)
    ? 'Categories chosen by your spending'
    : 'Categories you choose'
  return `<h2>${heading}</h2><ul>${items.join('')}</ul>`
}

// Bonuses paid once a year after a spending total. Only the points count in
// rankings, and only once tracked spending reaches the total.
function milestonesText(card: Card): string {
  if (card.milestones.length === 0) return ''
  const items = card.milestones.map(
    (m) =>
      `<li><strong>${esc(capitalize(`${milestoneWhat(m).replace(/^the /, '')}${milestoneStarts(m, today)}`))}</strong>${m.note ? `<br /><span class="muted">${esc(m.note)}</span>` : ''}${evidenceFor(card, m.id)}</li>`,
  )
  return `<h2>Spend bonuses</h2><p>Every purchase on the card counts. earnrate adds the bonus points to the purchase that reaches the total, once you track your spending on earnrate.dev, in Claude or with the command line; status, night credits and free nights aren't given a value.</p><ul>${items.join('')}</ul>`
}

function creditsText(card: Card): string {
  if (card.credits.length === 0) return ''
  const items = card.credits.map((c) => {
    return `<li><strong>${esc(capitalize(`${creditBack(c)} ${creditWhere(catalog, c)}${creditTerms(c)}`))}</strong>${c.enroll ? ` (${esc(ENROLL_FIRST)})` : ''}${c.note ? `<br /><span class="muted">${esc(c.note)}</span>` : ''}${evidenceFor(card, c.id)}</li>`
  })
  const all = allCreditsYear(catalog, card, today, {})
  const year = all.yearly - all.nights
  return `<h2>Statement credits</h2><p>Dollars back for spending at these stores or on these purchases, on top of what the purchase earns: ${esc(wholeDollars(year))} a year if you'd use them all. With your cards saved, earnrate counts one toward a purchase until it's used up for the period, once you mark it enrolled where the issuer asks for that, and counts the ones you use against the annual fee. You can mark any you don't use.</p><ul>${items.join('')}</ul>`
}

// Valued like points: the night's cap at earnrate's default point value.
function freeNightsText(card: Card): string {
  if (card.free_nights.length === 0) return ''
  const currency = catalog.currencies.find((c) => c.id === card.currency)
  const cents = currency?.value_cents ?? 1
  const items = card.free_nights.map((n) => {
    const what = freeNightText(n.points, currency?.name ?? card.currency)
    const value = freeNightValueText(nightValue(catalog, {}, card, n), cents)
    return `<li><strong>${esc(capitalize(what))}</strong> (${esc(value)}, earnrate's default)${n.note ? `<br /><span class="muted">${esc(n.note)}</span>` : ''}${evidenceFor(card, n.id)}</li>`
  })
  return `<h2>Free night</h2><p>A free night each year after the account anniversary, with no spending needed. It's worth the most at a hotel that costs its full point cap, on a stay you'd make anyway. With your cards saved, earnrate counts it against the annual fee once you say you use it, and you can mark it as one you don't.</p><ul>${items.join('')}</ul>`
}

function introRatesText(card: Card): string {
  if (card.intro_rates.length === 0) return ''
  const items = card.intro_rates.map(
    (i) =>
      `<li><strong>${esc(capitalize(introWhat(catalog, card, i)))}</strong>${i.note ? `<br /><span class="muted">${esc(i.note)}</span>` : ''}${evidenceFor(card, i.id)}</li>`,
  )
  return `<h2>For new accounts</h2><p>Rates that apply only for a stretch after the account opens. Give earnrate the card's opening date and it ranks the card at them; without one, answers mention them instead.</p><ul>${items.join('')}</ul>`
}

function foreignFeeSection(card: Card): string {
  const fee = card.foreign_transaction_fee
  const usOnly = [
    ...new Set(
      card.rules
        .filter((r) => r.geography === 'us_only')
        .map((r) => ruleWhatRaw(card, r)),
    ),
  ]
  const rates =
    usOnly.length === 0
      ? 'Purchases outside the U.S. earn its usual rates.'
      : `Its ${usOnly.length === 1 ? 'rate' : 'rates'} on ${listed(usOnly)} ${usOnly.length === 1 ? 'counts' : 'count'} only in the U.S.; elsewhere those purchases earn its other rates.`
  const using =
    fee === null
      ? "The issuer's pages earnrate reads don't state it; check before using the card abroad."
      : fee === 0
        ? rates
        : `Abroad, earnrate subtracts the ${pct(fee)} from what each purchase earns before ranking it.`
  return `<h2>Paying abroad</h2><p>${esc(foreignFeeText(fee))}. ${esc(using)}</p>${evidenceFor(card, 'foreign_transaction_fee')}`
}

function offerText(card: Card): string {
  const o = card.welcome_offer
  if (!o || !inEffect(o, today)) return ''
  return `<h2>Public welcome offer</h2><p>${esc(offerTerms(o, currencyName(catalog, card.currency)))}${o.valid_to ? `, through ${esc(shortDate(o.valid_to))}` : ''}, per the issuer's page as of ${esc(shortDate(card.last_verified))}. ${OFFERS_MAY_DIFFER}${o.note ? ` ${esc(o.note)}` : ''}</p>`
}

function placements(
  card: Card,
  all: Page[],
  byPage: Map<string, Exploration>,
): { page: Page; rank: number; pct: number }[] {
  const found: { page: Page; rank: number; pct: number }[] = []
  for (const page of all) {
    const r = byPage.get(page.slug)
    if (!r || r.categoryNote !== null) continue
    const list = ranked(r)
    const i = list.findIndex((e) => e.cardId === card.id)
    const entry = list[i]
    if (
      entry &&
      i < 3 &&
      entry.effectiveReturnPct > card.base_rate * entry.centsPerUnit + EPSILON
    )
      found.push({ page, rank: i + 1, pct: entry.effectiveReturnPct })
  }
  return found.sort((a, b) => a.rank - b.rank || b.pct - a.pct)
}

type Placement = { page: Page; rank: number; pct: number }

// A card's placements grouped by kind of purchase, each a collapsible row
// ("Supermarkets · 2% · 62 stores") of chips: open when there are few, and
// past the six biggest, folded under one more row.
const SHOWN_GROUPS = 6

function placementGroups(list: Placement[], all: Page[]): string {
  const nameOf = (categoryId: string) =>
    catalog.categories.find((c) => c.id === categoryId)?.name ??
    words(categoryId)
  const groups = new Map<string, Placement[]>()
  for (const w of list) {
    const name = nameOf(w.page.categoryId)
    groups.set(name, [...(groups.get(name) ?? []), w])
  }
  const open = list.length <= 8
  const rows = [...groups]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, ws]) => {
      const pcts = [...new Set(ws.map((w) => w.pct))].sort((a, b) => a - b)
      const low = pcts[0] ?? 0
      const high = pcts.at(-1) ?? low
      const rate = low === high ? pct(low) : `${pct(low)}–${pct(high)}`
      const stores = ws.filter((w) => w.page.merchant !== null).length
      const meta = `${rate}${stores > 0 ? ` · ${String(stores)} ${stores === 1 ? 'store' : 'stores'}` : ''}`
      // The kind of purchase's own page first, then its stores.
      const ordered = [
        ...ws.filter((w) => w.page.merchant === null),
        ...ws.filter((w) => w.page.merchant !== null),
      ]
      const chips = ordered.map(
        (w) =>
          `<a href="/best/${w.page.slug}">${esc(w.page.merchant === null ? `All ${w.page.label}` : w.page.label)}${low === high ? '' : ` <span class="muted">${pct(w.pct)}</span>`}</a>`,
      )
      const categoryPage = all.find(
        (p) => p.merchant === null && nameOf(p.categoryId) === name,
      )
      const more =
        categoryPage && !ws.some((w) => w.page === categoryPage)
          ? `<p class="small"><a href="/best/${categoryPage.slug}">Best cards for ${esc(categoryPage.label)}</a></p>`
          : ''
      return `<details class="group"${open ? ' open' : ''}><summary><span>${esc(name)}</span><span class="group-meta">${meta}</span></summary>${chipLinks(chips)}${more}</details>`
    })
  const stores = list.filter((w) => w.page.merchant !== null).length
  const count =
    list.length > 8 && rows.length > 1
      ? `<p class="muted">${String(stores)} stores in ${String(rows.length)} kinds of purchase.</p>`
      : ''
  const rest = rows.slice(SHOWN_GROUPS)
  return `${count}<div class="groups">${rows.slice(0, SHOWN_GROUPS).join('')}${
    rest.length > 0
      ? `<details class="more-groups"><summary>${String(rest.length)} more kinds of purchase</summary><div class="groups">${rest.join('')}</div></details>`
      : ''
  }</div>`
}

const isPortal = (id: string) => findMerchant(catalog, id)?.kind !== undefined

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
    const phrase = `${rulePreposition(catalog, [r])} ${ruleWhatRaw(card, r)}`
    const phrases = byRate.get(r.rate) ?? []
    if (!phrases.includes(phrase)) byRate.set(r.rate, [...phrases, phrase])
  }
  const clauses = [...byRate].map(
    ([rate, whats]) =>
      `${earnText(catalog, rate, card.currency)} ${listed(whats)}`,
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
        r.requires?.membership === best.requires?.membership &&
        r.requires?.payment === best.requires?.payment,
    )
    const names = [
      ...new Set(
        same.flatMap((r) =>
          (r.match.merchants ?? []).map((id) => merchantName(id) ?? id),
        ),
      ),
    ]
    const membership = best.requires?.membership
    const payment = best.requires?.payment
    clauses.unshift(
      `${earnText(catalog, best.rate, card.currency)} at ${listed(names)}${membership ? ` with ${membershipName(membership)}` : ''}${payment ? ` ${PAYMENT_PHRASES[payment]}` : ''}`,
    )
  }
  for (const r of current)
    if (
      r.match.any &&
      r.requires?.payment !== undefined &&
      r.rate > card.base_rate
    )
      clauses.push(
        `${earnText(catalog, r.rate, card.currency)} ${PAYMENT_PHRASES[r.requires.payment]}`,
      )

  const rotating = card.caps.find((c) => c.rotating)
  const rotatingRates = rotating
    ? card.rules.filter((r) => r.cap === rotating.id).map((r) => r.rate)
    : []
  if (rotatingRates.length > 0)
    clauses.unshift(
      `${earnText(catalog, Math.max(...rotatingRates), card.currency)} on categories that rotate each quarter`,
    )

  const base = `${earnText(catalog, card.base_rate, card.currency)} on everything${clauses.length > 0 ? ' else' : ''}`
  if (card.only_at) return listed(clauses) || base
  return clauses.length > 0 ? `${clauses.join('; ')}; and ${base}` : base
}

// Where its everyday rate is the most any card earns: a flat 2% card at
// stores where no card pays a bonus.
function topAtBase(
  card: Card,
  all: Page[],
  byPage: Map<string, Exploration>,
): Page[] {
  return all.filter((page) => {
    const r = byPage.get(page.slug)
    const entry =
      r?.categoryNote === null
        ? tiedAtTop(r).find((e) => e.cardId === card.id)
        : undefined
    return (
      entry !== undefined &&
      entry.effectiveReturnPct <= card.base_rate * entry.centsPerUnit + EPSILON
    )
  })
}

// Kinds of purchase first, then stores.
const pageLinks = (list: Page[], n: number) =>
  [
    ...list.filter((p) => p.merchant === null),
    ...list.filter((p) => p.merchant !== null),
  ]
    .slice(0, n)
    .map((p) => `<a href="/best/${p.slug}">${esc(p.label)}</a>`)

// Where it's the best card and in the top 3 at earnrate's default point
// values; for Amex and Chase points, the same at their transfer value; and
// where a flat rate ties for the most any card earns.
function rankSection(
  card: Card,
  all: Page[],
  byPage: Map<string, Exploration>,
  transferByPage: Map<string, Exploration>,
): string {
  const kind = card.business ? 'business card' : 'personal card'
  const where = placements(card, all, byPage)
  const firsts = where.filter((w) => w.rank === 1)
  const others = where.filter((w) => w.rank > 1)
  const parts: string[] = []
  if (firsts.length > 0)
    parts.push(
      `<h2>Where it's the best ${kind}</h2>${placementGroups(firsts, all)}`,
    )
  if (others.length > 0)
    parts.push(
      `<h2>Where it's in the top 3</h2>${placementGroups(others, all)}`,
    )

  const flat = topAtBase(card, all, byPage)
  const flatText =
    flat.length > 0
      ? `Its ${esc(earnText(catalog, card.base_rate, card.currency))} on everything ties for the most any ${kind} earns at ${String(flat.length)} ${flat.length === 1 ? 'store or kind of purchase' : 'stores and kinds of purchase'}, including ${listed(pageLinks(flat, 3))}.`
      : ''

  const cents = TRANSFER_VALUES[card.currency]
  const moved = cents === undefined ? [] : placements(card, all, transferByPage)
  const movedFirsts = moved.filter((w) => w.rank === 1)
  const gains =
    movedFirsts.length > firsts.length || moved.length > where.length
  const program = currencyName(catalog, card.currency)
  const defaultCents =
    catalog.currencies.find((c) => c.id === card.currency)?.value_cents ?? 1

  if (where.length === 0)
    parts.push(
      `<h2>Where it ranks</h2><p>${
        flatText !== ''
          ? flatText
          : `At earnrate's default of ${num(defaultCents)}¢ a point, other ${kind}s earn as much or more at every store and kind of purchase earnrate ranks.${gains ? ` Counted at the ${String(cents)}¢ transfer value, below, it moves up.` : ' Its bonus rates are below.'}`
      }</p>`,
    )
  else if (flatText !== '') parts.push(`<p>${flatText}</p>`)

  if (gains && cents !== undefined) {
    const up = moved.filter((w) => w.rank > 1)
    parts.push(
      `<h2>If you transfer ${esc(program)} at ${String(cents)}¢</h2><p>Counting ${esc(program)} at ${String(cents)}¢ each, what transferring them to airlines and hotels can be worth, with other Amex and Chase points counted the same way:</p>${
        movedFirsts.length > 0
          ? `<h3>Where it's the best ${kind}</h3>${placementGroups(movedFirsts, all)}`
          : ''
      }${up.length > 0 ? `<h3>Where it's in the top 3</h3>${placementGroups(up, all)}` : ''}`,
    )
  }
  return parts.join('')
}

// What a visitor does next from a card page, by what their browser has
// saved: someone researching the card sees it on their spending, someone
// with cards sees what it adds, and someone who holds it opens it. A card
// closed to applicants can only be added.
function cardActions(card: Card): string {
  const id = card.id
  const add = `/#wallet&add=${id}`
  const open = {
    when: ['holds'] as Visitor[],
    html: button(`/#wallet&card=${id}`, 'Open it in your wallet'),
  }
  if (card.applications_closed !== undefined)
    return pageActions(
      [
        {
          when: ['none', 'other'],
          html: button(add, 'Have it? Add it to your wallet'),
        },
        open,
      ],
      id,
    )
  return pageActions(
    [
      {
        when: ['none'],
        html: `${button(`/#spending&card=${id}`, 'See it on your spending')} ${textLink(add, 'Already have it? Add it to your wallet')}`,
      },
      {
        when: ['other'],
        html: `${button(`/#wallet&whatif=${id}`, 'See what it adds to your cards')} ${textLink(add, 'Add it to your wallet')}`,
      },
      open,
    ],
    id,
  )
}

function renderCard(
  card: Card,
  all: Page[],
  byPage: Map<string, Exploration>,
  transferByPage: Map<string, Exploration>,
): string {
  const name = shortName(card.id)
  const issuer = issuerName(card.issuer)
  const currency = catalog.currencies.find((c) => c.id === card.currency)
  const headline = headlineFor(card)
  const closed = card.applications_closed !== undefined && !card.only_at
  const value =
    currency && card.currency !== 'cash'
      ? ` earnrate counts ${esc(currency.name)} at ${String(currency.value_cents)}¢ each${currency.range ? `; transferring to airlines or hotels can be worth up to about ${String(currency.range[1])}¢` : ''}.`
      : ''
  // "Fidelity Rewards rates", not "Fidelity Rewards rewards rates".
  const rates = /rewards$/i.test(name) ? 'rates' : 'rewards rates'
  const worth = feeWorth(card)
  // A card with a fee whose page weighs it answers "is it worth it".
  const fee = worth && card.annual_fee ? wholeDollars(card.annual_fee) : null
  const title = fitTitle([
    ...(fee
      ? [
          `${name}: earning rates and is the ${fee} fee worth it?`,
          `${name}: rates and is the ${fee} fee worth it?`,
          `${name}: is the ${fee} fee worth it?`,
        ]
      : []),
    `${name} ${rates} and annual fee (${thisQuarter})`,
    `${name} ${rates} and annual fee`,
    `${name} ${rates} and fee`,
    name,
  ])
  const firstClause = headline.split('; ')[0] ?? headline
  const description = fitDescription([
    `${card.name}: ${headline}. ${feeLabel(card.id)}. Every earning rule quoted from ${possessive(issuer)} terms, and the stores where it beats other cards. No affiliate links.`,
    `${card.name}: ${headline}. ${feeLabel(card.id)}.`,
    `${name}: ${headline}. ${feeLabel(card.id)}.`,
    `${name}: ${firstClause}. ${feeLabel(card.id)}. Every rule quoted from ${possessive(issuer)} terms.`,
    `${name}: ${firstClause}. ${feeLabel(card.id)}.`,
    `${name}: every earning rate, cap and fee, quoted from ${possessive(issuer)} terms. ${feeLabel(card.id)}.`,
    `${name}: every earning rate, cap and fee, from ${possessive(issuer)} terms.`,
  ])
  const canonical = `${SITE}/cards/${card.id}`
  const rotates = quarterly.has(card.id)
  const body = `
      <div class="card-head">${art(card.id, 112)}<h1>${esc(card.name)}</h1></div>
      <p class="updated">${esc(issuer)} · ${esc(card.business ? 'Business card' : 'Personal card')} · Checked against ${esc(possessive(issuer))} terms ${esc(shortDate(card.last_verified))}</p>
      <p class="answer">The ${esc(name)} earns <strong>${esc(headline)}</strong>. ${esc(feeLabel(card.id))}.${value}${closed ? ` ${esc(issuer)} stopped taking applications for it on ${esc(shortDate(card.applications_closed ?? ''))}; cardholders keep earning.` : ''}${card.only_at ? ` It works only at ${esc(listed(card.only_at.map((id) => merchantName(id) ?? words(id))))}.` : ''}</p>
      ${cardActions(card)}
      ${closed ? '' : rankSection(card, all, byPage, transferByPage)}
      <h2>Earning rates</h2>
      ${rulesList(card)}
      ${choicesText(card)}
      ${milestonesText(card)}
      ${rotates ? `<p>Its categories quarter by quarter, with deadlines: <a href="/quarterly/">this quarter's bonus categories</a>.</p>` : ''}
      ${
        worth
          ? feeWorthSection(
              ctx,
              worth,
              TRANSFER_VALUES[card.currency] === undefined
                ? undefined
                : {
                    worth: feeWorthTransferred(card),
                    cents: TRANSFER_VALUES[card.currency],
                  },
            )
          : ''
      }
      ${introRatesText(card)}
      ${creditsText(card)}
      ${freeNightsText(card)}
      ${foreignFeeSection(card)}
      ${offerText(card)}
      ${recentChangesSection(ctx, releases, card.id)}
      ${comparedWith(card, comparisons)}
      <h2>Sources</h2>
      <ul>${card.source_urls.map((u) => `<li><a href="${esc(u)}" rel="nofollow noopener">${esc(hostname(u) + new URL(u).pathname)}</a></li>`).join('')}</ul>
      <p class="muted">Rankings compare ${card.business ? 'business' : 'personal'} cards, each set up at its best for the purchase, with points at earnrate's default value. Rates change; check ${esc(possessive(issuer))} terms before you apply.</p>`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CreditCard',
    name: card.name,
    url: canonical,
    provider: { '@type': 'BankOrCreditUnion', name: issuer },
    feesAndCommissionsSpecification: feeLabel(card.id),
    description: `${headline}.`,
  }
  images.push({
    file: `og/cards/${card.id}.jpg`,
    color: cardColor(catalog, card.id),
    kicker: `${issuer} · ${feeLabel(card.id).split(';')[0] ?? ''}`,
    name: card.short_name ?? name,
    line: capitalize(firstClause),
  })
  return layout({
    title,
    description,
    path: `/cards/${card.id}`,
    body,
    jsonLd,
    crumbs: [
      { name: 'Cards', path: '/cards/' },
      { name: card.short_name ?? name, path: `/cards/${card.id}` },
    ],
    image: `/og/cards/${card.id}.jpg`,
  })
}

function renderCardIndex(): string {
  const byIssuer = new Map<string, Card[]>()
  for (const card of catalog.cards)
    byIssuer.set(card.issuer, [...(byIssuer.get(card.issuer) ?? []), card])
  const sections = [...byIssuer]
    .sort((a, b) => issuerName(a[0]).localeCompare(issuerName(b[0])))
    .map(
      ([issuer, list]) =>
        `<h2>${esc(issuerName(issuer))}</h2><ul class="card-grid">${list
          .map(
            (c) =>
              `<li><a href="/cards/${c.id}">${art(c.id, 44)}<span>${esc(c.short_name ?? shortName(c.id))}</span></a></li>`,
          )
          .join('')}</ul>`,
    )
    .join('')
  return layout({
    title: fitTitle(['Credit card rewards rates, from issuer terms']),
    description: `Earning rates, caps and annual fees for ${String(catalog.cards.length)} U.S. credit cards, each quoted from the issuer's own terms. No affiliate links.`,
    path: '/cards/',
    crumbs: [{ name: 'Cards', path: '/cards/' }],
    body: `
      <h1>Credit cards earnrate tracks</h1>
      <p class="updated">Updated ${esc(dayWords(dataDate))}</p>
      <p>Every earning rule for ${String(catalog.cards.length)} U.S. cards, quoted from the issuer's own terms, and where each card beats the others.</p>
      ${sections}
      <p class="muted">The card pictures are earnrate's drawings in each card's color, not the issuers' designs.</p>`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      url: `${SITE}/cards/`,
    },
  })
}

const images: OgImage[] = []
const { feeWorth } = feeWorthKit(catalog, today)
// The fee math again with points valued as transfers ("I transfer points").
const { feeWorth: feeWorthTransferred } = feeWorthKit(
  catalog,
  today,
  TRANSFER_VALUES,
)
const quarterly = new Set(quarterlyCardIds(catalog))
const sideOf = (c: Comparison, side: 'a' | 'b') => ({
  card: c[side],
  sim: c.typical[side],
  value: c.value[side],
  cell: (row: CompareRow) => row[side],
})

// "after its $325 annual fee", "with no annual fee", plus any membership the
// simulation counted.
function costText(sim: Simulation): string {
  const fee =
    sim.annualFees === 0
      ? 'with no annual fee'
      : `after its ${wholeDollars(sim.annualFees)} annual fee`
  const m = listed(
    sim.memberships.map(
      (x) => `the ${wholeDollars(x.annualFee)} ${x.name} it needs`,
    ),
  )
  return m === ''
    ? fee
    : sim.annualFees === 0
      ? `after ${m}`
      : `${fee} and ${m}`
}

function valueText(c: Comparison): string {
  const programs = [
    ...new Map(
      (['a', 'b'] as const)
        .map((s) => c.value[s])
        .filter((v) => v.currency !== 'cash')
        .map((v) => [v.currency, v]),
    ).values(),
  ]
  if (programs.length === 0) return 'Both earn cash back.'
  return `Points are counted at ${listed(programs.map((v) => `${num(v.centsPerUnit)}¢ each for ${currencyName(catalog, v.currency)}`))}, what they're worth as cash or travel credit; transferring them to airlines or hotels can be worth more.`
}

// "Counting Amex Membership Rewards at 1.7¢, … the Amex Gold comes out
// ahead instead", when either card earns Amex or Chase points.
function transferText(c: Comparison): string {
  const t = c.transfer
  if (!t) return ''
  const n = (id: string) => esc(shortName(id))
  const programs = [
    ...new Set(
      [c.a, c.b]
        .filter((k) => TRANSFER_VALUES[k.currency] !== undefined)
        .map((k) => currencyName(catalog, k.currency)),
    ),
  ]
  const before = Math.round(c.typical.a.net) - Math.round(c.typical.b.net)
  const gap = Math.round(t.a.net) - Math.round(t.b.net)
  const [win, lose] = gap >= 0 ? [t.a, t.b] : [t.b, t.a]
  const [winId, loseId] = gap >= 0 ? [c.a.id, c.b.id] : [c.b.id, c.a.id]
  const counting = `Counting ${esc(listed(programs))} at ${String(t.cents)}¢ a point, what transferring to airlines and hotels can be worth`
  if (gap === 0)
    return ` ${counting}, they come out even: about ${wholeDollars(t.a.net)} a year each.`
  const flips = Math.sign(gap) !== Math.sign(before)
  return ` ${counting}, the <strong>${n(winId)}</strong> ${flips ? 'comes out ahead instead' : 'still earns more'}: about ${wholeDollars(win.net)} a year against ${wholeDollars(lose.net)} for the ${n(loseId)}.`
}

function compareAnswer(c: Comparison): string {
  const [x, y] = (['a', 'b'] as const).map((s) => sideOf(c, s)) as [
    ReturnType<typeof sideOf>,
    ReturnType<typeof sideOf>,
  ]
  const gap = Math.round(x.sim.net) - Math.round(y.sim.net)
  const [win, lose] = gap >= 0 ? [x, y] : [y, x]
  const n = (s: typeof x) => esc(shortName(s.card.id))
  const lead =
    gap === 0
      ? `At typical U.S. spending, the ${n(x)} and the ${n(y)} come out even: about ${wholeDollars(x.sim.net)} a year each after fees.`
      : `At typical U.S. spending, the <strong>${n(win)}</strong> earns more: about ${wholeDollars(win.sim.net)} a year ${esc(costText(win.sim))}, against ${wholeDollars(lose.sim.net)} for the ${n(lose)} ${esc(costText(lose.sim))}. That's ${wholeDollars(Math.abs(gap))} a year more.`
  return `<p class="answer">${lead}${transferText(c)}</p>`
}

// How the verdict is figured, below the rates: the spending, point values
// and what credits would add.
function compareBasis(c: Comparison): string {
  const [x, y] = (['a', 'b'] as const).map((s) => sideOf(c, s)) as [
    ReturnType<typeof sideOf>,
    ReturnType<typeof sideOf>,
  ]
  const spend = TYPICAL_MONTHLY_SPEND.map(
    (t) =>
      `${findCategory(catalog, t.what) === null ? t.what : t.what.toLowerCase()} ${wholeDollars(t.monthly)}`,
  ).join(', ')
  const credits = [x, y].flatMap((s) =>
    s.sim.credits
      .filter((k) => !k.held)
      .map((k) =>
        ifCreditsUsedText(
          k,
          s.sim.netIfCreditsUsed,
          'nets',
          `the ${possessive(shortName(s.card.id))}`,
        ),
      ),
  )
  const unheld = [x, y].flatMap((s) => s.sim.credits.filter((k) => !k.held))
  const onlyIf = creditsOnlyIf({
    yearly: 0,
    names: unheld.flatMap((k) => k.names),
    nightIds: unheld.flatMap((k) => k.nightIds),
  })
  const creditsText =
    credits.length === 0 ? '' : ` ${esc([...credits, onlyIf].join(' '))}`
  return `<h2>How this is figured</h2><p>Typical spending here is ${wholeDollars(c.typical.spend)} a year (a month: ${esc(spend)}), each card used on its own for everything, with its best bonus picks. ${esc(valueText(c))}${creditsText}</p>`
}

const unverifiedEntry = (e: ExploreEntry | null) =>
  e !== null && isUnverified(e)

function rateCell(cell: CompareCell, win: boolean): string {
  const e = cell.entry
  if (!e)
    return `<td class="muted">${cell.excluded ? 'Not accepted' : 'Not usable'}</td>`
  const lines = requirementLines(e.cardId, e.requirements, untilText(e))
  if (unverifiedEntry(e)) lines.push('Not yet confirmed')
  return `<td${win ? ' class="win"' : ''}><span class="rate">${pct(e.effectiveReturnPct)}</span>${win ? '<span class="visually-hidden"> (earns more)</span>' : ''}${lines.length > 0 ? `<span class="cell-note">${lines.map(esc).join('. ')}</span>` : ''}</td>`
}

function compareTable(c: Comparison): string {
  const head = (card: Card) =>
    `<th scope="col"><a href="/cards/${card.id}">${esc(shortName(card.id))}</a></th>`
  const rows = c.rows
    .map(
      (r) =>
        `<tr><th scope="row">${esc(r.label)}</th>${rateCell(r.a, r.winner === 'a')}${rateCell(r.b, r.winner === 'b')}</tr>`,
    )
    .join('')
  const reasons = [
    ...new Set(
      c.rows.flatMap((r) =>
        [r.a.excluded, r.b.excluded].filter((x) => x !== null),
      ),
    ),
  ]
  return `<div class="table-box"><table class="compare"><thead><tr><th scope="col">Purchase</th>${head(c.a)}${head(c.b)}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted">What each purchase earns back, with each card set up at its best for it (the right bonus pick, any activation done, no cap used up yet). The higher rate is highlighted.${reasons.length > 0 ? ` ${reasons.map(esc).join(' ')}` : ''}</p>`
}

function suits(c: Comparison): string {
  const items: string[] = []
  for (const side of ['a', 'b'] as const) {
    const me = c[side]
    const them = c[side === 'a' ? 'b' : 'a']
    // Only where its rate is a bonus: winning at 1% because the other card
    // isn't taken suits no one.
    const bonus = (r: CompareRow) => {
      const e = r[side].entry
      return (
        e !== null &&
        e.effectiveReturnPct > me.base_rate * e.centsPerUnit + EPSILON
      )
    }
    const wins = c.rows
      .filter((r) => r.winner === side && bonus(r))
      .map((r) => {
        const mine = r[side].entry?.effectiveReturnPct ?? 0
        const theirs = (side === 'a' ? r.b : r.a).entry?.effectiveReturnPct
        return { r, mine, theirs, margin: mine - (theirs ?? 0) }
      })
      .sort((x, y) => y.r.weight - x.r.weight || y.margin - x.margin)
      .slice(0, 3)
    if (wins.length === 0) continue
    const where = listed(
      wins.map((w) => w.r.where),
      'or',
    )
    const mine = listed(wins.map((w) => `${pct(w.mine)} ${w.r.where}`))
    const theirs = wins.flatMap((w) =>
      w.theirs === undefined ? [] : [pct(w.theirs)],
    )
    const refused = wins.filter((w) => w.theirs === undefined)
    const other = shortName(them.id)
    const tail = [
      ...(theirs.length > 0
        ? [`against ${listed(theirs)} on the ${other}`]
        : []),
      ...(refused.length > 0
        ? [
            theirs.length > 0
              ? `and the ${other} isn't accepted ${listed(refused.map((w) => w.r.where))}`
              : `where the ${other} isn't accepted`,
          ]
        : []),
    ].join(', ')
    items.push(
      `<li>If you spend most ${esc(where)}: the <strong>${esc(shortName(me.id))}</strong> earns ${esc(mine)}, ${esc(tail)}.</li>`,
    )
  }
  const [a, b] = [c.a, c.b]
  const free = [a, b].find((k) => k.annual_fee === 0)
  const paid = free === a ? b : a
  if (free && paid.annual_fee !== undefined && paid.annual_fee > 0)
    items.push(
      `<li>If you'd rather not pay an annual fee: the <strong>${esc(shortName(free.id))}</strong> has none; the ${esc(shortName(paid.id))} costs ${wholeDollars(paid.annual_fee)} a year.</li>`,
    )
  const fx = (k: Card) => k.foreign_transaction_fee
  if (fx(a) !== null && fx(b) !== null && fx(a) !== fx(b)) {
    const [low, high] = (fx(a) ?? 0) < (fx(b) ?? 0) ? [a, b] : [b, a]
    items.push(
      `<li>If you buy abroad: the <strong>${esc(shortName(low.id))}</strong> has ${esc(foreignFeeText(fx(low)).replace(/^No/, 'no').replace(/^(\d)/, 'a $1'))}; the ${esc(shortName(high.id))} charges ${esc(pct(fx(high) ?? 0))}.</li>`,
    )
  }
  return items.length === 0
    ? ''
    : `<h2>Who each card suits</h2><ul>${items.join('')}</ul>`
}

function feesTable(c: Comparison): string {
  const row = (label: string, f: (k: Card) => string) =>
    `<tr><th scope="row">${label}</th><td>${esc(f(c.a))}</td><td>${esc(f(c.b))}</td></tr>`
  const head = (k: Card) => `<th scope="col">${esc(shortName(k.id))}</th>`
  return `<h2>Fees</h2><div class="table-box"><table class="compare"><thead><tr><th scope="col"></th>${head(c.a)}${head(c.b)}</tr></thead><tbody>${row(
    'Annual fee',
    (k) => feeLabel(k.id).split('; needs ')[0] ?? '',
  )}${row('Foreign transaction fee', (k) => {
    const f = k.foreign_transaction_fee
    return f === null ? 'Not on file' : f === 0 ? 'None' : pct(f)
  })}${row('Membership needed', (k) =>
    k.requires_membership === undefined
      ? 'None'
      : capitalize(membershipText(catalog, k.requires_membership)),
  )}</tbody></table></div>`
}

function compareOffers(c: Comparison): string {
  const items = [c.a, c.b].map((card) => {
    const o = card.welcome_offer
    const name = `<strong>${esc(shortName(card.id))}:</strong>`
    if (!o || !inEffect(o, today))
      return `<li>${name} no public welcome offer on its issuer's page as of ${esc(shortDate(card.last_verified))}.</li>`
    return `<li>${name} ${esc(offerTerms(o, currencyName(catalog, card.currency)))}${o.valid_to ? `, through ${esc(shortDate(o.valid_to))}` : ''}, per the issuer's page as of ${esc(shortDate(card.last_verified))}.</li>`
  })
  return `<h2>Public welcome offers</h2><ul>${items.join('')}</ul><p class="muted">${esc(OFFERS_MAY_DIFFER)}</p>`
}

function compareQuotes(c: Comparison): string {
  const block = (side: 'a' | 'b') => {
    const card = c[side]
    const ruleIds = [
      ...new Set(
        c.rows
          .map((r) => r[side].entry?.matchedRule)
          .filter((id): id is string => typeof id === 'string'),
      ),
      'base_rate',
      'foreign_transaction_fee',
    ]
    const quotes = [
      ...new Map(
        ruleIds
          .map((id) => card.evidence.find((e) => e.rule === id))
          .filter((e) => e !== undefined)
          .map((e) => [`${e.quote}|${e.url}`, e]),
      ).values(),
    ]
    const issuer = issuerName(card.issuer)
    return `<h3><a href="/cards/${card.id}">${esc(card.name)}</a></h3><p class="muted">Checked against ${esc(possessive(issuer))} terms ${esc(shortDate(card.last_verified))}.</p><ul class="quotes">${quotes
      .map(
        (e) =>
          `<li>“${esc(e.quote)}” <a href="${esc(e.url)}" rel="nofollow noopener">${esc(hostname(e.url))}</a></li>`,
      )
      .join('')}</ul>`
  }
  return `<h2>From the issuers' terms</h2><div class="issuer-quotes">${block('a')}${block('b')}</div>`
}

function renderCompare(c: Comparison): string {
  const [na, nb] = [shortName(c.a.id), shortName(c.b.id)]
  const title = fitTitle([
    `${na} vs ${nb}: rewards, fees and which earns more (${thisQuarter})`,
    `${na} vs ${nb}: rewards, fees and which earns more`,
    `${na} vs ${nb}: which earns more`,
    `${na} vs ${nb}`,
    `${c.a.short_name ?? na} vs ${c.b.short_name ?? nb}`,
  ])
  const winner =
    Math.round(c.typical.a.net) === Math.round(c.typical.b.net)
      ? null
      : c.typical.a.net > c.typical.b.net
        ? na
        : nb
  const verdict = winner
    ? `the ${winner} earns more at typical U.S. spending after fees`
    : 'they come out even at typical U.S. spending after fees'
  const description = fitDescription([
    `${na} vs ${nb}, rate by rate from the issuers' terms: ${verdict}. Fees, welcome offers and who each card suits. No affiliate links.`,
    `${na} vs ${nb}, rate by rate from the issuers' terms: ${verdict}.`,
    `${na} vs ${nb}: ${verdict}.`,
    `${na} vs ${nb}, rate by rate from the issuers' terms.`,
  ])
  const canonical = `${SITE}/compare/${c.pair.slug}`
  const body = `
      <div class="vs-head">${art(c.a.id, 96)}<span class="vs">vs</span>${art(c.b.id, 96)}</div>
      <h1>${esc(na)} vs ${esc(nb)}</h1>
      <p class="updated">Updated ${esc(dayWords(compareDate(c.pair)))} · ${esc(issuerName(c.a.issuer))} and ${esc(issuerName(c.b.issuer))} · ${c.a.business ? 'Business cards' : 'Personal cards'}</p>
      ${compareAnswer(c)}
      ${pageActions([
        {
          when: ['none'],
          html: button(
            `/#spending&card=${c.a.id}&card=${c.b.id}`,
            'Compare them on your spending',
          ),
        },
        {
          when: ['other', 'holds'],
          html: `${button(`/#spending&card=${c.a.id}&card=${c.b.id}`, 'Compare them on your spending')} ${textLink(`/#wallet&whatif=${c.a.id}&whatif=${c.b.id}`, 'See what each adds to your cards')}`,
        },
      ])}
      <h2>Rates by purchase</h2>
      ${compareTable(c)}
      ${compareBasis(c)}
      ${suits(c)}
      ${feesTable(c)}
      ${compareOffers(c)}
      ${compareQuotes(c)}
      <h2>Each card in full</h2>
      ${chipLinks([`<a href="/cards/${c.a.id}">${esc(c.a.name)}</a>`, `<a href="/cards/${c.b.id}">${esc(c.b.name)}</a>`, '<a href="/compare/">Every comparison</a>'])}
      <p class="muted">Typical spending, point values and fees come from earnrate's data, and every rate from the issuers' terms. Rates change; check each issuer's terms before you apply.</p>`
  const cardLd = (k: Card) => ({
    '@type': 'CreditCard',
    name: k.name,
    url: `${SITE}/cards/${k.id}`,
    provider: { '@type': 'BankOrCreditUnion', name: issuerName(k.issuer) },
    feesAndCommissionsSpecification: feeLabel(k.id),
  })
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: canonical,
    dateModified: compareDate(c.pair),
    about: [cardLd(c.a), cardLd(c.b)],
  }
  return layout({
    title,
    description,
    path: `/compare/${c.pair.slug}`,
    body,
    jsonLd,
    crumbs: [
      { name: 'Comparisons', path: '/compare/' },
      { name: `${na} vs ${nb}`, path: `/compare/${c.pair.slug}` },
    ],
  })
}

function comparedWith(card: Card, pairs: ComparePair[]): string {
  const mine = pairs.filter((p) => p.a === card.id || p.b === card.id)
  if (mine.length === 0) return ''
  return `<h2>Compared with</h2>${chipLinks(
    mine.map((p) => {
      const other = p.a === card.id ? p.b : p.a
      return `<a href="/compare/${p.slug}">${esc(shortName(other))}</a>`
    }),
  )}`
}

function renderCompareIndex(pairs: ComparePair[]): string {
  const byIssuer = new Map<string, Card[]>()
  for (const card of catalog.cards)
    if (pairs.some((p) => p.a === card.id || p.b === card.id))
      byIssuer.set(card.issuer, [...(byIssuer.get(card.issuer) ?? []), card])
  const sections = [...byIssuer]
    .sort((a, b) => issuerName(a[0]).localeCompare(issuerName(b[0])))
    .map(
      ([issuer, list]) =>
        `<h2>${esc(issuerName(issuer))}</h2><ul class="compare-list">${list
          .map((card) => {
            const links = pairs
              .filter((p) => p.a === card.id || p.b === card.id)
              .map(
                (p) =>
                  `<a href="/compare/${p.slug}">vs ${esc(shortName(p.a === card.id ? p.b : p.a))}</a>`,
              )
            return `<li>${art(card.id, 36)}<div><strong>${esc(shortName(card.id))}</strong>${chipLinks(links)}</div></li>`
          })
          .join('')}</ul>`,
    )
    .join('')
  return layout({
    title: fitTitle(['Credit card comparisons, from issuer terms']),
    description: fitDescription([
      `${String(pairs.length)} side-by-side credit card comparisons: rates by purchase, fees, welcome offers and which earns more at typical spending, from the issuers' terms. No affiliate links.`,
      `${String(pairs.length)} side-by-side credit card comparisons: rates, fees, welcome offers and which earns more, from the issuers' terms.`,
    ]),
    path: '/compare/',
    crumbs: [{ name: 'Comparisons', path: '/compare/' }],
    body: `
      <h1>Credit cards compared</h1>
      <p class="updated">Updated ${esc(dayWords(dataDate))}</p>
      <p>${String(pairs.length)} side-by-side comparisons, each from the issuers' own terms. Each pairs cards from different issuers that earn bonuses in at least two of the same everyday categories with similar fees, or two of one issuer's cards that earn the same points. Business cards are compared only with business cards.</p>
      ${sections}`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      url: `${SITE}/compare/`,
    },
  })
}

// lastmod is when a page's facts last changed, not when it was built: a
// card page follows its card file, the rankings follow all of data/, and
// the static pages their own source. A dated rule, credit or offer that
// started or ended changes the pages on that day though no file did. Pages
// show it as their "Updated" date too.
const changed = changeDates(ROOT, ['data', 'site'], today)
function datedChange(card: Card): string {
  const dates = [
    ...card.rules,
    ...card.credits,
    ...(card.welcome_offer ? [card.welcome_offer] : []),
  ].flatMap((t) => [
    ...('valid_from' in t && t.valid_from ? [t.valid_from] : []),
    ...(t.valid_to ? [addDays(t.valid_to, 1)] : []),
  ])
  return latest(dates.filter((d) => d <= today))
}
const changedOn = (file: string) => {
  const id = /^data\/cards\/(.+)\.yaml$/.exec(file)?.[1]
  const card = id === undefined ? undefined : cards.get(id)
  return latest([changed(file), card ? datedChange(card) : ''])
}
const dataFiles = (await readdir(DATA_DIR, { recursive: true }))
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => path.join('data', f))
const dataDate = latest(dataFiles.map(changedOn))
const filesDate = (files: string[]) => latest(files.map(changedOn))
const merchantsDate = filesDate(
  dataFiles.filter((f) => f.startsWith('data/merchants/')),
)
const noFeeFiles = catalog.cards
  .filter((c) => c.annual_fee === 0)
  .map((c) => `data/cards/${c.id}.yaml`)
const cardDate = (c: Card) =>
  latest([
    changedOn(`data/cards/${c.id}.yaml`),
    changed('data/currencies.yaml'),
    // Its annual-fee section compares it with every no-fee card.
    ...(c.annual_fee ? noFeeFiles.map(changedOn) : []),
  ])
const compareDate = (p: ComparePair) =>
  latest([
    changedOn(`data/cards/${p.a}.yaml`),
    changedOn(`data/cards/${p.b}.yaml`),
    changed('data/currencies.yaml'),
  ])

const comparisons = comparePairs(catalog, today)
const all = pages(catalog)
const bestSlug = (merchantId: string) =>
  all.find((p) => p.merchant?.id === merchantId)?.slug ?? null
const categorySlug = (id: string): string | null => {
  const page = catalog.categories.find((c) => c.id === id)?.page ?? id
  return (
    all.find((p) => p.merchant === null && p.categoryId === page)?.slug ?? null
  )
}
const results = new Map(
  all.map((p) => [p.slug, exploreCards(catalog, p.query, options)]),
)
const categoryPageOf = (p: Page) =>
  all.find((c) => c.merchant === null && c.categoryId === p.categoryId)
const indexReasons = new Map(
  all.map((p) => {
    const r = results.get(p.slug)
    const category = categoryPageOf(p)
    return [
      p.slug,
      p.merchant === null || !r
        ? ['a category']
        : storeIndexReasons(
            catalog,
            p.merchant,
            r,
            category && results.get(category.slug),
            ranked,
          ),
    ]
  }),
)
const isIndexed = (p: Page) => (indexReasons.get(p.slug)?.length ?? 0) > 0
const businessResults = new Map(
  all.map((p) => [
    p.slug,
    exploreCards(catalog, p.query, {
      ...options,
      filters: { ...ALL_PERSONAL_CARDS, business: true },
    }),
  ]),
)
// The same rankings with Amex and Chase points at their transfer value, for
// card pages' "If you transfer" placements.
const transferOptions = { ...options, valuations: TRANSFER_VALUES }
const transferResults = new Map(
  all.map((p) => [p.slug, exploreCards(catalog, p.query, transferOptions)]),
)
const businessTransfer = new Map(
  all.map((p) => [
    p.slug,
    exploreCards(catalog, p.query, {
      ...transferOptions,
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
    renderCard(
      card,
      all,
      card.business ? businessResults : results,
      card.business ? businessTransfer : transferResults,
    ),
  )
}
await writeFile(path.join(OUT, 'cards', 'index.html'), renderCardIndex())
await mkdir(path.join(OUT, 'compare'), { recursive: true })
const compare = comparer(catalog, today)
for (const pair of comparisons)
  await writeFile(
    path.join(OUT, 'compare', `${pair.slug}.html`),
    renderCompare(compare(pair)),
  )
await writeFile(
  path.join(OUT, 'compare', 'index.html'),
  renderCompareIndex(comparisons),
)
// Either order of the two cards reaches the one page, and a category
// answered by another's page sends its own address there.
await writeFile(
  path.join(OUT, '_redirects'),
  [
    ...catalog.categories.flatMap((cat) => {
      const to = cat.page === undefined ? null : categorySlug(cat.page)
      return to === null ? [] : [`/best/${categoryAddress(cat)} /best/${to}`]
    }),
    ...comparisons.map((p) => `/compare/${p.b}-vs-${p.a} /compare/${p.slug}`),
  ]
    .map((line) => `${line} 301\n`)
    .join(''),
)
await writeFile(
  path.join(OUT, '404.html'),
  layout({
    title: 'Page not found | earnrate',
    description: "This page doesn't exist.",
    path: '/',
    crumbs: [],
    noindex: true,
    body: `
      <h1>That page doesn't exist</h1>
      <p>Try the <a href="/">card comparison</a>, or the <a href="/best/">best card for every store and category</a>.</p>`,
    jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage' },
  }),
)

const generated: GeneratedPage[] = [
  ...quarterlyPages(
    ctx,
    { category: categorySlug, merchant: bestSlug },
    filesDate,
  ),
  howStoresCodePage(
    ctx,
    bestSlug,
    latest([
      merchantsDate,
      filesDate(catalog.cards.map((c) => `data/cards/${c.id}.yaml`)),
    ]),
  ),
  ...categoryPages(ctx, categorySlug, filesDate),
  changesPage(ctx, releases),
]
for (const page of generated) {
  await mkdir(path.dirname(path.join(OUT, page.file)), { recursive: true })
  await writeFile(path.join(OUT, page.file), page.html)
}
await writeFile(path.join(OUT, 'changes.xml'), changesFeed(catalog, releases))
const changesDate = generated.find((g) => g.path === '/changes')?.lastmod ?? ''
const urls: [string, string][] = [
  [`${SITE}/`, latest([dataDate, changed('site/index.html')])],
  [`${SITE}/best/`, dataDate],
  ...all.filter(isIndexed).map((p): [string, string] => [
    `${SITE}/best/${p.slug}`,
    // A store's "How it codes" follows the merchant files, already in data/.
    p.merchant && hasCodingNotes(p.merchant)
      ? latest([dataDate, merchantsDate])
      : dataDate,
  ]),
  [`${SITE}/cards/`, dataDate],
  ...catalog.cards.map((c): [string, string] => [
    `${SITE}/cards/${c.id}`,
    cardDate(c),
  ]),
  ...generated.map((g): [string, string] => [`${SITE}${g.path}`, g.lastmod]),
  [`${SITE}/compare/`, dataDate],
  ...comparisons.map((p): [string, string] => [
    `${SITE}/compare/${p.slug}`,
    compareDate(p),
  ]),
  ...['privacy', 'terms', 'support'].map((page): [string, string] => [
    `${SITE}/${page}`,
    changed(`site/${page}.html`),
  ]),
  // Its freshness line and recent changes follow the change record.
  [`${SITE}/companies`, latest([changed('site/companies.html'), changesDate])],
]
await writeFile(
  path.join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, date]) => `  <url><loc>${u}</loc><lastmod>${date}</lastmod></url>`).join('\n')}
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
const drawn =
  process.env.EARNRATE_OG === 'off' ? null : await drawImages(ROOT, OUT, images)
console.log(
  `Wrote ${String(all.length)} search pages (${String(all.filter((p) => !isIndexed(p)).length)} stores noindex), ${String(catalog.cards.length)} card pages, ${String(comparisons.length)} card comparisons, ${String(generated.length)} other pages, sitemap.xml, _redirects and robots.txt.${drawn ? ` ${String(images.length)} preview images (${String(drawn.drawn)} redrawn), ${(drawn.bytes / 1e6).toFixed(1)} MB.` : ''}`,
)
