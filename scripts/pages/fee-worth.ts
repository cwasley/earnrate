// "Is the annual fee worth it?" on a card page: the engine's fee math and
// sentences, with the table of amounts and what it assumes.
import {
  EARNING_ONLY,
  feeWorthCredits,
  feeWorthMix,
  feeWorthTransfer,
  feeWorthVerdict,
  type FeeWorth,
  type Markup,
} from '../../src/engine/fee-worth.ts'
import { TYPICAL_MONTHLY_SPEND } from '../../src/engine/simulate.ts'
import { listed, money, num, wholeDollars } from '../../src/engine/text.ts'
import type { PageContext } from './context.ts'
import { esc } from './site.ts'

const SHOWN_AMOUNTS = [500, 1000, 2000, 4000]

const HTML: Markup = { esc, strong: (s) => `<strong>${s}</strong>` }

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
  const transferLine =
    transfer === undefined || transfer.cents === undefined
      ? ''
      : ` ${feeWorthTransfer(ctx.catalog, card, { worth: transfer.worth, cents: transfer.cents }, HTML)}`
  const mix = feeWorthMix(w)
  const rows = SHOWN_AMOUNTS.map((m) => {
    const r = w.at(m)
    const best = r.best.cards[0]?.cardId ?? ''
    return `<tr><td>${esc(wholeDollars(m))}</td><td>${esc(money(r.card.net))}</td><td>${esc(money(r.best.net))} <span class="muted">(<a href="/cards/${best}">${esc(ctx.shortName(best))}</a>)</span></td></tr>`
  }).join('')
  const creditsLine =
    w.credits === null ? '' : ` ${feeWorthCredits(ctx.catalog, w, HTML)}`
  const extras = [
    w.at(SHOWN_AMOUNTS[0] ?? 500).card.membershipFees > 0
      ? 'the membership it needs, counted like a fee'
      : null,
  ].filter((x) => x !== null)
  return `<h2 id="annual-fee">Is the annual fee worth it?</h2>
      <p>${feeWorthVerdict(w, name, HTML)}${transferLine} ${EARNING_ONLY}${creditsLine}</p>
      <table class="numbers"><thead><tr><th>A month</th><th>${esc(name)}, a year after fees</th><th>Best no-fee card</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">Assumes ${esc(value)}; ${esc(w.everywhere ? `no typical category earns it a bonus, so the whole typical mix: ${mix}` : `the typical mix of its bonus categories: ${mix}`)} (from earnrate's typical household: ${esc(TYPICAL_MONTHLY_SPEND.map((t) => `${t.what} ${money(t.monthly)}`).join(', '))}); the same spending every month for a year; the regular annual fee${extras.length > 0 ? `, ${esc(listed(extras))}` : ''}; no welcome bonus, first-year rate or credits. The no-fee side is the best of ${String(w.rivals)} no-fee ${card.business ? 'business' : 'personal'} cards that need no membership, on the same spending, each with its best picks. Other spending, earned at each card's other rates, isn't included.</p>`
}
