// "Is the annual fee worth it?" on a card page: the engine's fee math as
// a short answer block and a table of amounts, with the engine's sentences
// and what it assumes one tap away.
import {
  EARNING_ONLY,
  feeWorthCredits,
  feeWorthMix,
  feeWorthTransfer,
  feeWorthVerdict,
  lineWords,
  MAX_MONTHLY,
  STEP,
  type FeeWorth,
  type Markup,
} from '../../src/engine/fee-worth.ts'
import { TYPICAL_MONTHLY_SPEND } from '../../src/engine/simulate.ts'
import { yearlyPointsCounted } from '../../src/engine/yearly-points.ts'
import {
  inOrder,
  listed,
  money,
  num,
  perksNoun,
  wholeDollars,
} from '../../src/engine/text.ts'
import type { PageContext } from './context.ts'
import { esc } from './site.ts'

const SHOWN_AMOUNTS = [500, 1000, 2000, 4000]

const HTML: Markup = { esc, strong: (s) => `<strong>${s}</strong>` }

// The monthly spending from which it comes out ahead, as an answer cell.
function fromAmount(breakEven: number | null, stopsAt: number | null): string {
  if (breakEven === null)
    return `Not within ${wholeDollars(MAX_MONTHLY)} a month`
  return stopsAt === null
    ? `From ${wholeDollars(breakEven)} a month`
    : `${wholeDollars(breakEven)} to ${wholeDollars(stopsAt)} a month`
}

function withCredits(w: FeeWorth): string {
  if (w.creditsBreakEven !== 0)
    return fromAmount(w.creditsBreakEven, w.creditsStopAt)
  if (w.creditsStopAt === null) return 'At any amount'
  return w.creditsStopAt === 0
    ? `Under ${wholeDollars(STEP)} a month`
    : `Up to ${wholeDollars(w.creditsStopAt)} a month`
}

export function feeWorthSection(
  ctx: PageContext,
  w: FeeWorth,
  transfer?: { worth: FeeWorth | null; cents: number | undefined },
): string {
  const { card } = w
  const name = ctx.shortName(card.id)
  const currency = ctx.catalog.currencies.find((c) => c.id === card.currency)
  const value =
    card.currency === 'cash'
      ? 'cash back at face value'
      : `${currency?.name ?? card.currency} at ${num(currency?.value_cents ?? 1)}¢ each, earnrate's default`
  const fee = wholeDollars(card.annual_fee ?? 0)
  const where = w.everywhere
    ? 'spending'
    : `spending on ${inOrder(w.lines.map(lineWords))}`
  const transferLine =
    transfer === undefined || transfer.cents === undefined
      ? ''
      : ` ${feeWorthTransfer(ctx.catalog, card, { worth: transfer.worth, cents: transfer.cents }, HTML)}`
  const answers: [string, string][] = [
    ['On earning alone', fromAmount(w.breakEven, w.stopsAt)],
    ...(transfer === undefined || transfer.cents === undefined
      ? []
      : [
          [
            `If you transfer points (${num(transfer.cents)}¢)`,
            fromAmount(
              transfer.worth?.breakEven ?? null,
              transfer.worth?.stopsAt ?? null,
            ),
          ] as [string, string],
        ]),
    ...(w.credits === null
      ? []
      : [
          [
            `If you use its ${perksNoun(w.credits, true, true)} (${wholeDollars(w.credits.yearly)} a year)`,
            withCredits(w),
          ] as [string, string],
        ]),
  ]
  const mix = feeWorthMix(w)
  const rows = SHOWN_AMOUNTS.map((m) => {
    const r = w.at(m)
    const best = r.best.cards[0]?.cardId ?? ''
    return `<tr><td>${esc(wholeDollars(m))}</td><td>${esc(wholeDollars(r.card.net))}</td><td>${esc(wholeDollars(r.best.net))} <span class="muted">(<a href="/cards/${best}">${esc(ctx.shortName(best))}</a>)</span></td></tr>`
  }).join('')
  const credits = feeWorthCredits(ctx.catalog, w, HTML)
  const creditsLine = credits === '' ? '' : ` ${credits}`
  const yearly = yearlyPointsCounted(ctx.catalog, card)
  const extras = [
    w.at(SHOWN_AMOUNTS[0] ?? 500).card.membershipFees > 0
      ? 'the membership it needs, counted like a fee'
      : null,
  ].filter((x) => x !== null)
  return `<h2 id="annual-fee">Is the annual fee worth it?</h2>
      <p>It earns more than the best no-fee card, after its ${esc(fee)} fee, at this much a month of ${esc(where)}:</p>
      <dl class="facts worth">${answers.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <p class="muted">${esc(EARNING_ONLY)}</p>
      <table class="numbers"><thead><tr><th>A month</th><th>${esc(name)}, a year after fees</th><th>Best no-fee card</th></tr></thead><tbody>${rows}</tbody></table>
      <details class="fine"><summary>How this is calculated</summary>
      <p>${feeWorthVerdict(w, name, HTML)}${transferLine}${creditsLine}</p>
      <p class="muted">Assumes ${esc(value)}; ${esc(w.everywhere ? `no typical category earns it a bonus, so the whole typical mix: ${mix}` : `the typical mix of its bonus categories: ${mix}`)} (from earnrate's typical household: ${esc(TYPICAL_MONTHLY_SPEND.map((t) => `${t.what} ${money(t.monthly)}`).join(', '))}); the same spending every month for a year; the regular annual fee${extras.length > 0 ? `, ${esc(listed(extras))}` : ''}${yearly === null ? '' : `; ${esc(yearly)}`}; no welcome bonus, first-year rate or credits. The no-fee side is the best of ${String(w.rivals)} no-fee ${card.business ? 'business' : 'personal'} cards that need no membership, on the same spending, each with its best picks. Other spending, earned at each card's other rates, isn't included.</p>
      </details>`
}
