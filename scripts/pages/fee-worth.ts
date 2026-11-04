// "Is the annual fee worth it?" on a card page: the monthly spending in the
// card's bonus categories at which it nets more than the best no-fee card on
// the same spending, from the engine's year-long simulation.
import { matchesFilters } from '../../src/engine/explore.ts'
import {
  resolveSpendLines,
  simulateSingles,
  TYPICAL_MONTHLY_SPEND,
  typicalSpend,
  type ResolvedLine,
  type Simulation,
} from '../../src/engine/simulate.ts'
import { listed, money, num, wholeDollars } from '../../src/engine/text.ts'
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
  rivals: number // no-fee cards it was compared with
  at: (monthly: number) => { card: Simulation; best: Simulation }
}

const scaled = (lines: ResolvedLine[], monthly: number) =>
  lines.map((l) => ({ ...l, monthly: l.monthly * monthly }))

export function feeWorthKit(catalog: Catalog, today: string) {
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
    valuations: {},
    start: today,
  })

  const noFee = (card: Card) =>
    catalog.cards.filter(
      (c) =>
        c.annual_fee === 0 &&
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
      return (sim?.lines[0]?.returnPct ?? 0) > card.base_rate * cents + 1e-9
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
    const at = (monthly: number) => {
      const [own] = simulateSingles(
        catalog,
        [card],
        scaled(lines, monthly),
        options(card),
      )
      if (!own) throw new Error(`no simulation for ${card.id}`)
      return { card: own, best: bestNoFee(card, lines, monthly) }
    }
    const ahead = (monthly: number) => {
      const r = at(monthly)
      return r.card.net > r.best.net
    }
    let breakEven: number | null = null
    let stopsAt: number | null = null
    for (let m = STEP; m <= MAX_MONTHLY; m += STEP) {
      const lead = ahead(m)
      if (breakEven === null && lead) {
        let lo = m - STEP
        let hi = m
        while (hi - lo > 10) {
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
    return {
      card,
      lines,
      everywhere,
      breakEven,
      stopsAt,
      rivals: noFee(card).length,
      at,
    }
  }

  return { feeWorth }
}

// "supermarkets" mid-sentence, but "Amazon" keeps its capital.
const lineWords = (l: ResolvedLine) =>
  l.merchant.source === 'category' ? l.label.toLowerCase() : l.label

const share = (l: ResolvedLine) => `${num(Math.round(l.monthly * 100))}%`

export function feeWorthSection(ctx: PageContext, w: FeeWorth): string {
  const { card } = w
  const name = ctx.shortName(card.id)
  const currency = ctx.catalog.currencies.find((c) => c.id === card.currency)
  const value =
    card.currency === 'cash'
      ? 'cash back at face value'
      : `${currency?.name ?? card.currency} at ${num(currency?.value_cents ?? 1)}¢ each, earnrate's default`
  const mix = listed(w.lines.map((l) => `${share(l)} ${lineWords(l)}`))
  const where = w.everywhere
    ? 'spending'
    : `spending on ${listed(w.lines.map(lineWords))}`
  const verdict =
    w.breakEven === null
      ? `At these values the ${esc(name)} doesn't earn more than the best no-fee card after its ${esc(wholeDollars(card.annual_fee ?? 0))} fee, at any amount up to ${esc(wholeDollars(MAX_MONTHLY))} a month of ${esc(where)}.`
      : `At these values the ${esc(name)} earns more than the best no-fee card, after its ${esc(wholeDollars(card.annual_fee ?? 0))} fee, from about <strong>${esc(wholeDollars(w.breakEven))} a month</strong> of ${esc(where)}${w.stopsAt === null ? '' : `, up to about ${esc(wholeDollars(w.stopsAt))} a month (past that, a spending cap ends its lead)`}.`
  const rows = SHOWN_AMOUNTS.map((m) => {
    const r = w.at(m)
    const best = r.best.cards[0]?.cardId ?? ''
    return `<tr><td>${esc(wholeDollars(m))}</td><td>${esc(money(r.card.net))}</td><td>${esc(money(r.best.net))} <span class="muted">(<a href="/cards/${best}">${esc(ctx.shortName(best))}</a>)</span></td></tr>`
  }).join('')
  const extras = [
    w.at(SHOWN_AMOUNTS[0] ?? 500).card.membershipFees > 0
      ? 'the membership it needs, counted like a fee'
      : null,
  ].filter((x) => x !== null)
  return `<h2 id="annual-fee">Is the annual fee worth it?</h2>
      <p>${verdict}</p>
      <table class="numbers"><thead><tr><th>A month</th><th>${esc(name)}, a year after fees</th><th>Best no-fee card</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">Assumes ${esc(value)}; ${esc(w.everywhere ? `no typical category earns it a bonus, so the whole typical mix: ${mix}` : `the typical mix of its bonus categories: ${mix}`)} (from earnrate's typical household: ${esc(TYPICAL_MONTHLY_SPEND.map((t) => `${t.what} ${money(t.monthly)}`).join(', '))}); the same spending every month for a year; the regular annual fee${extras.length > 0 ? `, ${esc(listed(extras))}` : ''}; no welcome bonus, first-year rate or credits. The no-fee side is the best of ${String(w.rivals)} no-fee ${card.business ? 'business' : 'personal'} cards on the same spending, each with its best picks. Other spending, earned at each card's other rates, isn't included.</p>`
}
