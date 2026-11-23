// The annual-fee section's cheaper cards: keep-or-replace's answer for the
// card held alone, on the section's own spending (typical amounts in its
// bonus categories), as a small table.
import { EMPTY_WALLET } from '../../src/engine/transient.ts'
import { ALL_PERSONAL_CARDS, idealHolding } from '../../src/engine/explore.ts'
import {
  lineWords,
  TRANSFER_VALUES,
  type FeeWorth,
} from '../../src/engine/fee-worth.ts'
import {
  keepOrReplace,
  type KeepOrReplace,
} from '../../src/engine/keep-or-replace.ts'
import {
  simulateSingles,
  typicalSpendLines,
  type ResolvedLine,
} from '../../src/engine/simulate.ts'
import {
  money,
  num,
  perksNoun,
  possessive,
  wholeDollars,
} from '../../src/engine/text.ts'
import type { Card } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { PageContext } from './context.ts'
import { esc } from './site.ts'

export type CheaperRow = {
  cardId: string
  fee: number
  net: number // a year after its fee, at earnrate's default point values
  transferNet: number | null // the same with points at transfer value
}

export type CheaperCards = {
  k: KeepOrReplace
  lines: ResolvedLine[] // the spending, at typical monthly amounts
  everywhere: boolean
  own: CheaperRow
  rows: CheaperRow[] // the cheaper cards, most net first
  cents: number | null // the card's points at transfer value
}

const whole = (n: number) => Math.round(n)

export function cheaperCards(
  catalog: Catalog,
  worth: FeeWorth,
  today: string,
): CheaperCards | null {
  const { card } = worth
  const fee = card.annual_fee ?? 0
  if (fee <= 0 || card.applications_closed !== undefined) return null
  // The section's mix at the amounts it calls typical.
  const lines = typicalSpendLines(catalog).filter((l) =>
    worth.lines.some((w) => w.label === l.label),
  )
  const options = (valuations: Record<string, number>) => ({
    filters: { ...ALL_PERSONAL_CARDS, business: card.business },
    memberships: [],
    valuations,
    start: today,
  })
  const [own] = simulateSingles(catalog, [card], lines, options({}))
  // Held from today, so the year counted starts today, not at a renewal.
  const { anniversary: _, ...held } = idealHolding(
    card,
    today,
    own?.cards[0]?.picks ?? {},
  )
  const k = keepOrReplace(
    catalog,
    { ...EMPTY_WALLET, cards: [held] },
    card.id,
    today,
    { lines, typical: true },
  )
  if (k === null || k.replacements.length === 0) return null
  const cents = k.transfer?.cents ?? null
  const transferNet = (id: string, fee: number): number | null => {
    const c = catalog.cards.find((x) => x.id === id)
    if (cents === null || !c || TRANSFER_VALUES[c.currency] === undefined)
      return null
    const [sim] = simulateSingles(catalog, [c], lines, options(TRANSFER_VALUES))
    return sim === undefined ? null : sim.rewards - fee
  }
  return {
    k,
    lines,
    everywhere: worth.everywhere,
    own: {
      cardId: card.id,
      fee,
      net: k.added,
      transferNet: k.transfer?.result.added ?? null,
    },
    rows: k.replacements.map((r) => ({
      cardId: r.cardId,
      fee: r.annualFee,
      net: r.net,
      transferNet: transferNet(r.cardId, r.annualFee),
    })),
    cents,
  }
}

// The verdict at default point values, then whether transfer value turns
// it around.
function leadText(ctx: PageContext, c: CheaperCards): string {
  const name = ctx.shortName(c.own.cardId)
  const [best] = c.rows
  if (best === undefined) return ''
  const other = ctx.shortName(best.cardId)
  const spending = c.everywhere
    ? 'On typical spending'
    : 'On typical spending in these categories'
  const verdict =
    whole(best.net) > whole(c.own.net)
      ? `${spending}, a cheaper card nets more: the ${other}, about ${wholeDollars(best.net)} a year to ${possessive(`the ${name}`)} ${wholeDollars(c.own.net)}.`
      : whole(best.net) === whole(c.own.net)
        ? `${spending}, the ${other} nets about as much as the ${name}, for a lower fee.`
        : `${spending}, the ${name} nets more than any cheaper card; the closest, the ${other}, keeps about ${String(c.k.replacements[0]?.share ?? 0)}% of it.`
  const t = c.k.transfer?.result
  if (c.cents === null || t === undefined) return verdict
  const [first] = t.replacements
  const ahead = whole(c.own.net) > whole(best.net)
  const aheadThen = first === undefined || whole(t.added) > whole(first.net)
  if (ahead === aheadThen) return verdict
  return `${verdict} With points at ${num(c.cents)}¢, ${aheadThen ? `the ${name} comes out ahead` : 'a cheaper card comes out ahead'}.`
}

// "Use all $424 of its statement credits and it nets about $622."
function creditsText(c: CheaperCards): string {
  const u = c.k.unsaid
  if (u.yearly <= 0) return ''
  const total = wholeDollars(c.own.net + u.yearly)
  const noun = perksNoun(u, true, true)
  if (u.nights > 0)
    return `Use its ${noun} (up to ${wholeDollars(u.yearly)} a year) and it nets up to about ${total}.`
  return u.names.length === 1
    ? `Use its ${wholeDollars(u.yearly)} ${noun} and it nets about ${total}.`
    : `Use all ${wholeDollars(u.yearly)} of its ${noun} and it nets about ${total}.`
}

export function cheaperCardsTable(ctx: PageContext, c: CheaperCards): string {
  // A word joiner keeps a loss's minus sign on the line with its amount.
  const figure = (n: number) => wholeDollars(n).replace(/^−/, '−⁠')
  const cell = (r: CheaperRow) =>
    c.cents !== null && r.transferNet !== null
      ? `${figure(r.net)}, or ${figure(r.transferNet)} at ${num(c.cents)}¢`
      : figure(r.net)
  const fee = (r: CheaperRow) => (r.fee === 0 ? 'None' : wholeDollars(r.fee))
  const row = (r: CheaperRow, own: boolean) =>
    `<tr><td>${own ? `<strong>${esc(ctx.shortName(r.cardId))}</strong>` : `<a href="/cards/${r.cardId}">${esc(ctx.shortName(r.cardId))}</a>`}</td><td>${esc(fee(r))}</td><td>${esc(cell(r))}</td></tr>`
  const amounts = c.everywhere
    ? `earnrate's typical household spending, ${money(c.lines.reduce((sum, l) => sum + l.monthly, 0))}`
    : c.lines.map((l) => `${money(l.monthly)} ${lineWords(l)}`).join(', ')
  const credits = creditsText(c)
  return `<p>${esc(leadText(ctx, c))}</p>
      <table class="numbers"><thead><tr><th>Card</th><th>Annual fee</th><th>Nets a year</th></tr></thead><tbody>${row(c.own, true)}${c.rows.map((r) => row(r, false)).join('')}</tbody></table>
      <p class="muted">What each card earns on ${esc(amounts)} a month, less its fee${c.cents === null ? '' : `, with points at earnrate's default and at ${esc(num(c.cents))}¢ transferred`}.${credits === '' ? '' : ` ${esc(credits)}`}</p>`
}

// For the section's collapsed fine print.
export function cheaperCardsNote(card: Card): string {
  return `The cheaper cards are the ${card.business ? 'business' : 'personal'} cards with a lower annual fee, or none, that net the most on the same spending, each on its own with its best picks; cards that need a membership and store cards aren't among them, and no card's statement credits are in the figures.`
}
