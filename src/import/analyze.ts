import { bonusStatus, countsTowardBonus } from '../engine/bonus.ts'
import { HALF_CENT } from '../engine/compare.ts'
import { capByKey, categoryMatches, usableAt } from '../engine/evaluate.ts'
import { milestoneProgress } from '../engine/milestones.ts'
import { periodKey } from '../engine/periods.ts'
import { recommend } from '../engine/recommend.ts'
import {
  applyBooking,
  applyCreditBooking,
  capBooking,
  creditBooking,
  type CapBooking,
  type CreditBooking,
} from '../engine/record.ts'
import { roundCents } from '../engine/text.ts'
import type { MerchantResolution, Purchase } from '../engine/types.ts'
import { resolveMerchant, withCallerCategory } from '../merchants/resolve.ts'
import type { Milestone } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import {
  cleanDescriptor,
  descriptorNames,
  type StatementLine,
} from './statement.ts'

export type CardLine = { cardId: string; line: StatementLine }

export type CardTotals = {
  cardId: string
  purchases: number
  spend: number
  earned: number
}

export type MissedRewards = {
  merchant: string
  usedCardId: string
  // Unknown merchant, so its category came from the statement, which another
  // issuer may code differently.
  categoryFromStatement: boolean
  count: number
  spend: number
  earned: number // on the card used
  best: number // on earnrate's pick
  bestCardId: string
  bestCard: string
}

// A purchase on a card earnrate's data says the store doesn't take. The
// statement shows it did, so the purchase counts on both sides.
export type NotTaken = {
  merchant: string
  cardId: string
  count: number
  spend: number
}

export type CodingMismatch = {
  merchant: string
  earnrateCategory: string
  issuerCategory: string
  count: number
}

export type BonusProgress = {
  cardId: string
  opened: string
  before: number
  after: number
  spend: number
  deadline: string | null
  entries: CardLine[] // purchases and refunds counted toward it
}

// Every purchase on a card counts toward each of its spend milestones in the
// current period; refunds lower the total.
export type MilestoneImport = {
  cardId: string
  milestoneId: string
  period: string
  periodKind: Milestone['period']
  spend: number
  before: number
  after: number
  entries: CardLine[]
}

export type RecordKind = 'cap' | 'bonus' | 'milestone' | 'credit'

export type StatementAnalysis = {
  from: string
  to: string
  purchases: number
  spend: number
  refunds: number // dollars, positive
  earned: number
  best: number
  byCard: CardTotals[]
  missed: MissedRewards[]
  coding: CodingMismatch[]
  notTaken: NotTaken[]
  bookings: (CardLine & { booking: CapBooking })[]
  // Enrolled statement credits used this period, like record_purchase books.
  credits: (CardLine & { booking: CreditBooking })[]
  outsideCurrentPeriod: number // capped purchases from an earlier period
  alreadyImported: number // capped purchases an earlier import recorded
  bonuses: BonusProgress[]
  milestones: MilestoneImport[]
}

export function resolveLine(
  catalog: Catalog,
  line: StatementLine,
): { name: string; merchant: MerchantResolution; known: MerchantResolution } {
  const names = descriptorNames(line.description)
  let known = resolveMerchant(catalog, names[0] ?? '', null)
  for (const n of names.slice(1)) {
    if (known.source !== 'none') break
    const retry = resolveMerchant(catalog, n, null)
    if (retry.source !== 'none') known = retry
  }
  const cleaned = cleanDescriptor(line.description)
  const head = cleaned.split('*')[0]?.trim() ?? ''
  const merchant = withCallerCategory(known, line.category)
  const name =
    known.source === 'none'
      ? (head || cleaned)
          .replace(/#\S*/g, '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join(' ')
      : known.resolvedName
  return { name, merchant, known }
}

function capPeriodKey(
  catalog: Catalog,
  wallet: Wallet,
  booking: CapBooking,
  date: string,
): string | null {
  const card = catalog.cards.find((c) => c.id === booking.cardId)
  const held = wallet.cards.find((c) => c.id === booking.cardId)
  const cap = card && capByKey(card, booking.capKey)
  if (!cap) return null
  return periodKey(cap.period, date, held?.anniversary ?? null)
}

// Replays the statements twice: once on the cards actually used, once on
// earnrate's picks, each with its own running cap usage, so a cap that fills
// up partway through the year is accounted for on both sides.
export function analyzeStatement(
  catalog: Catalog,
  wallet: Wallet,
  entries: CardLine[],
  today: string,
  alreadyRecorded: (entry: CardLine, kind: RecordKind) => boolean = () => false,
): StatementAnalysis {
  const sorted = [...entries].sort((a, b) =>
    a.line.date.localeCompare(b.line.date),
  )
  // The earned-versus-best replay leaves spend milestones out: they pay once
  // on the card's total, whichever card is best for each purchase.
  const replay: Wallet = {
    ...wallet,
    cards: wallet.cards.map(({ milestone_usage: _usage, ...c }) => c),
  }
  let actual = replay
  let simulated = replay
  let current = wallet
  const byCard = new Map<string, CardTotals>()
  const missed = new Map<string, MissedRewards>()
  const coding = new Map<string, CodingMismatch>()
  const notTaken = new Map<string, NotTaken>()
  const bookings: StatementAnalysis['bookings'] = []
  const credits: StatementAnalysis['credits'] = []
  let outsideCurrentPeriod = 0
  let alreadyImported = 0
  let purchases = 0
  let spend = 0
  let refunds = 0
  let earned = 0
  let best = 0

  const bonuses = new Map<string, BonusProgress>()
  for (const held of wallet.cards) {
    const status = bonusStatus(catalog, wallet, held, today)
    if (status && status.spend !== null)
      bonuses.set(held.id, {
        cardId: held.id,
        opened: status.opened,
        before: status.spent,
        after: status.spent,
        spend: status.spend,
        deadline: status.deadline,
        entries: [],
      })
  }

  const milestones: MilestoneImport[] = []
  for (const held of wallet.cards) {
    const card = catalog.cards.find((c) => c.id === held.id)
    if (!card) continue
    for (const p of milestoneProgress(card, held, today))
      if (p.period !== null)
        milestones.push({
          cardId: held.id,
          milestoneId: p.milestone.id,
          period: p.period,
          periodKind: p.milestone.period,
          spend: p.milestone.spend,
          before: p.spent,
          after: p.spent,
          entries: [],
        })
  }

  for (const entry of sorted) {
    const { cardId, line } = entry
    if (!alreadyRecorded(entry, 'milestone')) {
      const held = wallet.cards.find((c) => c.id === cardId)
      for (const m of milestones) {
        if (m.cardId !== cardId) continue
        const card = catalog.cards.find((c) => c.id === cardId)
        const milestone = card?.milestones.find((x) => x.id === m.milestoneId)
        if (
          !milestone ||
          periodKey(milestone.period, line.date, held?.anniversary ?? null) !==
            m.period
        )
          continue
        m.after = roundCents(Math.max(0, m.after + line.amount))
        m.entries.push(entry)
      }
    }
    const progress = bonuses.get(cardId)
    if (
      progress &&
      countsTowardBonus(progress, line.date) &&
      !alreadyRecorded(entry, 'bonus')
    ) {
      progress.after = roundCents(Math.max(0, progress.after + line.amount))
      progress.entries.push(entry)
    }
    const { name, merchant, known } = resolveLine(catalog, line)
    const recorded = {
      cardId,
      merchant: line.description,
      amount: Math.abs(line.amount),
      date: line.date,
      channel: null,
    }

    const booking = capBooking(catalog, current, recorded, merchant)
    if (booking) {
      if (alreadyRecorded(entry, 'cap')) {
        alreadyImported++
      } else if (
        capPeriodKey(catalog, current, booking, today) === booking.period
      ) {
        const signed =
          line.amount < 0
            ? {
                ...booking,
                after: roundCents(Math.max(0, booking.before + line.amount)),
              }
            : booking
        bookings.push({ ...entry, booking: signed })
        current = applyBooking(current, signed)
      } else {
        outsideCurrentPeriod++
      }
    }

    if (line.amount > 0 && !alreadyRecorded(entry, 'credit')) {
      const credit = creditBooking(catalog, current, recorded, merchant)
      const held = current.cards.find((c) => c.id === cardId)
      if (
        credit &&
        periodKey(credit.periodKind, today, held?.anniversary ?? null) ===
          credit.period
      ) {
        credits.push({ ...entry, booking: credit })
        current = applyCreditBooking(current, credit)
      }
    }

    if (line.amount < 0) {
      refunds += -line.amount
      continue
    }
    purchases++
    spend += line.amount
    const totals = byCard.get(cardId) ?? {
      cardId,
      purchases: 0,
      spend: 0,
      earned: 0,
    }
    totals.purchases++
    totals.spend += line.amount
    byCard.set(cardId, totals)

    const issuer = line.category
    if (
      known.source !== 'none' &&
      issuer !== null &&
      issuer !== 'other' &&
      !categoryMatches(issuer, known.category) &&
      !categoryMatches(known.category, issuer)
    ) {
      const mismatch = coding.get(name) ?? {
        merchant: name,
        earnrateCategory: known.category,
        issuerCategory: line.issuerCategory ?? '',
        count: 0,
      }
      mismatch.count++
      coding.set(name, mismatch)
    }

    const card = catalog.cards.find((c) => c.id === cardId)
    const network =
      card && !card.only_at && card.network !== 'store' ? card.network : null
    const refused =
      card !== undefined && network !== null && !usableAt(card, merchant)
    // The statement shows the store took the card's network here.
    const took: MerchantResolution =
      refused && merchant.accepts
        ? { ...merchant, accepts: [...merchant.accepts, network] }
        : merchant
    if (refused) {
      const key = `${name}|${cardId}`
      const entry = notTaken.get(key) ?? {
        merchant: name,
        cardId,
        count: 0,
        spend: 0,
      }
      entry.count++
      entry.spend += line.amount
      notTaken.set(key, entry)
    }

    const purchase: Purchase = {
      merchant: line.description,
      amount: line.amount,
      channel: null,
      date: line.date,
      country: 'US',
    }
    // Past statements don't say which credits were used, so they're left out.
    const used = recommend(catalog, actual, purchase, took, {
      credits: false,
    }).ranked.find((r) => r.cardId === cardId)
    const top = recommend(catalog, simulated, purchase, took, {
      credits: false,
    }).ranked[0]
    if (!used || !top) continue
    earned += used.earned ?? 0
    best += top.earned ?? 0
    totals.earned += used.earned ?? 0

    const usedBooking = capBooking(catalog, actual, recorded, merchant)
    if (usedBooking) actual = applyBooking(actual, usedBooking)
    const topBooking = capBooking(
      catalog,
      simulated,
      { ...recorded, cardId: top.cardId },
      merchant,
    )
    if (topBooking) simulated = applyBooking(simulated, topBooking)

    const gain = (top.earned ?? 0) - (used.earned ?? 0)
    if (top.cardId !== cardId && gain > HALF_CENT) {
      const key = `${name}|${cardId}|${top.cardId}`
      const miss = missed.get(key) ?? {
        merchant: name,
        usedCardId: cardId,
        categoryFromStatement:
          known.source === 'none' && merchant.source === 'caller',
        count: 0,
        spend: 0,
        earned: 0,
        best: 0,
        bestCardId: top.cardId,
        bestCard: top.checkoutLabel ?? top.cardName,
      }
      miss.count++
      miss.spend += line.amount
      miss.earned += used.earned ?? 0
      miss.best += top.earned ?? 0
      missed.set(key, miss)
    }
  }

  return {
    from: sorted[0]?.line.date ?? '',
    to: sorted.at(-1)?.line.date ?? '',
    purchases,
    spend: roundCents(spend),
    refunds: roundCents(refunds),
    earned: roundCents(earned),
    best: roundCents(best),
    byCard: [...byCard.values()].map((t) => ({
      ...t,
      spend: roundCents(t.spend),
      earned: roundCents(t.earned),
    })),
    missed: [...missed.values()]
      .map((m) => ({
        ...m,
        spend: roundCents(m.spend),
        earned: roundCents(m.earned),
        best: roundCents(m.best),
      }))
      .sort((a, b) => b.best - b.earned - (a.best - a.earned)),
    coding: [...coding.values()].sort((a, b) => b.count - a.count),
    notTaken: [...notTaken.values()]
      .map((n) => ({ ...n, spend: roundCents(n.spend) }))
      .sort((a, b) => b.spend - a.spend),
    bookings,
    credits,
    outsideCurrentPeriod,
    alreadyImported,
    bonuses: [...bonuses.values()].filter((b) => b.entries.length > 0),
    milestones: milestones.filter((m) => m.entries.length > 0),
  }
}
