import { EPSILON } from '../engine/compare.ts'
import {
  evaluateCard,
  purchaseContext,
  usableAt,
  type PurchaseContext,
} from '../engine/evaluate.ts'
import {
  ALL_PERSONAL_CARDS,
  idealHolding,
  matchesFilters,
  type CardFilters,
  type Picks,
} from '../engine/explore.ts'
import {
  effectiveMemberships,
  missingMembership,
  paidMemberships,
} from '../engine/memberships.ts'
import { daysBetween } from '../engine/periods.ts'
import { applyBooking, capBooking } from '../engine/record.ts'
import {
  candidatePicks,
  withCurrentPicks,
  type ResolvedLine,
} from '../engine/simulate.ts'
import { categoryUnranked, roundCents } from '../engine/text.ts'
import type { MerchantResolution } from '../engine/types.ts'
import { cardValuation } from '../engine/valuation.ts'
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { resolveLine, takenWith, type CardLine } from './analyze.ts'

// The best single cards that are paired with each other.
const PAIR_SHORTLIST = 8

export type Replayed = {
  cardIds: string[] // one card, or a pair
  picks: Record<string, Picks> // by card, for the cards with picks
  earned: number // dollars, at the point values given
  annualFees: number // a year, every card's
  feeShare: number // the annual fees for the days the file covers
  net: number // earned minus feeShare
}

export type BestCards = {
  from: string
  to: string
  days: number // from the file's first line to its last, both counted
  singles: Replayed[] // best net first
  pair: Replayed | null // the best two cards, when they beat the best one
  // Cards that need a membership the visitor hasn't given, each replayed
  // for a member: out of singles and the pair.
  membersOnly: (Replayed & { membership: string })[]
}

type Prepared = {
  description: string
  date: string
  amount: number
  merchant: MerchantResolution
  // Without memberships: only they depend on the cards held.
  context: PurchaseContext
}

// A file shorter than this compares earnings alone: a short file's share of a
// big fee would outweigh what the cards earned on it.
export const FEE_MIN_DAYS = 28

export const feeShare = (annualFee: number, days: number) =>
  days < FEE_MIN_DAYS ? 0 : roundCents((annualFee * days) / 365)

const annualFee = (card: Card) => card.annual_fee ?? 0

// The purchases in date order, as the statement replay counts them: refunds
// and unranked categories (rent) earn nothing on any card.
function prepare(catalog: Catalog, entries: CardLine[]): Prepared[] {
  const resolved = new Map<string, MerchantResolution>()
  const none: Wallet = { valuations: {}, memberships: [], cards: [] }
  return [...entries]
    .sort((a, b) => a.line.date.localeCompare(b.line.date))
    .flatMap(({ cardId, line }) => {
      if (line.amount <= 0) return []
      const key = `${cardId}|${line.category ?? ''}|${line.description}`
      let merchant = resolved.get(key)
      if (!merchant) {
        merchant = takenWith(
          catalog.cards.find((c) => c.id === cardId),
          resolveLine(catalog, line).merchant,
        ).took
        resolved.set(key, merchant)
      }
      if (categoryUnranked(catalog, merchant.category)) return []
      return [
        {
          description: line.description,
          date: line.date,
          amount: line.amount,
          merchant,
          context: purchaseContext(catalog, none, merchant, merchant.category, {
            amount: line.amount,
            date: line.date,
            country: 'US',
          }),
        },
      ]
    })
}

// The purchases replayed on these cards, set up for the best result from the
// file's first day (every activation done, caps empty): each purchase goes on
// whichever card earns the most on it right then, and books against its cap.
function replay(
  catalog: Catalog,
  base: Pick<Wallet, 'valuations' | 'memberships'>,
  holdings: { card: Card; picks: Picks }[],
  purchases: Prepared[],
  start: string,
): number {
  let wallet: Wallet = {
    ...base,
    cards: holdings.map((h) => idealHolding(h.card, start, h.picks)),
  }
  const cents = holdings.map(
    (h) => cardValuation(catalog, wallet, h.card).centsPerUnit,
  )
  const memberships = new Set(
    effectiveMemberships(
      catalog,
      base.memberships,
      holdings.map((h) => h.card.id),
    ),
  )
  let total = 0
  for (const p of purchases) {
    const ctx = { ...p.context, memberships }
    let best: { i: number; card: Card; earned: number } | null = null
    for (const [i, { card }] of holdings.entries()) {
      const raw = wallet.cards[i]
      if (!raw || !usableAt(card, p.merchant)) continue
      const held = withCurrentPicks(card, raw, p.date)
      const rate = evaluateCard(card, held, ctx).best.rate
      const earned = Math.round(p.amount * rate * (cents[i] ?? 0)) / 100
      if (!best || earned > best.earned + EPSILON) best = { i, card, earned }
    }
    if (best === null) continue
    const { i, card, earned } = best
    total += earned
    const booking = capBooking(
      catalog,
      {
        ...wallet,
        cards: wallet.cards.map((h, j) =>
          j === i ? withCurrentPicks(card, h, p.date) : h,
        ),
      },
      {
        cardId: card.id,
        merchant: p.description,
        amount: p.amount,
        date: p.date,
        channel: null,
      },
      p.merchant,
      ctx,
    )
    if (booking) wallet = applyBooking(wallet, booking)
  }
  return roundCents(total)
}

function replayed(
  holdings: { card: Card; picks: Picks }[],
  earned: number,
  days: number,
): Replayed {
  const fees = holdings.reduce((sum, h) => sum + annualFee(h.card), 0)
  const share = feeShare(fees, days)
  return {
    cardIds: holdings.map((h) => h.card.id),
    picks: Object.fromEntries(
      holdings
        .filter((h) => Object.keys(h.picks).length > 0)
        .map((h) => [h.card.id, h.picks]),
    ),
    earned,
    annualFees: fees,
    feeShare: share,
    net: roundCents(earned - share),
  }
}

const byNet = (a: Replayed, b: Replayed) =>
  b.net - a.net ||
  a.annualFees - b.annualFees ||
  a.cardIds.join().localeCompare(b.cardIds.join())

// What every card earnrate knows would have earned on the file's purchases,
// each card on its own with the picks that earn the most on them, net of its
// annual fee for the days the file covers; then the best two of them
// together. Welcome offers, spend bonuses and statement credits aren't
// counted, as in the statement check's own replay.
export function bestCardsFor(
  catalog: Catalog,
  wallet: Wallet,
  entries: CardLine[],
  filters: CardFilters = ALL_PERSONAL_CARDS,
): BestCards {
  const work = bestCardsWork(catalog, wallet, entries, filters)
  for (;;) {
    const step = work.next()
    if (step.done) return step.value
  }
}

// The same, a card or a pair at a time, so a page can do it between frames.
export function* bestCardsWork(
  catalog: Catalog,
  wallet: Wallet,
  entries: CardLine[],
  filters: CardFilters = ALL_PERSONAL_CARDS,
): Generator<undefined, BestCards> {
  const dates = entries.map((e) => e.line.date).sort()
  const from = dates[0] ?? ''
  const to = dates.at(-1) ?? ''
  const days = from === '' ? 0 : daysBetween(from, to) + 1
  const purchases = prepare(catalog, entries)
  const base = {
    valuations: wallet.valuations,
    memberships: wallet.memberships,
  }
  const has = paidMemberships(catalog, {
    memberships: wallet.memberships,
    heldCards: wallet.cards.map((c) => c.id),
    merchantIds: purchases.map((p) => p.merchant.merchantId),
  })
  const lines: ResolvedLine[] = [
    ...new Map(
      purchases.map((p) => [
        `${p.merchant.merchantId ?? ''}|${p.merchant.category}|${p.merchant.channel ?? ''}`,
        { label: p.description, monthly: 0, merchant: p.merchant },
      ]),
    ).values(),
  ]
  yield

  const best = (card: Card, memberships: string[]) => {
    let top: Replayed | null = null
    for (const picks of candidatePicks(
      catalog,
      card,
      lines,
      memberships,
      from,
    )) {
      const holding = [{ card, picks }]
      const r = replayed(
        holding,
        replay(catalog, { ...base, memberships }, holding, purchases, from),
        days,
      )
      if (!top || r.earned > top.earned + EPSILON) top = r
    }
    return top ?? replayed([{ card, picks: {} }], 0, days)
  }

  const singles: Replayed[] = []
  const membersOnly: BestCards['membersOnly'] = []
  for (const card of catalog.cards) {
    if (!matchesFilters(card, filters)) continue
    const membership = missingMembership(card, has)
    if (membership === null) singles.push(best(card, wallet.memberships))
    else
      membersOnly.push({
        ...best(card, [...wallet.memberships, membership]),
        membership,
      })
    yield
  }
  singles.sort(byNet)
  membersOnly.sort(byNet)

  const finalists = singles.slice(0, PAIR_SHORTLIST).flatMap((s) => {
    const card = catalog.cards.find((c) => c.id === s.cardIds[0])
    return card ? [{ card, picks: s.picks[card.id] ?? {} }] : []
  })
  let pair: Replayed | null = null
  for (const [i, first] of finalists.entries())
    for (const second of finalists.slice(i + 1)) {
      const holdings = [first, second]
      const r = replayed(
        holdings,
        replay(catalog, base, holdings, purchases, from),
        days,
      )
      if (!pair || byNet(r, pair) < 0) pair = r
      yield
    }
  const top = singles[0]
  return {
    from,
    to,
    days,
    singles,
    pair: pair && top && pair.net > top.net + EPSILON ? pair : null,
    membersOnly,
  }
}
