// /welcome-offers: every card's public welcome offer, ranked on the bonus
// less the first year's fee (src/engine/welcome-offers.ts), with a picker
// for what a planned amount of spending unlocks and which card to open
// first. The life-event pages (life-events.ts) share the picker, the
// ordering notes and the offer rows.
import { repeatRuleParts } from '../../src/engine/repeat-bonus.ts'
import {
  OFFERS_MAY_DIFFER,
  offerShortTerms,
  offerTerms,
} from '../../src/engine/offers.ts'
import { BONUS_RULES_COLUMN } from '../../src/engine/bonus-rules.ts'
import {
  currencyName,
  listed,
  num,
  shortDate,
  wholeDollars,
} from '../../src/engine/text.ts'
import {
  EVEN_SPENDING,
  FROM_OPENING,
  openFirst,
  PICKER_AMOUNTS,
  PICKER_MONTHS,
  rankedOffers,
  unlockedAt,
  type OpenFirst,
  type RankedOffer,
} from '../../src/engine/welcome-offers.ts'
import type { GeneratedPage, PageContext } from './context.ts'
import { esc, finePrint, fitDescription, fitTitle, SITE } from './site.ts'

export const HUB_PATH = '/welcome-offers'
export const HUB_SHORT = 'Welcome offers'
const TOP_SHOWN = 10

export type Offers = ReturnType<typeof rankedOffers>

const centsWords = (cents: number) => `${num(cents)}¢`

// "Worth $1,750 at 1¢ each; $2,975 if you transfer points (1.7¢)"
function worthText(ctx: PageContext, o: RankedOffer): string {
  const at = o.points === null ? '' : ` at ${centsWords(o.centsPerUnit)} each`
  const transfer =
    o.transfer === null
      ? ''
      : `; ${wholeDollars(o.transfer.value)} if you transfer points (${centsWords(o.transfer.cents)})`
  return `Worth ${wholeDollars(o.bonusValue)}${at}${transfer}`
}

const termsOf = (ctx: PageContext, o: RankedOffer) =>
  offerShortTerms(o, currencyName(ctx.catalog, o.currency))

// One ranked offer: its first-year value on the right, its terms and fees
// under the name, and who can get it again one tap away.
export function offerRow(ctx: PageContext, o: RankedOffer, rank: number) {
  const card = ctx.cards.get(o.cardId)
  const repeat = card
    ? (repeatRuleParts(ctx.catalog, card).label ?? 'Not stated')
    : 'Not stated'
  const details = [
    o.varies
      ? 'Offers vary by person: this is the most the issuer shows.'
      : null,
    o.offerHigh?.text ?? null,
    o.note,
  ].filter((d) => d !== null)
  const lines = [
    esc(worthText(ctx, o)),
    esc(ctx.feeLabel(o.cardId)),
    `<a href="/bonus-rules">${esc(BONUS_RULES_COLUMN)}</a> ${esc(repeat)}`,
  ]
  return `<li data-anchor="${esc(o.cardId)}"><span class="rank">${String(rank)}</span>${ctx.art(o.cardId)}<div><span class="row-head"><a class="row-link" href="/cards/${esc(o.cardId)}">${esc(ctx.shortName(o.cardId))}</a> <span class="rate">${esc(wholeDollars(o.firstYearValue))}</span></span><span class="muted row-note">${esc(termsOf(ctx, o))} · checked ${esc(shortDate(o.lastVerified))}</span><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>${
    details.length === 0
      ? ''
      : `<details class="fine"><summary>About this offer</summary>${details.map((d) => `<p>${esc(d)}</p>`).join('')}</details>`
  }</div></li>`
}

function offerList(ctx: PageContext, offers: RankedOffer[]): string {
  const rows = offers.map((o, i) => offerRow(ctx, o, i + 1))
  const top = rows.slice(0, TOP_SHOWN).join('')
  const rest = rows.slice(TOP_SHOWN)
  return `<ol class="cards">${top}</ol>${
    rest.length === 0
      ? ''
      : `<details class="fine more-offers"><summary>The other ${String(rest.length)}</summary><ol class="cards" start="${String(TOP_SHOWN + 1)}">${rest.join('')}</ol></details>`
  }`
}

// The picker: taps for an amount and a number of months, and every offer
// with the picker keys it's unlocked at. Its script only shows and hides
// rows: nothing picked is sent, saved or put in the address.
const amountWords = (n: number) =>
  n >= 1000 ? `$${String(n / 1000)}k` : wholeDollars(n)

function seg(
  name: string,
  label: string,
  options: [string, string][],
  checked: string | null,
) {
  return `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${options
    .map(
      ([value, text]) =>
        `<label><input type="radio" name="${name}" value="${esc(value)}"${value === checked ? ' checked' : ''} />${esc(text)}</label>`,
    )
    .join('')}</div>`
}

// The window most offers give, so the months start where most offers are.
export function usualMonths(offers: RankedOffer[]): number {
  const counts = new Map<number, number>()
  for (const o of offers) counts.set(o.months, (counts.get(o.months) ?? 0) + 1)
  const best = [...counts.entries()]
    .filter(([m]) => PICKER_MONTHS.includes(m))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  return best?.[0] ?? PICKER_MONTHS[0] ?? 3
}

function pickRow(ctx: PageContext, o: RankedOffer, kind: string): string {
  const fee =
    o.firstYearFee === null || o.firstYearFee === 0
      ? 'no fee the first year'
      : `less the ${wholeDollars(o.firstYearFee)} first-year fee`
  return `<li data-kind="${kind}" data-unlocks="${unlockedAt(o).join(' ')}" hidden><div><span class="row-head"><a class="row-link" href="/cards/${esc(o.cardId)}">${esc(ctx.shortName(o.cardId))}</a> <span class="rate">${esc(wholeDollars(o.firstYearValue))}</span></span><span class="muted row-note">${esc(termsOf(ctx, o))}. ${esc(worthText(ctx, o))}, ${esc(fee)}.</span></div></li>`
}

export function offerPicker(
  ctx: PageContext,
  offers: Offers,
  { heading, lead }: { heading: string; lead: string },
): string {
  const months = usualMonths(offers.personal)
  const rows = [
    ...offers.personal.map((o) => pickRow(ctx, o, 'personal')),
    ...offers.business.map((o) => pickRow(ctx, o, 'business')),
  ]
  return `<section class="picker" data-picker hidden>
      <h2 id="unlock">${esc(heading)}</h2>
      <p>${esc(lead)}</p>
      <p class="pick-label">About how much</p>
      ${seg(
        'offer-amount',
        'About how much',
        PICKER_AMOUNTS.map((a) => [String(a), amountWords(a)]),
        null,
      )}
      <p class="pick-label">Over how many months</p>
      ${seg(
        'offer-months',
        'Over how many months',
        PICKER_MONTHS.map((m) => [String(m), `${String(m)} mo`]),
        String(months),
      )}
      ${seg(
        'offer-kind',
        'Card type',
        [
          ['personal', 'Personal cards'],
          ['business', 'Business cards'],
        ],
        'personal',
      )}
      <p class="muted">${esc(EVEN_SPENDING)} ${esc(FROM_OPENING)}</p>
      <p data-picker-none>Tap an amount to see which offers it unlocks.</p>
      <p data-picker-count hidden></p>
      <p data-picker-empty hidden>No offer's minimum is reached at that amount over that many months.</p>
      <ol class="cards picks" data-picker-list hidden>${rows.join('')}</ol>
      <p data-picker-more hidden><button type="button" class="button quiet">Show them all</button></p>
    </section><script>${PICKER_SCRIPT}</script>`
}

// Shows the offers unlocked at the amount and months picked. Runs only in
// the page; a page restored from the back-forward cache keeps its taps.
const PICKER_SHOWN = 10

export const PICKER_SCRIPT = `(() => {
  const box = document.currentScript?.previousElementSibling
  if (!box || !box.hasAttribute('data-picker')) return
  box.hidden = false
  const rows = [...box.querySelectorAll('[data-unlocks]')]
  const list = box.querySelector('[data-picker-list]')
  const none = box.querySelector('[data-picker-none]')
  const count = box.querySelector('[data-picker-count]')
  const empty = box.querySelector('[data-picker-empty]')
  const more = box.querySelector('[data-picker-more]')
  let open = false
  more.querySelector('button').addEventListener('click', () => {
    open = true
    show()
  })
  const picked = (name) => box.querySelector('input[name="' + name + '"]:checked')?.value
  const show = () => {
    const amount = picked('offer-amount')
    const months = picked('offer-months')
    const kind = picked('offer-kind') ?? 'personal'
    const ready = amount !== undefined && months !== undefined
    const key = amount + '-' + months
    let shown = 0
    let all = 0
    for (const row of rows) {
      const mine = row.dataset.kind === kind
      if (mine) all++
      const on = ready && mine && row.dataset.unlocks.split(' ').includes(key)
      row.hidden = !on || (!open && shown >= ${String(PICKER_SHOWN)})
      if (on) shown++
    }
    more.hidden = open || shown <= ${String(PICKER_SHOWN)}
    none.hidden = ready
    list.hidden = !ready || shown === 0
    empty.hidden = !ready || shown > 0
    count.hidden = !ready || shown === 0
    count.textContent = shown + ' of ' + all + ' offers reach their minimum, highest first:'
  }
  box.addEventListener('change', () => {
    open = false
    show()
  })
  addEventListener('pageshow', show)
  show()
})()`

// "Open the Amex Gold before the Amex Platinum", with the issuer's reasons.
export function openFirstList(ctx: PageContext, pairs: OpenFirst[]): string {
  const link = (id: string) =>
    `<a href="/cards/${esc(id)}">${esc(ctx.shortName(id))}</a>`
  return `<ul class="change-notes">${pairs
    .map(
      (p) =>
        `<li>Open the ${link(p.first)} before the ${listed(p.then.map(link), 'or')}. <span class="muted">${esc(p.reasons.join(' '))}</span></li>`,
    )
    .join('')}</ul>`
}

export const OPEN_FIRST_LEAD =
  "Some issuers' terms say a card's bonus may not be available to someone who has or has had another card, while that other card's offer doesn't say the same back. Opening the first card first keeps both bonuses possible under the rules the issuers publish."

export type LifeEventLink = { path: string; name: string }

export function welcomeOffersHub(
  ctx: PageContext,
  offers: Offers,
  events: LifeEventLink[],
  lastmod: string,
): GeneratedPage {
  const { personal, business } = offers
  const pairs = openFirst(ctx.catalog, ctx.today)
  const top = personal[0]
  const noFee = personal.find(
    (o) => (o.firstYearFee ?? 0) === 0 && o.membership === null,
  )
  const name = (o: RankedOffer) => ctx.shortName(o.cardId)
  const answer =
    top === undefined
      ? ''
      : `<p class="answer">The <strong>${esc(name(top))}</strong> has the public offer worth the most in its first year: ${esc(offerTerms(top, currencyName(ctx.catalog, top.currency)).replace(/^Up to/, 'up to'))}, ${esc(wholeDollars(top.bonusValue))} at earnrate's default point values${(top.firstYearFee ?? 0) > 0 ? ` and ${esc(wholeDollars(top.firstYearValue))} after its ${esc(wholeDollars(top.firstYearFee ?? 0))} first-year fee` : ''}.${
          noFee !== undefined && noFee !== top
            ? ` With no fee the first year, the <strong>${esc(name(noFee))}</strong> leads at ${esc(wholeDollars(noFee.firstYearValue))}.`
            : ''
        }</p>`
  const title = fitTitle([
    'Best credit card welcome offers, ranked',
    'Best credit card welcome offers',
  ])
  const description = fitDescription([
    `${String(personal.length + business.length)} public sign-up bonuses ranked by what each is worth less the first-year fee, with the minimum spend, the highest past offer and who can get it.`,
    `Public sign-up bonuses ranked by what each is worth less the first-year fee, with the minimum spend and who can get it.`,
  ])
  const body = `
      <h1>Best credit card welcome offers</h1>
      <p class="updated">Updated ${esc(ctx.dayWords(lastmod))}</p>
      ${answer}
      <p>Each offer is ranked on what its bonus is worth at earnrate's default point values, less the first year's annual fee. ${esc(OFFERS_MAY_DIFFER)}</p>
      ${offerPicker(ctx, offers, {
        heading: 'What a big purchase unlocks',
        lead: 'Tap about how much you plan to put on a new card, and over how many months.',
      })}
      <h2 id="personal">Personal cards</h2>
      ${offerList(ctx, personal)}
      <h2 id="business">Business cards</h2>
      <p>These need a business to apply for. Ranked the same way.</p>
      ${offerList(ctx, business)}
      <h2 id="open-first">Which card to open first</h2>
      <p>${esc(OPEN_FIRST_LEAD)}</p>
      ${finePrint(openFirstList(ctx, pairs), `The ${String(pairs.length)} cards to open first`)}
      <p>Every card's rule for earning its bonus again: <a href="/bonus-rules">bonus rules</a>.</p>
      <h2>Planning a big expense?</h2>
      <ul class="chip-links">${events.map((e) => `<li><a href="${e.path}">${esc(e.name)}</a></li>`).join('')}</ul>
      <p class="muted">${esc(FROM_OPENING)} Statement credits and what a card earns after the bonus aren't counted here; each card's page has them. Each row gives the point value it uses, and Amex and Chase points also at what transferring them to airlines and hotels can be worth.</p>`
  return {
    file: 'welcome-offers.html',
    path: HUB_PATH,
    lastmod,
    html: ctx.layout({
      title,
      description,
      path: HUB_PATH,
      body,
      crumbs: [{ name: HUB_SHORT, path: HUB_PATH }],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
        url: `${SITE}${HUB_PATH}`,
        dateModified: lastmod,
        mainEntity: {
          '@type': 'ItemList',
          name: 'Best credit card welcome offers',
          itemListElement: personal.slice(0, TOP_SHOWN).map((o, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: o.cardName,
            description: termsOf(ctx, o),
          })),
        },
      },
    }),
  }
}

// The card ids a page's offers come from, for its lastmod.
export const offerCardIds = (offers: Offers) => [
  ...offers.personal.map((o) => o.cardId),
  ...offers.business.map((o) => o.cardId),
]
