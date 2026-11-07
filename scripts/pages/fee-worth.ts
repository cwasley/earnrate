// "Is the annual fee worth it?" on a card page: the monthly spending in the
// card's bonus categories at which it nets more than the best no-fee card on
// the same spending, from the engine's year-long simulation.
import { EPSILON } from '../../src/engine/compare.ts'
import { allCreditsYear, type CreditsYear } from '../../src/engine/credits.ts'
import { matchesFilters } from '../../src/engine/explore.ts'
import {
  resolveSpendLines,
  simulateSingles,
  TYPICAL_MONTHLY_SPEND,
  typicalSpend,
  type ResolvedLine,
  type Simulation,
} from '../../src/engine/simulate.ts'
import {
  creditsYearText,
  CREDITS_ONLY_IF,
  listed,
  money,
  num,
  pct,
  wholeDollars,
} from '../../src/engine/text.ts'
import type { Card } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { PageContext } from './context.ts'
import { esc } from './site.ts'

export const STEP = 50 // dollars a month between the amounts tried
export const MAX_MONTHLY = 5000
const SHOWN_AMOUNTS = [500, 1000, 2000, 4000]

export type FeeWorth = {
  card: Card
  lines: ResolvedLine[] // the typical mix, scaled to $1 a month in all
  everywhere: boolean // no typical line is a bonus category: the whole mix
  breakEven: number | null // dollars a month in those lines
  stopsAt: number | null // past this a cap ends its lead
  // The same with every statement credit used in full: 0 when the credits
  // alone outweigh the fee. Null without credits.
  credits: CreditsYear | null
  creditsBreakEven: number | null
  creditsStopAt: number | null
  rivals: number // no-fee cards it was compared with
  at: (monthly: number) => { card: Simulation; best: Simulation }
}

const scaled = (lines: ResolvedLine[], monthly: number) =>
  lines.map((l) => ({ ...l, monthly: l.monthly * monthly }))

// `valuations` overrides point values, for the "if you transfer points" line.
export function feeWorthKit(
  catalog: Catalog,
  today: string,
  valuations: Record<string, number> = {},
) {
  const typical = resolveSpendLines(catalog, typicalSpend(catalog))
  const cache = new Map<string, Simulation>()

  const options = (card: Card) => ({
    filters: {
      kind: 'any' as const,
      business: card.business,
      noAnnualFee: false,
      issuer: null,
      includeClosed: false,
    },
    memberships: [],
    valuations,
    start: today,
  })

  // Only cards anyone can get: one that needs a membership (a Verizon
  // account, a credit union, Costco) isn't the no-fee alternative for most.
  const noFee = (card: Card) =>
    catalog.cards.filter(
      (c) =>
        c.annual_fee === 0 &&
        c.requires_membership === undefined &&
        matchesFilters(c, { ...options(card).filters, noAnnualFee: true }),
    )

  function bestNoFee(card: Card, lines: ResolvedLine[], monthly: number) {
    const key = `${String(card.business)}|${lines.map((l) => `${l.label}:${String(l.monthly)}`).join(',')}|${String(monthly)}`
    const hit = cache.get(key)
    if (hit) return hit
    const [best] = simulateSingles(
      catalog,
      noFee(card),
      scaled(lines, monthly),
      options(card),
    )
    if (!best) throw new Error('no no-fee card to compare with')
    cache.set(key, best)
    return best
  }

  // The card's bonus lines: those where it earns more than its own base rate.
  function bonusLines(card: Card): ResolvedLine[] {
    const cents =
      catalog.currencies.find((c) => c.id === card.currency)?.value_cents ?? 1
    return typical.filter((line) => {
      const [sim] = simulateSingles(
        catalog,
        [card],
        [{ ...line, monthly: 100 }],
        options(card),
      )
      return (sim?.lines[0]?.returnPct ?? 0) > card.base_rate * cents + EPSILON
    })
  }

  function feeWorth(card: Card): FeeWorth | null {
    if (!card.annual_fee || card.applications_closed !== undefined) return null
    if (noFee(card).length === 0) return null
    const bonus = bonusLines(card)
    const everywhere = bonus.length === 0
    const chosen = everywhere ? typical : bonus
    const total = chosen.reduce((s, l) => s + l.monthly, 0)
    const lines = chosen.map((l) => ({ ...l, monthly: l.monthly / total }))
    const runs = new Map<number, { card: Simulation; best: Simulation }>()
    const at = (monthly: number) => {
      const hit = runs.get(monthly)
      if (hit) return hit
      const [own] = simulateSingles(
        catalog,
        [card],
        scaled(lines, monthly),
        options(card),
      )
      if (!own) throw new Error(`no simulation for ${card.id}`)
      const run = { card: own, best: bestNoFee(card, lines, monthly) }
      runs.set(monthly, run)
      return run
    }
    const { breakEven, stopsAt } = firstLead(
      (m) => at(m).card.net > at(m).best.net,
      STEP,
    )
    const year = allCreditsYear(catalog, card, today)
    const credits = year.creditIds.length > 0 ? year : null
    const withCredits =
      credits === null
        ? { breakEven: null, stopsAt: null }
        : firstLead((m) => at(m).card.netIfCreditsUsed > at(m).best.net, 0)
    return {
      card,
      lines,
      everywhere,
      breakEven,
      stopsAt,
      credits,
      creditsBreakEven: withCredits.breakEven,
      creditsStopAt: withCredits.stopsAt,
      rivals: noFee(card).length,
      at,
    }
  }

  return { feeWorth }
}

// The first monthly amount, from `from` up, at which `ahead` holds (to the
// nearest $10), and the amount past which it stops holding, if it does.
function firstLead(ahead: (monthly: number) => boolean, from: number) {
  let breakEven: number | null = null
  let stopsAt: number | null = null
  for (let m = from; m <= MAX_MONTHLY; m += STEP) {
    const lead = ahead(m)
    if (breakEven === null && lead) {
      let lo = m - STEP
      let hi = m
      while (m > 0 && hi - lo > 10) {
        const mid = Math.round((lo + hi) / 20) * 10
        if (mid <= lo || mid >= hi) break
        if (ahead(mid)) hi = mid
        else lo = mid
      }
      breakEven = hi
    } else if (breakEven !== null && !lead) {
      stopsAt = m - STEP
      break
    }
  }
  return { breakEven, stopsAt }
}

// "supermarkets" mid-sentence, but "Amazon" keeps its capital.
const lineWords = (l: ResolvedLine) =>
  l.merchant.source === 'category' ? l.label.toLowerCase() : l.label

const share = (l: ResolvedLine) => pct(Math.round(l.monthly * 100))

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
  // The same math with points transferred to airlines and hotels.
  const transferLine =
    transfer === undefined || transfer.cents === undefined
      ? ''
      : transfer.worth?.breakEven == null
        ? ` If you transfer ${esc(currency?.name ?? card.currency)} to airlines and hotels and count them at ${esc(num(transfer.cents))}¢ each, it still doesn't come out ahead within ${esc(wholeDollars(MAX_MONTHLY))} a month.`
        : ` If you transfer ${esc(currency?.name ?? card.currency)} to airlines and hotels and count them at ${esc(num(transfer.cents))}¢ each, it comes out ahead from about <strong>${esc(wholeDollars(transfer.worth.breakEven))} a month</strong>.`
  const mix = listed(w.lines.map((l) => `${share(l)} ${lineWords(l)}`))
  const where = w.everywhere
    ? 'spending'
    : `spending on ${listed(w.lines.map(lineWords))}`
  const verdict =
    w.breakEven === null
      ? `On earning alone, the ${esc(name)} doesn't earn more than the best no-fee card after its ${esc(wholeDollars(card.annual_fee ?? 0))} fee, at any amount up to ${esc(wholeDollars(MAX_MONTHLY))} a month of ${esc(where)}.`
      : `On earning alone, the ${esc(name)} earns more than the best no-fee card, after its ${esc(wholeDollars(card.annual_fee ?? 0))} fee, from about <strong>${esc(wholeDollars(w.breakEven))} a month</strong> of ${esc(where)}${w.stopsAt === null ? '' : `, up to about ${esc(wholeDollars(w.stopsAt))} a month (past that, a spending cap ends its lead)`}.`
  const rows = SHOWN_AMOUNTS.map((m) => {
    const r = w.at(m)
    const best = r.best.cards[0]?.cardId ?? ''
    return `<tr><td>${esc(wholeDollars(m))}</td><td>${esc(money(r.card.net))}</td><td>${esc(money(r.best.net))} <span class="muted">(<a href="/cards/${best}">${esc(ctx.shortName(best))}</a>)</span></td></tr>`
  }).join('')
  const fee = wholeDollars(card.annual_fee ?? 0)
  const pastThat =
    w.creditsStopAt === null
      ? ''
      : `; past about ${esc(wholeDollars(w.creditsStopAt))} a month, the best no-fee card earns more`
  const creditsLine =
    w.credits === null
      ? ''
      : ` ${
          w.creditsBreakEven === null
            ? `Even if you'd use all its statement credits (${esc(creditsYearText(w.credits))}), it doesn't come out ahead within ${esc(wholeDollars(MAX_MONTHLY))} a month.`
            : w.creditsBreakEven === 0
              ? `If you'd use all its statement credits (${esc(creditsYearText(w.credits))}), they're worth more than its ${esc(fee)} fee, so it comes out ahead ${w.creditsStopAt === null ? 'at any amount' : `up to about ${esc(wholeDollars(w.creditsStopAt))} a month; past that, the best no-fee card earns more`}.`
              : `If you'd use all its statement credits (${esc(creditsYearText(w.credits))}), the fee pays off from about <strong>${esc(wholeDollars(w.creditsBreakEven))} a month</strong>${pastThat}.`
        } ${esc(CREDITS_ONLY_IF)}`
  const extras = [
    w.at(SHOWN_AMOUNTS[0] ?? 500).card.membershipFees > 0
      ? 'the membership it needs, counted like a fee'
      : null,
  ].filter((x) => x !== null)
  return `<h2 id="annual-fee">Is the annual fee worth it?</h2>
      <p>${verdict}${transferLine} This counts only what the card earns, not lounge access or other benefits.${creditsLine}</p>
      <table class="numbers"><thead><tr><th>A month</th><th>${esc(name)}, a year after fees</th><th>Best no-fee card</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">Assumes ${esc(value)}; ${esc(w.everywhere ? `no typical category earns it a bonus, so the whole typical mix: ${mix}` : `the typical mix of its bonus categories: ${mix}`)} (from earnrate's typical household: ${esc(TYPICAL_MONTHLY_SPEND.map((t) => `${t.what} ${money(t.monthly)}`).join(', '))}); the same spending every month for a year; the regular annual fee${extras.length > 0 ? `, ${esc(listed(extras))}` : ''}; no welcome bonus, first-year rate or credits. The no-fee side is the best of ${String(w.rivals)} no-fee ${card.business ? 'business' : 'personal'} cards that need no membership, on the same spending, each with its best picks. Other spending, earned at each card's other rates, isn't included.</p>`
}
