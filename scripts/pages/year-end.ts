// /year-end/ and /year-end/<yyyy>: what on each card ends with the calendar
// year (statement credits whose period closes on December 31, dated rates
// and offers, calendar-year spend bonuses, the last quarter's rotating
// categories and next quarter's) and the calendar-year caps that start over
// on January 1, straight from the card files. Cards saved on earnrate.dev
// come first, chosen in the visitor's browser.
import { periodAmount } from '../../src/engine/credits.ts'
import { creditWhere } from '../../src/engine/rule-text.ts'
import { activationText } from '../../src/engine/text.ts'
import { milestonePays, milestoneWhat } from '../../src/engine/milestones.ts'
import { offerTerms, OFFERS_MAY_DIFFER } from '../../src/engine/offers.ts'
import {
  addDays,
  currentPeriodEnd,
  inEffect,
  periodKey,
} from '../../src/engine/periods.ts'
import {
  capitalize,
  capSentence,
  creditTerms,
  currencyName,
  earnText,
  ENROLL_FIRST,
  inOrder,
  listed,
  longDate,
  hostname,
  money,
  MONTH_NAMES,
  periodPhrase,
  possessive,
  shortDate,
  wholeDollars,
} from '../../src/engine/text.ts'
import type {
  Cap,
  Card,
  Credit,
  Milestone,
  Rule,
} from '../../src/schema/card.ts'
import type { GeneratedPage, PageContext } from './context.ts'
import {
  activationQuotes,
  quarters,
  type Quarter,
  type QuarterCard,
} from './quarterly.ts'
import { cardColor } from '../../src/format/card-art.ts'
import { button, pageActions } from './actions.ts'
import {
  chipLinks,
  esc,
  fitDescription,
  fitSentences,
  fitTitle,
  SITE,
} from './site.ts'

// The first year earnrate published this page. Each later year keeps its own
// address, saying where the current one is.
const FIRST_YEAR = 2026

const PERIOD_ORDER: Credit['period'][] = [
  'calendar_year',
  'half_year',
  'quarter',
]

type CreditItem = { credit: Credit; key: string }
type CapItem = { cap: Cap; rules: Rule[] }
type Ending = {
  offer: boolean
  credits: Credit[]
  rules: Rule[]
  starting: Rule[]
  milestones: Milestone[]
}
type Rotation = {
  card: Card
  last: QuarterCard | null
  next: QuarterCard | null
}

export type YearEnd = {
  year: number
  end: string // "2026-12-31"
  next: string // "2027-01-01"
  // Calendar-year, July-December and fourth-quarter credits: the ones a
  // reader loses for the year.
  credits: { card: Card; items: CreditItem[] }[]
  // December's monthly credits, which end like every month's.
  monthly: { card: Card; items: CreditItem[] }[]
  ending: { card: Card; items: Ending }[]
  milestones: { card: Card; items: Milestone[] }[]
  caps: { card: Card; items: CapItem[] }[]
  rotation: Rotation[]
  lastQuarter: QuarterLabel | null // the year's fourth quarter
  nextQuarter: QuarterLabel | null // the next year's first
}

type QuarterLabel = Omit<Quarter, 'cards'>

const isRotating = (card: Card, rule: Rule) =>
  card.caps.some((c) => c.rotating && c.id === rule.cap)

// Issuer, then personal before business, then name.
function byIssuer(ctx: PageContext) {
  return (a: Card, b: Card) =>
    ctx.issuerName(a.issuer).localeCompare(ctx.issuerName(b.issuer)) ||
    Number(a.business) - Number(b.business) ||
    ctx.shortName(a.id).localeCompare(ctx.shortName(b.id))
}

export function yearEnd(ctx: PageContext, year: number): YearEnd {
  const { catalog, today } = ctx
  const end = `${String(year)}-12-31`
  const next = addDays(end, 1)
  const cards = [...catalog.cards].sort(byIssuer(ctx))
  // Ended before today: nothing left to do about it.
  const upcoming = (date: string | undefined) =>
    date !== undefined && date >= today && date <= end

  const endingCredits = (monthly: boolean) =>
    cards
      .map((card) => ({
        card,
        items: card.credits
          .filter(
            (c) =>
              (c.period === 'month') === monthly &&
              inEffect(c, end) &&
              currentPeriodEnd(c.period, end, null) === end,
          )
          .map((credit) => ({
            credit,
            key: periodKey(credit.period, end, null) ?? '',
          }))
          .sort(
            (a, b) =>
              PERIOD_ORDER.indexOf(a.credit.period) -
                PERIOD_ORDER.indexOf(b.credit.period) ||
              periodAmount(b.credit, b.key) - periodAmount(a.credit, a.key),
          ),
      }))
      .filter((c) => c.items.length > 0)
  const credits = endingCredits(false)
  const monthly = endingCredits(true)

  const ending = cards
    .map((card) => {
      const starts = (date: string | undefined) =>
        date !== undefined && date > today && date <= next
      const items: Ending = {
        offer:
          card.welcome_offer !== undefined &&
          upcoming(card.welcome_offer.valid_to),
        credits: card.credits.filter((c) => upcoming(c.valid_to)),
        rules: card.rules.filter(
          (r) => !isRotating(card, r) && upcoming(r.valid_to),
        ),
        starting: card.rules.filter(
          (r) => !isRotating(card, r) && starts(r.valid_from),
        ),
        milestones: card.milestones.filter((m) => starts(m.valid_from)),
      }
      return { card, items }
    })
    .filter(
      ({ items: i }) => i.offer || i.credits.length > 0 || i.rules.length > 0,
    )

  const milestones = cards
    .map((card) => ({
      card,
      items: card.milestones.filter(
        (m) => m.period === 'calendar_year' && inEffect(m, end),
      ),
    }))
    .filter((c) => c.items.length > 0)

  const caps = cards
    .map((card) => {
      const live = card.rules.filter((r) => inEffect(r, end))
      const shared = card.caps
        .filter((c) => c.period === 'calendar_year')
        .map((cap) => ({ cap, rules: live.filter((r) => r.cap === cap.id) }))
      const inline = live.flatMap((r) =>
        typeof r.cap === 'object' && r.cap.period === 'calendar_year'
          ? [{ cap: r.cap, rules: [r] }]
          : [],
      )
      return {
        card,
        items: [...inline, ...shared].filter((c) => c.rules.length > 0),
      }
    })
    .filter((c) => c.items.length > 0)

  const all = quarters(catalog, today)
  const last = all.find((q) => q.key === `${String(year)}-Q4`) ?? null
  const following = all.find((q) => q.key === `${String(year + 1)}-Q1`) ?? null
  const posted = (qc: QuarterCard) => qc.kind === 'pick' || qc.rules.length > 0
  const rotation: Rotation[] = []
  for (const card of cards) {
    const lastCard = last?.cards.find((qc) => qc.card.id === card.id) ?? null
    const nextCard =
      following?.cards.find((qc) => qc.card.id === card.id) ?? null
    const r = {
      card,
      last: lastCard && posted(lastCard) ? lastCard : null,
      next: nextCard && posted(nextCard) ? nextCard : null,
    }
    if (r.last || r.next) rotation.push(r)
  }
  const label = (q: Quarter | null): QuarterLabel | null =>
    q && {
      key: q.key,
      slug: q.slug,
      label: q.label,
      start: q.start,
      end: q.end,
    }

  return {
    year,
    end,
    next,
    credits,
    monthly,
    ending,
    milestones,
    caps,
    rotation,
    lastQuarter: label(last),
    nextQuarter: label(following),
  }
}

// Each card the page lists, by the anchor of its first entry.
function anchors(y: YearEnd): Map<string, string> {
  const found = new Map<string, string>()
  for (const [section, list] of sections(y))
    for (const { card } of list)
      if (!found.has(card.id)) found.set(card.id, `${section}-${card.id}`)
  return found
}

// The cards with anything on the year's page; each gets a page of its own.
function listedCards(ctx: PageContext, y: YearEnd): Card[] {
  const ids = anchors(y)
  return ctx.catalog.cards.filter((c) => ids.has(c.id)).sort(byIssuer(ctx))
}

// One card's part of the year's page.
function only(y: YearEnd, id: string): YearEnd {
  const mine = <T extends { card: Card }>(list: T[]) =>
    list.filter((c) => c.card.id === id)
  return {
    ...y,
    credits: mine(y.credits),
    monthly: mine(y.monthly),
    ending: mine(y.ending),
    milestones: mine(y.milestones),
    caps: mine(y.caps),
    rotation: mine(y.rotation),
  }
}

const cardPath = (y: YearEnd, id: string) => `/year-end/${String(y.year)}/${id}`

const cardName = (ctx: PageContext, card: Card) =>
  card.short_name ?? ctx.shortName(card.id)

// The card in "the …", read as a card: a store card's short name is the
// store's, so it goes by its full name ("the Nordstrom Credit Card").
const theCard = (ctx: PageContext, card: Card) =>
  `the ${card.only_at ? card.name : cardName(ctx, card)}`

const sections = (y: YearEnd): [string, { card: Card }[]][] => [
  ['credits', y.credits],
  ['ending', y.ending],
  ['spend', y.milestones],
  ['monthly', y.monthly],
  ['rotating', y.rotation],
  ['caps', y.caps],
]

const plural = (n: number, one: string, many = `${one}s`) =>
  `${String(n)} ${n === 1 ? one : many}`

// Every credit of one card's that ends with the year, December's monthly
// ones included, each once: the count its page leads with.
function creditList(one: YearEnd): Credit[] {
  const all = [
    ...[...one.credits, ...one.monthly].flatMap((c) =>
      c.items.map((i) => i.credit),
    ),
    ...one.ending.flatMap((e) => e.items.credits),
  ]
  return [...new Map(all.map((c) => [c.id, c])).values()]
}

// What a card's page leads with, in this order: credits when one is for
// the year, half-year or quarter (December's monthly ones then count too),
// dated rates and offers, spend bonuses, December's monthly credits on
// their own, rotating categories, caps.
type Lead = 'credits' | 'ending' | 'spend' | 'monthly' | 'rotation' | 'caps'

function leadOf(one: YearEnd): Lead {
  const credits = creditList(one)
  if (credits.some((c) => c.period !== 'month')) return 'credits'
  if (one.ending.some((e) => e.items.offer || e.items.rules.length > 0))
    return 'ending'
  if (one.milestones.length > 0) return 'spend'
  if (credits.length > 0) return 'monthly'
  return one.rotation.length > 0 ? 'rotation' : 'caps'
}

const dayOf = (date: string) => shortDate(date).replace(/, \d{4}$/, '')

// "by " when something on the list ends before December 31.
const byWord = (one: YearEnd, dates: (string | undefined)[]) =>
  dates.some((d) => d !== undefined && d < one.end) ? 'by ' : ''

// What a spend bonus pays, when that's short enough to say in a sentence;
// a long list of rewards stays in the page's own list.
function shortPays(m: Milestone): string | null {
  const pays = milestonePays(m)
  return pays.length <= 60 && !pays.includes(':') ? pays : null
}

// A credit's dollars for its period that ends with the year.
const atYearEnd = (one: YearEnd, c: Credit) =>
  periodAmount(c, periodKey(c.period, one.end, null))

const creditTotal = (one: YearEnd, credits: Credit[]) =>
  money(credits.reduce((sum, c) => sum + atYearEnd(one, c), 0))

// What one card's page leads with, without the card's name: wordings for
// the title, longest first, and the line on its preview image.
function headline(one: YearEnd): { lead: string[]; line: string } {
  const end = shortDate(one.end)
  const day = dayOf(one.end)
  const lead = leadOf(one)
  const ending = one.ending[0]?.items
  const spends = one.milestones.flatMap((c) => c.items)
  if (lead === 'credits' || lead === 'monthly') {
    const credits = creditList(one)
    const n = credits.length
    const by = byWord(
      one,
      credits.map((c) => c.valid_to),
    )
    const verb = n === 1 ? 'ends' : 'end'
    const what =
      lead === 'credits'
        ? [plural(n, 'credit')]
        : n === 1
          ? ["December's monthly credit", plural(n, 'monthly credit')]
          : [
              `December's ${String(n)} monthly credits`,
              plural(n, 'monthly credit'),
            ]
    return {
      lead: what.flatMap((w) => [
        `${w} that ${verb} ${by}${end}`,
        `${w} ${verb} ${by}${end}`,
        `${w} ${verb} ${by}${day}`,
      ]),
      line: `${capitalize(what[0] ?? '')} ${verb} ${by}${day}, worth up to ${creditTotal(one, credits)}`,
    }
  }
  if (lead === 'ending' && ending) {
    const { offer, rules } = ending
    const to = one.ending[0]?.card.welcome_offer?.valid_to ?? one.end
    if (rules.length === 0) {
      const what = `public welcome offer ends ${shortDate(to)}`
      return {
        lead: [what, `welcome offer ends ${shortDate(to)}`],
        line: capitalize(what),
      }
    }
    const by = byWord(
      one,
      rules.map((r) => r.valid_to),
    )
    const what = `${plural(rules.length, 'rate')}${offer ? ' and its welcome offer' : ''}`
    const verb = rules.length === 1 && !offer ? 'ends' : 'end'
    return {
      lead: [
        `${what} that ${verb} ${by}${end}`,
        `${what} ${verb} ${by}${end}`,
        `${what} ${verb} ${by}${day}`,
      ],
      line: `${capitalize(what)} ${verb} ${by}${day}`,
    }
  }
  const [spend] = spends
  if (lead === 'spend' && spend) {
    if (spends.length === 1) {
      const amount = wholeDollars(spend.spend)
      return {
        lead: [
          `spend ${amount} by ${end} for its bonus`,
          `spend ${amount} by ${day} for its bonus`,
          `${amount} spend bonus closes ${day}`,
        ],
        line: `Spend ${amount} on it by ${day} for ${shortPays(spend) ?? 'its bonus'}`,
      }
    }
    const what = `${String(spends.length)} spend bonuses`
    return {
      lead: [
        `${what} that close ${end}`,
        `${what} close ${end}`,
        `${what} close ${day}`,
      ],
      line: `${capitalize(what)} close ${day}`,
    }
  }
  const rotation = one.rotation[0]
  if (lead === 'rotation' && rotation) {
    const pick =
      rotation.last?.kind === 'pick' || rotation.next?.kind === 'pick'
    const last = rotation.last ? one.lastQuarter : null
    const next = rotation.next ? one.nextQuarter : null
    if (last) {
      const what = pick
        ? `${last.label} category picks`
        : `${last.label} bonus categories`
      return {
        lead: [`${what} end ${day}`],
        line: `${what} end ${day}${next && !pick ? `; ${next.label}'s are posted` : ''}`,
      }
    }
    if (next) {
      const what = `${next.label} bonus categories`
      return {
        lead: [`${what} start ${dayOf(next.start)}`, what],
        line: `${what} start ${dayOf(next.start)}`,
      }
    }
  }
  const caps = count(one.caps)
  const what =
    caps === 1
      ? `bonus cap starts over ${shortDate(one.next)}`
      : `${String(caps)} bonus caps start over ${shortDate(one.next)}`
  return { lead: [what], line: capitalize(what) }
}

function cardTitle(ctx: PageContext, one: YearEnd, card: Card): string {
  const name = cardName(ctx, card)
  return fitTitle(headline(one).lead.map((l) => `${name}: ${l}`))
}

const PERIOD_WORDS: Partial<Record<Credit['period'], string>> = {
  calendar_year: 'yearly',
  half_year: 'half-year',
  quarter: 'quarterly',
}

// One card's page in a few sentences, led by what its title says; each is
// a list of wordings, longest first, for the description to fit.
function cardSummary(ctx: PageContext, one: YearEnd, card: Card): string[][] {
  const lead = leadOf(one)
  const said: Partial<Record<Lead, string[][]>> = {}
  // The first sentence gives the year; the rest say only the day.
  const date = (iso: string, first: boolean) =>
    first ? shortDate(iso) : dayOf(iso)

  const credits = creditList(one)
  const n = credits.length
  if (n > 0) {
    const first = lead === 'credits' || lead === 'monthly'
    const by = byWord(
      one,
      credits.map((c) => c.valid_to),
    )
    const end = `${by}${date(one.end, first)}`
    const named = theCard(ctx, card)
    const [single] = credits
    const lines: string[][] = [
      n === 1 && single
        ? [
            `One credit on ${named} ends ${end}: ${money(atYearEnd(one, single))} back ${creditWhere(ctx.catalog, single)}.`,
            `One credit on ${named} ends ${end}, worth up to ${money(atYearEnd(one, single))}.`,
          ]
        : [
            `${String(n)} credits on ${named} end ${end}, worth up to ${creditTotal(one, credits)} together.`,
            `${String(n)} credits on ${named} end ${by}${dayOf(one.end)}, worth up to ${creditTotal(one, credits)}.`,
          ],
    ]
    const periodic = count(one.credits)
    const monthly = count(one.monthly)
    const months =
      monthly === 1
        ? "December's monthly credit, which ends"
        : "December's monthly credits, which end"
    if (periodic > 0 && monthly > 0) {
      const kinds = listed(
        [
          ...new Set(
            one.credits.flatMap((c) =>
              c.items.map((i) => PERIOD_WORDS[i.credit.period] ?? ''),
            ),
          ),
        ],
        'or',
      )
      lines.push([
        `${periodic === 1 ? `One is a ${kinds} credit` : `${String(periodic)} are ${kinds} credits`}, and ${monthly === 1 ? 'one is' : `${String(monthly)} are`} ${months} like every month's.`,
      ])
    } else if (monthly > 0)
      lines.push([
        `${monthly === 1 ? "It's" : "They're"} ${months} like every month's.`,
      ])
    said[first ? lead : 'credits'] = lines
  }

  const ending = one.ending[0]?.items
  if (ending) {
    const first = lead === 'ending'
    const offer = one.ending[0]?.card.welcome_offer?.valid_to
    const lines: string[][] = []
    if (ending.rules.length > 0) {
      const r = ending.rules.length
      const by = byWord(
        one,
        ending.rules.map((x) => x.valid_to),
      )
      lines.push([
        `${r === 1 ? 'One of its rates ends' : `${String(r)} of its rates end`} ${by}${date(one.end, first)}.`,
      ])
    }
    if (ending.offer && offer)
      lines.push([
        `Its public welcome offer ends ${date(offer, first && lines.length === 0)}.`,
      ])
    if (lines.length > 0) said.ending = lines
  }

  const spends = one.milestones.flatMap((c) => c.items)
  const [spend] = spends
  if (spend) {
    const through = `through ${date(one.end, lead === 'spend')}`
    const amount = wholeDollars(spend.spend)
    const pays = shortPays(spend)
    said.spend = [
      spends.length === 1
        ? [
            ...(pays
              ? [
                  `Its ${amount} spend bonus, for ${pays}, counts purchases on the card ${through}.`,
                ]
              : []),
            `Its ${amount} spend bonus counts purchases on the card ${through}.`,
          ]
        : [
            `Its ${String(spends.length)} spend bonuses count purchases on the card ${through}.`,
          ],
    ]
  }

  const rotation = one.rotation[0]
  if (rotation) {
    const first = lead === 'rotation'
    const pick =
      rotation.last?.kind === 'pick' || rotation.next?.kind === 'pick'
    const last = rotation.last ? one.lastQuarter : null
    const next = rotation.next ? one.nextQuarter : null
    const parts = pick
      ? [
          last
            ? `its category picks for ${last.label} apply through ${date(one.end, false)}`
            : '',
        ]
      : [
          last
            ? `its ${last.label} bonus categories end ${date(one.end, false)}`
            : '',
          next
            ? `${last ? `${next.label}'s` : `its ${next.label} bonus categories`} start ${date(next.start, first)}`
            : '',
        ]
    const kept = parts.filter((p) => p !== '')
    if (kept.length > 0)
      said.rotation = [[`${capitalize(kept.join(', and '))}.`]]
  }

  const caps = one.caps.flatMap((c) => c.items)
  const [cap] = caps
  const capCard = one.caps[0]?.card
  if (cap && capCard) {
    const lines = [
      [
        `On ${date(one.next, lead === 'caps')}, its calendar-year ${caps.length === 1 ? 'cap starts' : 'caps start'} over.`,
      ],
    ]
    // On a page with nothing else, the cap itself.
    const [rule] = cap.rules
    if (lead === 'caps' && caps.length === 1 && cap.rules.length === 1 && rule)
      lines.push([
        `${capitalize(ctx.ruleWhat(capCard, rule))}: ${earnText(ctx.catalog, rule.rate, capCard.currency)}. ${capSentence(cap.cap, earnText(ctx.catalog, cap.cap.then_rate, capCard.currency))}.`,
      ])
    said.caps = lines
  }

  const order: Lead[] = [
    lead,
    ...(['credits', 'monthly', 'ending', 'spend', 'rotation', 'caps'] as const),
  ]
  return [...new Set(order)].flatMap((k) => said[k] ?? [])
}

// The card pages' line linking to the card's own year-end page. `credits`
// says it lists the card's credits, so the line can go with them.
export function yearEndLinks(
  ctx: PageContext,
): Map<string, { html: string; credits: boolean }> {
  const y = yearEnd(ctx, Number(ctx.today.slice(0, 4)))
  return new Map(
    listedCards(ctx, y).map((card) => {
      const one = only(y, card.id)
      const [lead = ''] = headline(one).lead
      return [
        card.id,
        {
          html: `<p>${esc(`What on this card ends or starts over when ${String(y.year)} does:`)} <a href="${cardPath(y, card.id)}">${esc(lead)}</a>.</p>`,
          credits: creditList(one).length > 0,
        },
      ]
    }),
  )
}

// How the page is drawn: the year's page, or one card's (whose blocks skip
// the card's name and art, already at the top).
type View = {
  ctx: PageContext
  y: YearEnd
  one: Card | null
  titles: Map<string, string> // each card's own page title, for sending
}

// Shown only once the page's script runs: it shares the card's page with the
// system share sheet where there is one, and otherwise copies its address.
function sendRow(y: YearEnd, card: Card, title: string): string {
  const url = `${SITE}${cardPath(y, card.id)}`
  return `<p class="ye-send-row" data-send hidden><button type="button" class="ye-send" data-url="${esc(url)}" data-title="${esc(title.replace(/ \| earnrate$/, ''))}">Send this card's list</button><input class="ye-address" readonly hidden aria-label="${esc(`Address of the ${title.replace(/:.*/, '')} list`)}" value="${esc(url)}" /></p>`
}

function cardBlock(
  v: View,
  section: string,
  card: Card,
  inner: string,
): string {
  if (v.one)
    return `<section class="ye-card ye-one" data-anchor="${section}-${esc(card.id)}">${inner}</section>`
  return `<section class="ye-card" data-card="${esc(card.id)}" data-anchor="${section}-${esc(card.id)}"><div class="card-head small">${v.ctx.art(card.id, 64)}<h3><a href="/cards/${card.id}">${esc(card.name)}</a></h3><span class="ye-mark">Your card</span></div>${inner}${sendRow(v.y, card, v.titles.get(card.id) ?? '')}</section>`
}

// `prefer`: words the quote should name when one does (a month with its own
// amount).
const firstQuote = (
  ctx: PageContext,
  card: Card,
  id: string,
  prefer?: string,
) => {
  const quotes = ctx.quotesFor(card, id)
  const q =
    (prefer === undefined
      ? undefined
      : quotes.find((e) => e.quote.includes(prefer))) ?? quotes[0]
  return q ? `<p class="muted ye-quote">${ctx.quoteHtml(q)}</p>` : ''
}

const noteHtml = (note: string | undefined) =>
  note ? `<span class="muted row-note">${esc(note)}</span>` : ''

function creditItem(ctx: PageContext, card: Card, item: CreditItem): string {
  const { credit } = item
  const what = `${money(periodAmount(credit, item.key))} back ${creditWhere(ctx.catalog, credit)}`
  const min = creditTerms({ min_amount: credit.min_amount })
  const enroll = credit.enroll
    ? ` ${capitalize(ENROLL_FIRST)} with ${ctx.issuerName(card.issuer)}.`
    : ''
  return `<li><p><strong>${esc(what)}</strong> ${esc(periodPhrase(credit.period, item.key))}${esc(min)}.${esc(enroll)}</p>${noteHtml(credit.note)}${firstQuote(ctx, card, credit.id, periodAmount(credit, item.key) === credit.amount ? undefined : MONTH_NAMES[Number(item.key.slice(5, 7)) - 1])}</li>`
}

const creditBlocks = (v: View, section: string, list: YearEnd['credits']) =>
  `<div class="ye-cards" data-ye-list>${list
    .map(({ card, items }) =>
      cardBlock(
        v,
        section,
        card,
        `<ul class="ye-items">${items.map((i) => creditItem(v.ctx, card, i)).join('')}</ul>`,
      ),
    )
    .join('')}</div>`

const count = (list: { items: unknown[] }[]) =>
  list.reduce((n, c) => n + c.items.length, 0)

function creditsSection(v: View): string {
  const { y } = v
  if (y.credits.length === 0) return ''
  const monthly =
    y.monthly.length > 0
      ? "; December's monthly credits are further down."
      : '.'
  return `<h2 id="credits">Yearly, half-year and quarterly credits that end ${esc(shortDate(y.end))}</h2>
      <p>${esc(`Each of these is for the calendar year, July through December or the fourth quarter, all ending ${longDate(y.end)}. What's left of each then ends, and the next period's starts ${shortDate(y.next)}. Credits that run by cardmember year, from the account anniversary, aren't listed${monthly}`)}</p>
      ${creditBlocks(v, 'credits', y.credits)}`
}

// Collapsed on the year's page: December's credit ends like any month's,
// and the list would bury the deadlines above it.
function monthlySection(v: View): string {
  const { y } = v
  if (y.monthly.length === 0) return ''
  const n = count(y.monthly)
  const intro = `<h2 id="monthly">Monthly credits</h2>
      <p>${esc(`These reset every month. December's ends on ${shortDate(y.end)} like any other month's, and January's starts ${shortDate(y.next)}.`)}</p>`
  if (v.one) return `${intro}${creditBlocks(v, 'monthly', y.monthly)}`
  return `${intro}
      <details class="ye-monthly"><summary>${esc(`December's ${plural(n, 'monthly credit')} on ${plural(y.monthly.length, 'card')}`)}</summary>
      ${creditBlocks(v, 'monthly', y.monthly)}</details>`
}

const ruleLine = (ctx: PageContext, card: Card, rule: Rule) =>
  `<strong>${esc(ctx.ruleWhat(card, rule))}</strong>: ${esc(earnText(ctx.catalog, rule.rate, card.currency))}`

function endingSection(v: View): string {
  const { ctx, y } = v
  if (y.ending.length === 0) return ''
  const blocks = y.ending.map(({ card, items }) => {
    const lines: string[] = []
    const o = card.welcome_offer
    if (items.offer && o?.valid_to)
      lines.push(
        `<li><p><strong>Public welcome offer:</strong> ${esc(offerTerms(o, currencyName(ctx.catalog, card.currency)))}, through ${esc(shortDate(o.valid_to))}. ${esc(OFFERS_MAY_DIFFER)}</p>${noteHtml(o.note)}${firstQuote(ctx, card, 'welcome_offer')}</li>`,
      )
    for (const c of items.credits)
      lines.push(
        `<li><p><strong>${esc(`${money(c.amount)} back ${creditWhere(ctx.catalog, c)}`)}</strong>${esc(creditTerms(c))}.</p>${noteHtml(c.note)}${firstQuote(ctx, card, c.id)}</li>`,
      )
    for (const r of items.rules)
      lines.push(
        `<li><p>${ruleLine(ctx, card, r)}, through ${esc(shortDate(r.valid_to ?? ''))}.</p>${noteHtml(r.note)}${firstQuote(ctx, card, r.id)}</li>`,
      )
    for (const r of items.starting)
      lines.push(
        `<li><p>From ${esc(shortDate(r.valid_from ?? ''))}: ${ruleLine(ctx, card, r)}.</p>${noteHtml(r.note)}</li>`,
      )
    for (const m of items.milestones)
      lines.push(
        `<li><p>From ${esc(shortDate(m.valid_from ?? ''))}: ${esc(milestoneWhat(m))}.</p>${noteHtml(m.note)}${firstQuote(ctx, card, m.id)}</li>`,
      )
    return cardBlock(
      v,
      'ending',
      card,
      `<ul class="ye-items">${lines.join('')}</ul>`,
    )
  })
  return `<h2 id="ending">Rates and offers that end by ${esc(shortDate(y.end))}</h2>
      <p>${esc(`Each has an end date of its own in the issuer's terms. Where a card's terms say what takes over on ${shortDate(y.next)}, that's listed with it.`)}</p>
      <div class="ye-cards" data-ye-list>${blocks.join('')}</div>`
}

function milestonesSection(v: View): string {
  const { y } = v
  if (y.milestones.length === 0) return ''
  const yearText = String(y.year)
  const blocks = y.milestones.map(({ card, items }) =>
    cardBlock(
      v,
      'spend',
      card,
      `<ul class="ye-items">${items
        .map((m) => {
          const from =
            m.valid_from !== undefined && m.valid_from > `${yearText}-01-01`
              ? ` Spending from ${shortDate(m.valid_from)} counts.`
              : ''
          return `<li><p><strong>${esc(`${wholeDollars(m.spend)} on the card in ${yearText}`)}</strong> ${esc(`for ${milestonePays(m)}.${from}`)}</p>${noteHtml(m.note)}${firstQuote(v.ctx, card, m.id)}</li>`
        })
        .join('')}</ul>`,
    ),
  )
  return `<h2 id="spend">Spend bonuses counted by calendar year</h2>
      <p>${esc(`Each counts purchases on the card from Jan 1 to ${shortDate(y.end)}, so the total has to be reached by then. Spending toward it starts again from zero on ${shortDate(y.next)}.`)}</p>
      <div class="ye-cards" data-ye-list>${blocks.join('')}</div>`
}

function quarterPart(
  ctx: PageContext,
  qc: QuarterCard,
  q: QuarterLabel,
): string {
  if (qc.kind === 'pick') return ''
  const { card } = qc
  const issuer = ctx.issuerName(card.issuer)
  const head = `<p class="ye-quarter"><strong>${esc(q.label)}</strong> · ${esc(`${shortDate(q.start)} to ${shortDate(q.end)}`)}</p>`
  const link = `<p><a href="/quarterly/${q.slug}">${esc(q.label)} in full</a></p>`
  const needs = qc.rules.some((r) => r.requires?.activation === true)
  const activation = needs
    ? activationText(issuer, qc.rules, ctx.today)
    : 'No activation needed.'
  const rules = [...qc.rules]
    .sort((a, b) => b.rate - a.rate)
    .map((r) => `<li><p>${ruleLine(ctx, card, r)}</p>${noteHtml(r.note)}</li>`)
  const quotes = activationQuotes(card, qc.rules)
  return `${head}<p>${esc(`${capSentence(qc.cap, earnText(ctx.catalog, qc.cap.then_rate, card.currency), 'combined purchases in these categories')}. ${activation}`)}</p><ul class="ye-items">${rules.join('')}</ul>${quotes.map((e) => `<p class="muted ye-quote">${ctx.quoteHtml(e)}</p>`).join('')}${link}`
}

// Categories the cardholder picks each quarter (Cash+): the picks run out
// with the quarter.
function picksPart(ctx: PageContext, card: Card, y: YearEnd): string {
  const unpicked = card.choices.some(
    (c) => c.period === 'quarter' && !c.default,
  )
    ? ` Until you pick, they earn its base rate of ${earnText(ctx.catalog, card.base_rate, card.currency)}.`
    : ''
  const last = y.lastQuarter
  const next = y.nextQuarter
  const again = next ? ` for ${next.label}` : ' each quarter'
  return `<p>${esc(`${last ? `Its picks for ${last.label} apply through ${shortDate(last.end)}, and you` : 'You'} choose again${again}.${unpicked}`)}</p>${next ? `<p><a href="/quarterly/${next.slug}">${esc(next.label)} in full</a></p>` : ''}`
}

function rotationSection(v: View): string {
  const { ctx, y } = v
  if (y.rotation.length === 0) return ''
  const blocks = y.rotation.map(({ card, last, next }) =>
    cardBlock(
      v,
      'rotating',
      card,
      last?.kind === 'pick' || next?.kind === 'pick'
        ? picksPart(ctx, card, y)
        : [
            last && y.lastQuarter ? quarterPart(ctx, last, y.lastQuarter) : '',
            next && y.nextQuarter ? quarterPart(ctx, next, y.nextQuarter) : '',
          ].join(''),
    ),
  )
  const quartersNamed = listed([
    ...(y.lastQuarter && y.rotation.some((r) => r.last)
      ? [y.lastQuarter.label]
      : []),
    ...(y.nextQuarter && y.rotation.some((r) => r.next)
      ? [y.nextQuarter.label]
      : []),
  ])
  const intro = v.one
    ? `Its bonus categories change each quarter; these are the ones for ${quartersNamed}, as ${ctx.issuerName(v.one.issuer)} has posted them.`
    : `The cards whose bonus categories change each quarter, for ${quartersNamed} as each issuer has posted them. A quarter an issuer hasn't posted yet isn't listed.`
  return `<h2 id="rotating">Rotating categories</h2>
      <p>${esc(intro)}</p>
      <div class="ye-cards" data-ye-list>${blocks.join('')}</div>`
}

function capsSection(v: View): string {
  const { ctx, y } = v
  if (y.caps.length === 0) return ''
  const blocks = y.caps.map(({ card, items }) =>
    cardBlock(
      v,
      'caps',
      card,
      `<ul class="ye-items">${items
        .map(({ cap, rules }) => {
          const then = earnText(ctx.catalog, cap.then_rate, card.currency)
          const sentence =
            rules.length > 1
              ? capSentence(cap, then, 'combined purchases in these categories')
              : capSentence(cap, then)
          const lines = [...new Set(rules.map((r) => ruleLine(ctx, card, r)))]
          return `<li>${lines.map((l) => `<p>${l}</p>`).join('')}<span class="muted row-note">${esc(`${sentence}.`)}</span></li>`
        })
        .join('')}</ul>`,
    ),
  )
  return `<h2 id="caps">Caps that start over on ${esc(shortDate(y.next))}</h2>
      <p>${esc(`These bonus rates have a calendar-year spending cap. Spending toward each starts again from zero on ${shortDate(y.next)}, so a cap you've used up this year earns the bonus rate again from then.`)}</p>
      <div class="ye-cards" data-ye-list>${blocks.join('')}</div>`
}

const allSections = (v: View) =>
  [
    creditsSection(v),
    endingSection(v),
    milestonesSection(v),
    monthlySection(v),
    rotationSection(v),
    capsSection(v),
  ].join('\n      ')

// Runs where it sits, after the lists and after the send script has shown
// its rows: cards saved in this browser move to the top of each list, and
// only then, with the page laid out, a link to a card's block (#credits-
// <card>, its data-anchor) scrolls there, opening the collapsed monthly list
// if it's in it. It only reads the wallet earnrate.dev saved; nothing is sent.
const WALLET_SCRIPT = `(() => {
  const reveal = () => {
    const name = decodeURIComponent(location.hash.slice(1))
    if (!name || document.getElementById(name)) return
    const target = [...document.querySelectorAll('[data-anchor]')].find(
      (el) => el.dataset.anchor === name,
    )
    if (!target) return
    const box = target.closest('details')
    if (box && !box.open) {
      // Opened at once, not animated, so the page is its full height to
      // scroll in; its content is shown the frame after the toggle.
      box.dataset.jump = ''
      box.addEventListener(
        'toggle',
        () => requestAnimationFrame(() => target.scrollIntoView()),
        { once: true },
      )
      box.open = true
      return
    }
    target.scrollIntoView()
  }
  const arrange = () => {
  let held = []
  try {
    const w = JSON.parse(localStorage.getItem('earnrate:wallet'))
    if (w && Array.isArray(w.cards)) held = w.cards.map((c) => c.id)
  } catch {}
  if (held.length === 0) return
  const mine = (el) => held.includes(el.dataset.card)
  for (const list of document.querySelectorAll('[data-ye-list]')) {
    const blocks = [...list.children].filter(mine)
    for (const b of blocks) b.dataset.held = ''
    for (const b of [...blocks].reverse()) list.prepend(b)
  }
  const box = document.querySelector('[data-ye-yours]')
  if (!box) return
  const chips = [...document.querySelectorAll('[data-ye-pages] > li')].filter(mine)
  const list = box.querySelector('ul')
  for (const c of chips) list.append(c.cloneNode(true))
  box.querySelector(chips.length > 0 ? '[data-some]' : '[data-none]').hidden = false
  if (chips.length === 0) list.hidden = true
  box.hidden = false
  }
  arrange()
  reveal()
  addEventListener('hashchange', reveal)
})()`

// The send buttons: the system share sheet with the page's address and
// title where the browser has one, otherwise the address copied, or shown
// to copy by hand. Using it is counted once per page load like the app's
// events (site/app/track.ts): the event's name only, never the card.
const SEND_SCRIPT = `(() => {
  for (const row of document.querySelectorAll('[data-send]')) row.hidden = false
  let counted = false
  const count = () => {
    if (counted) return
    counted = true
    try {
      navigator.sendBeacon('/count', 'year-end-share')
    } catch {}
  }
  const flash = (button, text) => {
    button.dataset.label ??= button.textContent
    button.textContent = text
    clearTimeout(button.timer)
    button.timer = setTimeout(() => {
      button.textContent = button.dataset.label
    }, 1500)
  }
  const show = (button) => {
    const field = button.parentElement.querySelector('.ye-address')
    field.hidden = false
    field.select()
  }
  const copy = (button) => {
    const url = button.dataset.url
    if (!navigator.clipboard) return show(button)
    navigator.clipboard.writeText(url).then(() => {
      count()
      flash(button, 'Link copied')
    }, () => show(button))
  }
  document.addEventListener('click', (e) => {
    const button = e.target instanceof Element && e.target.closest('.ye-send')
    if (!button) return
    const { url, title } = button.dataset
    if (!navigator.share) return copy(button)
    navigator.share({ url, title }).then(count, (err) => {
      if (err && err.name !== 'AbortError') copy(button)
    })
  })
})()`

function summary(y: YearEnd): string {
  const credits = count(y.credits)
  const milestones = count(y.milestones)
  const monthly = count(y.monthly)
  const parts = [
    credits > 0
      ? `${String(credits)} yearly, half-year and quarterly statement credits on ${String(y.credits.length)} cards end`
      : '',
    milestones > 0
      ? `${String(milestones)} spend bonuses on ${String(y.milestones.length)} cards close their year`
      : '',
    y.ending.length > 0
      ? `rates or offers on ${String(y.ending.length)} cards reach their end date`
      : '',
  ].filter((p) => p !== '')
  const months =
    monthly > 0
      ? ` December's ${String(monthly)} monthly credits on ${String(y.monthly.length)} cards end that day too, as every month's do.`
      : ''
  const caps =
    y.caps.length > 0
      ? ` On ${shortDate(y.next)}, the calendar-year caps on ${String(y.caps.length)} cards start over.`
      : ''
  return parts.length === 0
    ? `${months}${caps}`.trim()
    : `By ${shortDate(y.end)}, ${inOrder(parts)}.${months}${caps}`
}

function titleFor(y: YearEnd, hub: boolean): string {
  const year = String(y.year)
  return hub
    ? fitTitle([
        `Credit card credits that expire December 31, ${year}`,
        `Card credits that expire Dec 31, ${year}`,
      ])
    : fitTitle([
        `Use it or lose it: card credits that end Dec 31, ${year}`,
        `Card credits that expire Dec 31, ${year}`,
      ])
}

function descriptionFor(y: YearEnd): string {
  const credits = String(count(y.credits))
  const monthly = String(count(y.monthly))
  const cards = String(y.credits.length)
  const date = shortDate(y.end)
  return fitDescription([
    `Use it or lose it: ${credits} yearly, half-year and quarterly credits on ${cards} cards end ${date}, plus ${monthly} monthly credits, spend bonuses, caps and activations.`,
    `Use it or lose it: ${credits} yearly, half-year and quarterly credits on ${cards} cards end ${date}. Plus ${monthly} monthly credits, spend bonuses, caps and activation dates.`,
    `Use it or lose it: ${credits} yearly and quarterly credits on ${cards} cards end ${date}. Plus ${monthly} monthly credits, spend bonuses, caps and activation dates.`,
    `Use it or lose it: ${credits} statement credits on ${cards} cards end ${date}, plus ${monthly} monthly credits, spend bonuses, caps and activation dates.`,
    `Credit card statement credits that expire ${date}, with amounts, enrollment and issuer terms.`,
  ])
}

function jumpList(y: YearEnd, ctx: PageContext): string {
  const items = [...anchors(y)].flatMap(([id, anchor]) => {
    const card = ctx.catalog.cards.find((c) => c.id === id)
    return card
      ? [
          `<li data-card="${esc(id)}"><a href="#${esc(anchor)}">${esc(cardName(ctx, card))}</a></li>`,
        ]
      : []
  })
  return `<details class="ye-jump"><summary>${esc(`Jump to a card (${String(items.length)})`)}</summary><ul class="chip-links" data-ye-jump>${items.join('')}</ul></details>`
}

// Every card's own page, to send to someone who has that card.
function cardPagesList(v: View): string {
  const cards = listedCards(v.ctx, v.y)
  return `<h2 id="by-card">A page for each card</h2>
      <p>${esc(`Each of these ${String(cards.length)} cards has its own page with only its part of this list, to send to someone who has the card.`)}</p>
      <ul class="chip-links" data-ye-pages>${cards
        .map(
          (c) =>
            `<li data-card="${esc(c.id)}"><a href="${cardPath(v.y, c.id)}">${esc(cardName(v.ctx, c))}</a></li>`,
        )
        .join('')}</ul>`
}

// What the lists leave out, the kinds of credit docs/feature-gaps.md says
// aren't entered: said before the lists, so a count never reads as every
// credit a card has.
const SCOPE =
  "This page lists statement credits at named stores and services. It leaves out a credit for a merchant you choose first, like an airline fee credit; a credit on only some of a merchant's sales, like hotel collection bookings; and a credit paid only after a spending total."

// The card's own page at its issuer: its first source that isn't a terms,
// fees, FAQ or disclosure page.
export function issuerPage(card: Card): string {
  const main = card.source_urls.find(
    (u) =>
      !/terms|pricing|disclosure|faq|rewards-info|learnmore|education|benefit|calendar|\.pdf/i.test(
        u,
      ),
  )
  return main ?? card.source_urls[0] ?? ''
}

// The issuer's page when the address carries the issuer's name or a word
// people search it by; otherwise the site it's on (a store's or a partner's).
function pageName(ctx: PageContext, card: Card, url: string): string {
  const issuer = ctx.catalog.issuers.find((i) => i.id === card.issuer)
  const flat = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
  const host = hostname(url)
  const words = issuer ? [issuer.id, issuer.name, ...issuer.search] : []
  const theirs = words
    .map(flat)
    .some((w) => w.length >= 3 && flat(host).includes(w))
  return theirs
    ? `${possessive(ctx.issuerName(card.issuer))} page for ${theCard(ctx, card)}`
    : `${possessive(theCard(ctx, card))} page on ${host}`
}

function scopeHtml(ctx: PageContext, card: Card | null): string {
  const url = card === null ? '' : issuerPage(card)
  const check =
    card === null
      ? ''
      : ` For anything else, check <a class="ye-issuer" href="${esc(url)}" rel="nofollow noopener">${esc(pageName(ctx, card, url))}</a>.`
  return `<p class="ye-scope">${esc(SCOPE)}${check}</p>`
}

const SOURCE_LINE = `<p class="muted">Every amount, date, cap and quote here is from the card's file in earnrate, checked against the issuer's pages on the date each card page shows. Check the issuer's terms before you rely on them.</p>`

function renderYear(
  ctx: PageContext,
  y: YearEnd,
  hub: boolean,
  earlier: number[],
  updated: string,
): { title: string; description: string; body: string } {
  const title = titleFor(y, hub)
  const description = descriptionFor(y)
  const h1 = title.replace(/ \| earnrate$/, '')
  const year = String(y.year)
  const v: View = {
    ctx,
    y,
    one: null,
    titles: new Map(
      listedCards(ctx, y).map((c) => [c.id, cardTitle(ctx, only(y, c.id), c)]),
    ),
  }
  const nav =
    earlier.length === 0
      ? ''
      : `<h2>Earlier years</h2>${chipLinks(earlier.map((e) => `<a href="/year-end/${String(e)}">${String(e)}</a>`))}`
  const quarterly =
    y.rotation.length > 0
      ? ''
      : `<p>Rotating categories quarter by quarter: <a href="/quarterly/">this quarter's bonus categories</a>.</p>`
  const body = `
      <h1>${esc(h1)}</h1>
      <p class="updated">${esc(`Through ${shortDate(y.end)} · Updated ${ctx.dayWords(updated)}`)}</p>
      <p class="answer">${esc(summary(y))}</p>
      ${scopeHtml(ctx, null)}
      ${hub ? `<p>This page always shows the current year. For a link that stays on ${esc(year)}, use <a href="/year-end/${year}">/year-end/${year}</a>.</p>` : ''}
      <div class="ye-yours" data-ye-yours hidden><p data-some hidden>Cards saved on earnrate.dev in this browser come first in each list, marked “Your card”. Each also has a page of its own:</p><p data-none hidden>None of the cards saved on earnrate.dev in this browser have anything on this page.</p><ul class="chip-links"></ul></div>
      ${jumpList(y, ctx)}
      ${allSections(v)}
      ${cardPagesList(v)}
      ${quarterly}
      ${nav}
      ${SOURCE_LINE}
      <script>${SEND_SCRIPT}</script>
      <script>${WALLET_SCRIPT}</script>`
  return { title, description, body }
}

// A card's own part of the year's page, at an address of its own so a link
// to it can say in its preview what's ending on that card.
function cardPage(
  ctx: PageContext,
  y: YearEnd,
  card: Card,
  lastmod: string,
): GeneratedPage {
  const one = only(y, card.id)
  const year = String(y.year)
  const path = cardPath(y, card.id)
  const name = cardName(ctx, card)
  const title = cardTitle(ctx, one, card)
  const sentences = cardSummary(ctx, one, card)
  const [lead = [''], ...more] = sentences
  const description = fitSentences([lead], more)
  const answer = sentences.map((s) => s[0] ?? '').join(' ')
  const anchor = anchors(y).get(card.id) ?? ''
  const v: View = { ctx, y: one, one: card, titles: new Map() }
  const image = `og/year-end/${year}/${card.id}.jpg`
  const body = `
      <div class="card-head">${ctx.art(card.id, 112)}<h1>${esc(title.replace(/ \| earnrate$/, ''))}</h1></div>
      <p class="updated">${esc(`${card.name} · Through ${shortDate(y.end)} · Updated ${ctx.dayWords(lastmod)}`)}</p>
      <p class="answer">${esc(answer)}</p>
      ${sendRow(y, card, title)}
      ${scopeHtml(ctx, card)}
      ${allSections(v)}
      <h2>${esc(`More on ${theCard(ctx, card)}`)}</h2>
      <p><a href="/cards/${card.id}">${esc(`Everything on ${theCard(ctx, card)}`)}</a>${esc(card.credits.length > 0 ? ': its rates, fees and all of its credits, not only the ones that end with the year.' : ': its rates, fees and the rest of its terms.')}</p>
      <p><a href="/year-end/${year}#${esc(anchor)}">${esc(`Every card's credits and deadlines for ${shortDate(y.end)}`)}</a>, with this one among them.</p>
      ${pageActions(
        [
          {
            when: ['none', 'other'],
            html: button(
              `/#wallet&add=${card.id}`,
              'Have it? Add it to your wallet',
            ),
          },
          {
            when: ['holds'],
            html: button(`/#wallet&card=${card.id}`, 'Open it in your wallet'),
          },
        ],
        card.id,
      )}
      ${SOURCE_LINE}
      <script>${SEND_SCRIPT}</script>`
  const { line } = headline(one)
  return {
    file: `year-end/${year}/${card.id}.html`,
    path,
    lastmod,
    noindex: !cardPageIndexed(one),
    image: {
      file: image,
      color: cardColor(ctx.catalog, card.id),
      kicker: `${ctx.issuerName(card.issuer)} · year-end ${year}`,
      name,
      line,
    },
    html: ctx.layout({
      title,
      description,
      path,
      body,
      image: `/${image}`,
      noindex: !cardPageIndexed(one),
      crumbs: [
        { name: 'Year-end deadlines', path: '/year-end/' },
        { name: year, path: `/year-end/${year}` },
        { name, path },
      ],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
        url: `${SITE}${path}`,
        dateModified: lastmod,
        temporalCoverage: `${year}-01-01/${y.end}`,
        about: {
          '@type': 'CreditCard',
          name: card.name,
          url: `${SITE}/cards/${card.id}`,
        },
      },
    }),
  }
}

// Search engines get a card's page when something on it ends with the year:
// a yearly, half-year or quarterly credit, a dated rate or offer, a
// calendar-year spend bonus. December's monthly credits, caps that start
// over and rotating categories come back every period, and the card's page
// and the quarterly pages already say them.
export const cardPageIndexed = (one: YearEnd) =>
  one.credits.length > 0 || one.ending.length > 0 || one.milestones.length > 0

// A past year's address, kept so links to it still lead somewhere.
function pastYear(ctx: PageContext, year: number): GeneratedPage {
  const y = String(year)
  const path = `/year-end/${y}`
  const end = `${y}-12-31`
  const title = fitTitle([
    `Credit card credits that expired Dec 31, ${y}`,
    `Card credits that expired Dec 31, ${y}`,
  ])
  const description = `The deadlines on this page were ${shortDate(end)}. This year's statement credits, spend bonuses and dated rates are on earnrate's year-end page.`
  return {
    file: `year-end/${y}.html`,
    path,
    lastmod: addDays(end, 1),
    html: ctx.layout({
      title,
      description,
      path,
      body: `
      <h1>${esc(title.replace(/ \| earnrate$/, ''))}</h1>
      <p class="answer">${esc(`These deadlines were ${longDate(end)}, and have passed.`)} <a href="/year-end/">This year's credits and deadlines</a>.</p>`,
      crumbs: [
        { name: 'Year-end deadlines', path: '/year-end/' },
        { name: y, path },
      ],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
        url: `${SITE}${path}`,
        temporalCoverage: `${y}-01-01/${end}`,
      },
    }),
  }
}

// A past year's card pages lead to that year's page, which says they've
// passed and links this year's.
export function yearEndRedirects(ctx: PageContext): string[] {
  const year = Number(ctx.today.slice(0, 4))
  const lines: string[] = []
  for (let e = FIRST_YEAR; e < year; e++)
    lines.push(`/year-end/${String(e)}/* /year-end/${String(e)}`)
  return lines
}

export function yearEndPages(
  ctx: PageContext,
  lastmod: (files: string[]) => string,
): GeneratedPage[] {
  const year = Number(ctx.today.slice(0, 4))
  const y = yearEnd(ctx, year)
  const start = `${String(year)}-01-01`
  const later = (date: string) => (date > start ? date : start)
  const date = later(
    lastmod([...anchors(y).keys()].map((id) => `data/cards/${id}.yaml`)),
  )
  const earlier: number[] = []
  for (let e = FIRST_YEAR; e < year; e++) earlier.push(e)
  const page = (hub: boolean): GeneratedPage => {
    const { title, description, body } = renderYear(ctx, y, hub, earlier, date)
    const path = hub ? '/year-end/' : `/year-end/${String(year)}`
    return {
      file: hub ? 'year-end/index.html' : `year-end/${String(year)}.html`,
      path,
      lastmod: date,
      html: ctx.layout({
        title,
        description,
        path,
        body,
        crumbs: hub
          ? [{ name: 'Year-end deadlines', path: '/year-end/' }]
          : [
              { name: 'Year-end deadlines', path: '/year-end/' },
              { name: String(year), path },
            ],
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: title,
          description,
          url: `${SITE}${path}`,
          dateModified: date,
          temporalCoverage: `${String(year)}-01-01/${y.end}`,
        },
      }),
    }
  }
  return [
    page(true),
    page(false),
    ...listedCards(ctx, y).map((card) =>
      cardPage(ctx, y, card, later(lastmod([`data/cards/${card.id}.yaml`]))),
    ),
    ...earlier.map((e) => pastYear(ctx, e)),
  ]
}
