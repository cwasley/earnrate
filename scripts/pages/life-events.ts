// /welcome-offers/<event>: a big expense as a list of purchases. Each
// purchase is resolved to earnrate's stores and categories, ranked the way
// the /best/ pages rank them, and followed by the hub's picker, so the
// reader taps in their own budget. A new event is a new entry in
// LIFE_EVENTS; every sentence about a purchase comes from the store,
// category or card data.
import { EPSILON } from '../../src/engine/compare.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  type ExploreEntry,
  type ExploreOptions,
  type Exploration,
} from '../../src/engine/explore.ts'
import { TRANSFER_VALUES } from '../../src/engine/fee-worth.ts'
import {
  CARD_SURCHARGE_NOTE,
  OFFERS_MAY_DIFFER,
} from '../../src/engine/offers.ts'
import { inEffect } from '../../src/engine/periods.ts'
import {
  capitalize,
  categoryAs,
  categoryPhrase,
  categoryPurchases,
  categoryReadsOn,
  inOrder,
  midSentence,
  num,
  pct,
} from '../../src/engine/text.ts'
import { FROM_OPENING, openFirst } from '../../src/engine/welcome-offers.ts'
import { findMerchant, merchantFamily } from '../../src/merchants/resolve.ts'
import type { Merchant } from '../../src/schema/merchant.ts'
import type { GeneratedPage, PageContext } from './context.ts'
import { quoteText } from './rules.ts'
import { esc, finePrint, fitDescription, fitTitle, SITE } from './site.ts'
import {
  HUB_PATH,
  HUB_SHORT,
  OPEN_FIRST_LEAD,
  offerPicker,
  openFirstList,
  type Offers,
} from './welcome-offers.ts'

// One purchase: a store (or several of one kind) earnrate has, a category,
// or neither, when earnrate has no category for it and it counts as
// everything else (`kind` names it: "bridal shops").
export type PurchaseLine = {
  label: string
  merchants?: string[]
  category?: string
  kind?: string
}

// Words whose sentences in card rules' notes a page gathers: what each
// card's terms say about caterers, gift cards or insurance.
export type TermsWord = { word: string; what: string }

export type LifeEvent = {
  slug: string
  name: string // the hub's link: "Wedding"
  h1: string
  titles: string[] // longest first
  descriptions: string[]
  lines: PurchaseLine[]
  terms?: TermsWord[]
  // Rankings also at transfer value, and the card travel sites' rates.
  travel?: boolean
  // Business cards too, for a bill a business may pay.
  business?: boolean
  related?: string[] // other events' slugs to name first
}

export const LIFE_EVENTS: LifeEvent[] = [
  {
    slug: 'wedding',
    name: 'Wedding',
    h1: 'Best credit cards for wedding expenses',
    titles: ['Best credit cards for wedding expenses'],
    descriptions: [
      'Which card earns the most on rings, the dress, the caterer, the venue and the honeymoon, how each bill codes, and which welcome offers your budget unlocks.',
      'Which card earns the most on each wedding bill, how each codes, and which welcome offers your budget unlocks.',
    ],
    lines: [
      {
        label: 'Engagement and wedding rings',
        merchants: ['kay-jewelers', 'zales', 'jared', 'tiffany'],
      },
      { label: 'Wedding dress', category: 'clothing' },
      { label: 'Tux or suit', merchants: ['mens-wearhouse'] },
      { label: 'Photographer', kind: 'photographers' },
      { label: 'Florist', kind: 'florists' },
      { label: 'Caterer', category: 'caterers' },
      { label: 'Venue', kind: 'wedding venues' },
      { label: 'Honeymoon flights', category: 'travel.flights' },
      { label: 'Honeymoon hotels', category: 'travel.hotels' },
    ],
    terms: [{ word: 'caterer', what: 'caterers' }],
    related: ['travel'],
  },
  {
    slug: 'holiday-shopping',
    name: 'Holiday shopping',
    h1: 'Best credit cards for holiday shopping',
    titles: ['Best credit cards for holiday shopping'],
    descriptions: [
      'Which card earns the most at department stores, Amazon, electronics, clothing and toy stores, what card terms say about gift cards, and which welcome offers your spending unlocks.',
      'Which card earns the most on holiday gifts, what card terms say about gift cards, and which welcome offers your spending unlocks.',
    ],
    lines: [
      { label: 'Department stores', category: 'department_store' },
      { label: 'Amazon', merchants: ['amazon'] },
      { label: 'Other online shopping', category: 'online_retail' },
      { label: 'Electronics', category: 'electronics' },
      { label: 'Clothing', category: 'clothing' },
      { label: 'Toy stores', category: 'toy_store' },
    ],
    terms: [{ word: 'gift card', what: 'gift cards' }],
  },
  {
    slug: 'insurance-premiums',
    name: 'Insurance premiums',
    h1: 'Best credit card for paying insurance premiums',
    titles: ['Best credit card for paying insurance premiums'],
    descriptions: [
      'Insurance has no bonus category: which cards earn the most on auto, home, renters and malpractice premiums, what card terms say about insurance, and which welcome offers a premium unlocks.',
      'Which cards earn the most on insurance premiums, what card terms say about insurance, and which welcome offers a premium unlocks.',
    ],
    lines: [
      { label: 'Auto insurance, billed every 6 months', category: 'insurance' },
      { label: 'Homeowners insurance', category: 'insurance' },
      { label: 'Renters insurance', category: 'insurance' },
      {
        label: 'Professional liability (malpractice) insurance',
        category: 'insurance',
      },
    ],
    terms: [{ word: 'insurance', what: 'insurance' }],
    business: true,
  },
  {
    slug: 'moving',
    name: 'Moving',
    h1: 'Best credit cards for moving and furnishing a home',
    titles: [
      'Best credit cards for moving and furnishing a home',
      'Best credit cards for moving',
    ],
    descriptions: [
      'Which card earns the most on movers, a moving truck, furniture, home improvement and electronics, how each codes, and which welcome offers the move unlocks.',
      'Which card earns the most on each moving bill, how each codes, and which welcome offers the move unlocks.',
    ],
    lines: [
      { label: 'Movers', kind: 'moving companies' },
      {
        label: 'Moving truck',
        merchants: ['u-haul', 'penske-truck-rental', 'budget-truck-rental'],
      },
      { label: 'Furniture stores', category: 'furniture' },
      { label: 'Furniture online', merchants: ['wayfair'] },
      { label: 'Home improvement', category: 'home_improvement' },
      { label: 'Electronics', category: 'electronics' },
    ],
  },
  {
    slug: 'travel',
    name: 'A big trip',
    h1: 'Best credit cards for a big trip',
    titles: [
      'Best credit cards for a big trip or honeymoon',
      'Best credit cards for a big trip',
    ],
    descriptions: [
      'Which card earns the most on flights, hotels, car rentals and cruises, booked directly or through a card’s travel site, with points at transfer value, and which welcome offers the trip unlocks.',
      'Which card earns the most on flights, hotels, car rentals and cruises, with points at transfer value, and which welcome offers the trip unlocks.',
    ],
    lines: [
      { label: 'Flights', category: 'travel.flights' },
      { label: 'Hotels', category: 'travel.hotels' },
      { label: 'Car rentals', category: 'travel.car_rental' },
      { label: 'Cruises', category: 'travel.cruise' },
    ],
    travel: true,
  },
]

export const eventPath = (e: LifeEvent) => `${HUB_PATH}/${e.slug}`

const RANKED = 3

export type EventLinks = {
  category: (id: string) => string | null // only an indexed page
  store: (id: string) => string | null
}

type Resolved = {
  line: PurchaseLine
  category: string
  merchants: Merchant[]
}

export function resolveLine(ctx: PageContext, line: PurchaseLine): Resolved {
  const merchants = (line.merchants ?? []).map((id) => {
    const m = findMerchant(ctx.catalog, id)
    if (!m) throw new Error(`${line.label}: no store ${id}`)
    return m
  })
  const category = merchants[0]?.category ?? line.category ?? 'other'
  if (!ctx.catalog.categories.some((c) => c.id === category))
    throw new Error(`${line.label}: no category ${category}`)
  return { line, category, merchants }
}

const query = (r: Resolved, date: string) => ({
  merchant: r.merchants[0]?.name ?? null,
  category: r.merchants.length > 0 ? null : r.category,
  amount: null,
  channel: null,
  date,
})

// Purchases ranked alike share one ranking.
type Group = {
  key: string
  title: string // "Everything else", "Amazon"
  own: boolean // a store with its own ranking, not its category's
  phrase: string // for sentences: "on everything else", "at Amazon"
  categories: string[]
  lines: Resolved[]
  personal: Exploration
  transfer: Exploration | null
  business: Exploration | null
}

const OPTIONS: ExploreOptions = {
  filters: ALL_PERSONAL_CARDS,
  memberships: [],
  valuations: {},
}

const rankingKey = (ctx: PageContext, r: Exploration | null) =>
  r === null
    ? ''
    : shown(ctx, r)
        .map((e) => `${e.cardId}:${num(e.effectiveReturnPct)}`)
        .join(',')

const categoryName = (ctx: PageContext, id: string) =>
  ctx.catalog.categories.find((c) => c.id === id)?.name ?? id

const categoryOn = (ctx: PageContext, id: string) =>
  `${id === 'other' || categoryReadsOn(ctx.catalog, id) ? 'on' : 'at'} ${categoryPhrase(ctx.catalog, id)}`

export function eventGroups(
  ctx: PageContext,
  event: LifeEvent,
): { resolved: Resolved[]; groups: Group[] } {
  const resolved = event.lines.map((l) => resolveLine(ctx, l))
  const groups: Group[] = []
  for (const r of resolved) {
    const q = query(r, ctx.today)
    const personal = exploreCards(ctx.catalog, q, OPTIONS)
    const transfer = event.travel
      ? exploreCards(ctx.catalog, q, {
          ...OPTIONS,
          valuations: TRANSFER_VALUES,
        })
      : null
    const business = event.business
      ? exploreCards(ctx.catalog, q, {
          ...OPTIONS,
          filters: { ...ALL_PERSONAL_CARDS, business: true },
        })
      : null
    const key = [personal, transfer, business]
      .map((x) => rankingKey(ctx, x))
      .join('|')
    // A store ranked unlike its category is named; otherwise the category.
    const merchant = r.merchants.length === 1 ? r.merchants[0] : undefined
    const own =
      merchant !== undefined &&
      rankingKey(ctx, personal) !==
        rankingKey(
          ctx,
          exploreCards(
            ctx.catalog,
            { ...q, merchant: null, category: r.category },
            OPTIONS,
          ),
        )
    const same = groups.find((g) => g.key === key && !g.own && !own)
    if (same) {
      same.lines.push(r)
      if (!same.categories.includes(r.category)) {
        same.categories.push(r.category)
        same.title = inOrder(
          same.categories.map((c, i) =>
            i === 0 ? categoryName(ctx, c) : midSentence(categoryName(ctx, c)),
          ),
        )
        same.phrase = inOrder(same.categories.map((c) => categoryOn(ctx, c)))
      }
      continue
    }
    groups.push({
      key,
      title: own ? merchant.name : categoryName(ctx, r.category),
      own,
      phrase: own ? `at ${merchant.name}` : categoryOn(ctx, r.category),
      categories: [r.category],
      lines: [r],
      personal,
      transfer,
      business,
    })
  }
  return { resolved, groups }
}

// The top cards, leaving out any whose rule here isn't confirmed yet.
const shown = (ctx: PageContext, r: Exploration) =>
  r.ranked
    .filter(
      (e) =>
        ctx.cards.get(e.cardId)?.rules.find((x) => x.id === e.matchedRule)
          ?.unverified === undefined,
    )
    .slice(0, RANKED)

// "the Citi Double Cash and 3 more earn 2%"
function bestText(ctx: PageContext, entries: ExploreEntry[]): string {
  const [top] = entries
  if (!top) return 'no card earns a bonus'
  const tied = entries.filter(
    (e) => Math.abs(e.effectiveReturnPct - top.effectiveReturnPct) < EPSILON,
  )
  const name = `<strong>${esc(ctx.shortName(top.cardId))}</strong>`
  const rate = pct(top.effectiveReturnPct)
  return tied.length === 1
    ? `the ${name} earns ${rate}`
    : tied.length === 2
      ? `the ${name} and ${esc(ctx.shortName(tied[1]?.cardId ?? ''))} earn ${rate}`
      : `the ${name} and ${String(tied.length - 1)} more earn ${rate}`
}

// Sentences of the card rules' notes that mention a word, per card, with
// the issuer's quote that does. Cards closed to applicants and rules no
// longer in effect are left out.
export function termsNotes(
  ctx: PageContext,
  word: string,
): { cardId: string; sentences: string[]; quotes: string[] }[] {
  const has = (s: string) => s.toLowerCase().includes(word.toLowerCase())
  return ctx.catalog.cards
    .filter((c) => c.applications_closed === undefined)
    .flatMap((card) => {
      const rules = card.rules.filter(
        (r) => inEffect(r, ctx.today) && r.note !== undefined && has(r.note),
      )
      const sentences = [
        ...new Set(
          rules.flatMap((r) =>
            (r.note ?? '').split(/(?<=[.;])\s+(?=[A-Z])/).filter(has),
          ),
        ),
      ]
      if (sentences.length === 0) return []
      const ids = new Set(rules.map((r) => r.id))
      const quotes = [
        ...new Set(
          card.evidence
            .filter((e) => ids.has(e.rule) && has(e.quote))
            .map((e) => quoteText(e.quote)),
        ),
      ]
      return [{ cardId: card.id, sentences, quotes }]
    })
    .sort((a, b) =>
      ctx.shortName(a.cardId).localeCompare(ctx.shortName(b.cardId)),
    )
}

function termsSection(ctx: PageContext, t: TermsWord): string {
  const notes = termsNotes(ctx, t.word)
  if (notes.length === 0) return ''
  const items = notes
    .map(
      (n) =>
        `<li><a href="/cards/${esc(n.cardId)}">${esc(ctx.shortName(n.cardId))}</a>: ${esc(n.sentences.join(' '))}${n.quotes.length === 0 ? '' : `<br><span class="muted">${n.quotes.map((q) => `"${esc(q)}"`).join(' ')}</span>`}</li>`,
    )
    .join('')
  return finePrint(
    `<ul class="change-notes">${items}</ul>`,
    `What ${String(notes.length)} cards' terms say about ${t.what}`,
  )
}

function rankRows(ctx: PageContext, entries: ExploreEntry[]): string {
  return `<ol class="cards">${entries
    .map((e, i) => {
      const card = ctx.cards.get(e.cardId)
      const rule = card?.rules.find((r) => r.id === e.matchedRule)
      const lines = ctx.requirementLines(e.cardId, e.requirements)
      const fine = [
        rule?.note ? `<p>${esc(rule.note)}</p>` : '',
        e.evidence
          ? `<p class="muted">"${esc(quoteText(e.evidence.quote))}"</p>`
          : '',
      ].join('')
      return `<li><span class="rank">${String(i + 1)}</span>${ctx.art(e.cardId)}<div><span class="row-head"><a class="row-link" href="/cards/${esc(e.cardId)}">${esc(ctx.shortName(e.cardId))}</a> <span class="rate">${esc(pct(e.effectiveReturnPct))}</span></span><span class="muted row-note">${esc(ctx.issuerName(e.issuer))} · ${esc(ctx.feeLabel(e.cardId))}</span>${lines.length > 0 ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${finePrint(fine)}</div></li>`
    })
    .join('')}</ol>`
}

// Card travel sites (Chase Travel, Hotel through Amex Travel) where a
// card's rule names the site: the best card there, from the engine.
function travelSites(ctx: PageContext): string {
  const options: ExploreOptions = {
    filters: ALL_PERSONAL_CARDS,
    memberships: [],
    valuations: {},
  }
  const sites = [
    ...ctx.catalog.merchants.overrides,
    ...ctx.catalog.merchants.seed,
  ]
    .filter((m) => m.kind !== undefined && m.category.startsWith('travel'))
    .flatMap((m) => {
      const date = ctx.today
      const q = {
        merchant: m.name,
        category: null,
        amount: null,
        channel: null,
        date,
      }
      const at = exploreCards(ctx.catalog, q, options)
      const family = merchantFamily(ctx.catalog, m.id)
      const naming = at.ranked.find((e) => {
        const rule = ctx.cards
          .get(e.cardId)
          ?.rules.find((r) => r.id === e.matchedRule)
        return (
          rule?.unverified === undefined &&
          (rule?.match.merchants ?? []).some((id) => family.includes(id))
        )
      })
      if (!naming || at.ranked[0]?.cardId !== naming.cardId) return []
      const transfer = exploreCards(ctx.catalog, q, {
        ...options,
        valuations: TRANSFER_VALUES,
      }).ranked.find((e) => e.cardId === naming.cardId)
      return [{ m, e: naming, transfer }]
    })
    .sort(
      (a, b) =>
        b.e.effectiveReturnPct - a.e.effectiveReturnPct ||
        a.m.name.localeCompare(b.m.name),
    )
  if (sites.length === 0) return ''
  const rows = sites
    .map(
      ({ m, e, transfer }) =>
        `<tr><th scope="row">${esc(m.name)}</th><td><a href="/cards/${esc(e.cardId)}">${esc(ctx.shortName(e.cardId))}</a></td><td>${esc(pct(e.effectiveReturnPct))}${transfer && Math.abs(transfer.effectiveReturnPct - e.effectiveReturnPct) > EPSILON ? ` <span class="muted">(${esc(pct(transfer.effectiveReturnPct))} transferred)</span>` : ''}</td></tr>`,
    )
    .join('')
  const quotes = sites
    .filter(({ e }) => e.evidence !== null)
    .map(
      ({ m, e }) =>
        `<p>${esc(m.name)}, ${esc(ctx.shortName(e.cardId))}: "${esc(quoteText(e.evidence?.quote ?? ''))}"</p>`,
    )
    .join('')
  return `<h2 id="travel-sites">Booked through a card's travel site</h2>
      <p>Some cards pay their top travel rates only on trips booked through the issuer's own travel site. Where a card's rule names the site, the card that earns the most there:</p>
      <div class="table-box"><table class="compare"><thead><tr><th scope="col">Booked through</th><th scope="col">Best card</th><th scope="col">Earns</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${finePrint(quotes, "The issuers' words")}`
}

// How each purchase codes, with the store's own note where it has one.
function codingTable(
  ctx: PageContext,
  resolved: Resolved[],
  groups: Group[],
  links: EventLinks,
): string {
  const groupOf = (r: Resolved) => groups.find((g) => g.lines.includes(r))
  const rows = resolved
    .map((r) => {
      const g = groupOf(r)
      const top = g ? shown(ctx, g.personal)[0] : undefined
      const name =
        ctx.catalog.categories.find((c) => c.id === r.category)?.name ??
        r.category
      const href = links.category(r.category)
      const codes =
        href === null ? esc(name) : `<a href="${href}">${esc(name)}</a>`
      const best =
        top === undefined
          ? '—'
          : `<a href="/cards/${esc(top.cardId)}">${esc(ctx.shortName(top.cardId))}</a> <span class="muted">${esc(pct(top.effectiveReturnPct))}</span>`
      return `<tr><th scope="row">${esc(r.line.label)}</th><td>${codes}</td><td>${best}</td></tr>`
    })
    .join('')
  const stores = resolved.flatMap((r) => {
    const m = r.merchants
    if (m.length === 0) return []
    const names = m.map((x) => {
      const href = links.store(x.id)
      return href === null
        ? esc(x.name)
        : `<a href="${href}">${esc(x.name)}</a>`
    })
    const notes = [m[0]?.note, m[0]?.ambiguity?.note].filter(
      (n) => n !== undefined,
    )
    return [
      `${esc(r.line.label)}: ${inOrder(names)} usually ${m.length === 1 ? 'counts' : 'count'} ${esc(categoryAs(ctx.catalog, r.category))}.${notes.map((n) => ` ${esc(n)}`).join('')}`,
    ]
  })
  // Purchases earnrate has no category for, in one line.
  const kinds = [
    ...new Set(resolved.flatMap((r) => (r.line.kind ? [r.line.kind] : []))),
  ]
  const none =
    kinds.length === 0
      ? []
      : [
          `earnrate has no category for ${esc(inOrder(kinds, 'or'))}, so ${kinds.length === 1 && resolved.every((r) => r.line.kind !== undefined) ? `each counts ${esc(categoryAs(ctx.catalog, 'other'))}` : `they count as ${esc(categoryPurchases(ctx.catalog, 'other'))}`} here.`,
        ]
  const notes = [...stores, ...none]
  return `<div class="table-box"><table class="compare"><thead><tr><th scope="col">Purchase</th><th scope="col">Counts as</th><th scope="col">Earns the most</th></tr></thead><tbody>${rows}</tbody></table></div>${
    notes.length === 0
      ? ''
      : `<ul class="change-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>`
  }`
}

function rankings(ctx: PageContext, event: LifeEvent, groups: Group[]): string {
  const block = (g: Group, view: 'default' | 'transfer') => {
    const r = view === 'transfer' ? (g.transfer ?? g.personal) : g.personal
    const lines = g.lines.map((l) => l.line.label)
    const same =
      lines.length === 1 && lines[0]?.toLowerCase() === g.title.toLowerCase()
    return `<h3>${esc(capitalize(g.title))}</h3>${same ? '' : `<p class="muted">For ${esc(inOrder(lines.map(midSentence)))}</p>`}${rankRows(ctx, shown(ctx, r))}${
      view === 'default' && g.business
        ? `<p class="muted">Business cards ${esc(g.phrase)}:</p>${rankRows(ctx, shown(ctx, g.business))}`
        : ''
    }`
  }
  if (!event.travel)
    return `<h2 id="cards">The cards that earn the most</h2>${groups.map((g) => block(g, 'default')).join('')}`
  const cents = [...new Set(Object.values(TRANSFER_VALUES))]
  const option = (value: string, label: string, checked: boolean) =>
    `<label><input type="radio" name="rank-value" value="${value}"${checked ? ' checked' : ''} />${esc(label)}</label>`
  return `<h2 id="cards">The cards that earn the most</h2>
      <div class="ranks"><div class="seg" role="radiogroup" aria-label="Count points at">${option('default', "Points at earnrate's defaults", true)}${option('transfer', `If you transfer (${num(cents[0] ?? 1)}¢)`, false)}</div>
      <div class="rank-view" data-view="default">${groups.map((g) => block(g, 'default')).join('')}</div>
      <div class="rank-view" data-view="transfer"><p class="muted">Amex Membership Rewards and Chase Ultimate Rewards at ${esc(num(cents[0] ?? 1))}¢ each, what transferring them to airlines and hotels can be worth.</p>${groups.map((g) => block(g, 'transfer')).join('')}</div></div>`
}

export function lifeEventPage(
  ctx: PageContext,
  event: LifeEvent,
  offers: Offers,
  links: EventLinks,
  lastmod: (cardIds: string[], ids: string[]) => string,
): GeneratedPage {
  const path = eventPath(event)
  const { resolved, groups } = eventGroups(ctx, event)
  const biggest = [...groups].sort((a, b) => b.lines.length - a.lines.length)
  const [main, ...rest] = biggest
  const lead =
    main === undefined
      ? ''
      : main.own || main.categories.length > 1 || main.lines.length === 1
        ? `${capitalize(esc(main.phrase))}, ${bestText(ctx, shown(ctx, main.personal))}.`
        : `${main.lines.length === resolved.length ? `All ${String(resolved.length)}` : `${String(main.lines.length)} of these ${String(resolved.length)}`} ${main.lines.length === 1 ? `counts ${esc(categoryAs(ctx.catalog, main.categories[0] ?? 'other'))}` : `count as ${esc(categoryPurchases(ctx.catalog, main.categories[0] ?? 'other'))}`}, where ${bestText(ctx, shown(ctx, main.personal))}.`
  const others = rest
    .slice(0, 2)
    .map((g) => `${esc(g.phrase)}, ${bestText(ctx, shown(ctx, g.personal))}`)
  const answer = `<p class="answer">${lead}${others.length === 0 ? '' : ` ${capitalize(others.join('; '))}.`}</p>`
  const others2 = LIFE_EVENTS.filter((e) => e.slug !== event.slug).sort(
    (a, b) =>
      Number(event.related?.includes(b.slug) ?? false) -
      Number(event.related?.includes(a.slug) ?? false),
  )
  const pairs = openFirst(ctx.catalog, ctx.today)
  const title = fitTitle(event.titles)
  const description = fitDescription(event.descriptions)
  const travelLink = event.related?.includes('travel')
    ? `<p>For the honeymoon, <a href="${HUB_PATH}/travel">the cards for a big trip</a> also rank car rentals, cruises and cards' travel sites, with points at transfer value.</p>`
    : ''
  const businessLink = event.business
    ? `<p>A bill a business pays, like a practice's malpractice premium, can go on a business card: <a href="${HUB_PATH}#business">business cards' welcome offers</a>.</p>`
    : ''
  const terms = (event.terms ?? []).map((t) => ({
    html: termsSection(ctx, t),
    cards: termsNotes(ctx, t.word).map((n) => n.cardId),
  }))
  const date = lastmod(
    [...cardIdsOf(groups, offers), ...terms.flatMap((t) => t.cards)],
    idsOf(resolved),
  )
  const body = `
      <h1>${esc(event.h1)}</h1>
      <p class="updated">Updated ${esc(ctx.dayWords(date))}</p>
      ${answer}
      <h2 id="codes">Where each purchase codes</h2>
      ${codingTable(ctx, resolved, groups, links)}
      ${terms.map((t) => t.html).join('')}
      ${rankings(ctx, event, groups)}
      ${event.travel ? travelSites(ctx) : ''}
      ${travelLink}
      ${offerPicker(ctx, offers, {
        heading: 'Which welcome offers your budget unlocks',
        lead: 'Tap about how much will go on a new card, and over how many months.',
      })}
      ${businessLink}
      <h2 id="before">Before you pay</h2>
      <ul class="change-notes"><li>${esc(CARD_SURCHARGE_NOTE)}</li><li>${esc(FROM_OPENING)}</li><li>${esc(OFFERS_MAY_DIFFER)}</li></ul>
      ${finePrint(`<p>${esc(OPEN_FIRST_LEAD)}</p>${openFirstList(ctx, pairs)}`, 'Which card to open first')}
      <h2>Other big expenses</h2>
      <ul class="chip-links">${others2.map((e) => `<li><a href="${eventPath(e)}">${esc(e.name)}</a></li>`).join('')}<li><a href="${HUB_PATH}">Every welcome offer</a></li></ul>`
  return {
    file: `welcome-offers/${event.slug}.html`,
    path,
    lastmod: date,
    html: ctx.layout({
      title,
      description,
      path,
      body,
      crumbs: [
        { name: HUB_SHORT, path: HUB_PATH },
        { name: event.name, path },
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
}

// The cards a page shows, for its lastmod: its rankings' and its offers'.
function cardIdsOf(groups: Group[], offers: Offers): string[] {
  const ranked = groups.flatMap((g) =>
    [g.personal, g.transfer, g.business].flatMap((r) =>
      r === null ? [] : r.ranked.slice(0, RANKED).map((e) => e.cardId),
    ),
  )
  return [
    ...new Set([
      ...ranked,
      ...offers.personal.map((o) => o.cardId),
      ...offers.business.map((o) => o.cardId),
    ]),
  ]
}

const idsOf = (resolved: Resolved[]) => [
  ...new Set(
    resolved.flatMap((r) => [r.category, ...r.merchants.map((m) => m.id)]),
  ),
]
