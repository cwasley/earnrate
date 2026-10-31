import type { Catalog } from '../schema/catalog.ts'
import { bonusStatus, countsTowardBonus } from '../engine/bonus.ts'
import { categoryMatches } from '../engine/evaluate.ts'
import { periodKey } from '../engine/periods.ts'
import { applyBooking, capBooking, type CapBooking } from '../engine/record.ts'
import { recommend } from '../engine/recommend.ts'
import type { MerchantResolution, Purchase } from '../engine/types.ts'
import { resolveMerchant, withCallerCategory } from '../merchants/resolve.ts'
import type { Wallet } from '../schema/wallet.ts'
import { cleanDescriptor, type StatementLine } from './statement.ts'

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

export type RecordKind = 'cap' | 'bonus'

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
  bookings: (CardLine & { booking: CapBooking })[]
  outsideCurrentPeriod: number // capped purchases from an earlier period
  alreadyImported: number // capped purchases an earlier import recorded
  bonuses: BonusProgress[]
}

const round = (n: number) => Math.round(n * 100) / 100

function resolveLine(
  catalog: Catalog,
  line: StatementLine,
): { name: string; merchant: MerchantResolution; known: MerchantResolution } {
  const cleaned = cleanDescriptor(line.description)
  // "NAME-CHEAP.COM* LV0I6X": the part before the asterisk names the merchant.
  const head = cleaned.split('*')[0]?.trim() ?? ''
  let known = resolveMerchant(catalog, cleaned, null)
  if (known.source === 'none' && head !== '' && head !== cleaned) {
    const retry = resolveMerchant(catalog, head, null)
    if (retry.source !== 'none') known = retry
  }
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
  const shared = card?.caps.find((c) => c.id === booking.capKey)
  const inline = card?.rules.find((r) => r.id === booking.capKey)?.cap
  const period =
    shared?.period ?? (typeof inline === 'object' ? inline.period : undefined)
  if (!period) return null
  return periodKey(period, date, held?.anniversary ?? null)
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
  let actual = wallet
  let simulated = wallet
  let current = wallet
  const byCard = new Map<string, CardTotals>()
  const missed = new Map<string, MissedRewards>()
  const coding = new Map<string, CodingMismatch>()
  const bookings: StatementAnalysis['bookings'] = []
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

  for (const entry of sorted) {
    const { cardId, line } = entry
    const progress = bonuses.get(cardId)
    if (
      progress &&
      countsTowardBonus(progress, line.date) &&
      !alreadyRecorded(entry, 'bonus')
    ) {
      progress.after = round(Math.max(0, progress.after + line.amount))
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
                after: round(Math.max(0, booking.before + line.amount)),
              }
            : booking
        bookings.push({ ...entry, booking: signed })
        current = applyBooking(current, signed)
      } else {
        outsideCurrentPeriod++
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

    const purchase: Purchase = {
      merchant: line.description,
      amount: line.amount,
      channel: null,
      date: line.date,
      country: 'US',
    }
    const used = recommend(catalog, actual, purchase, merchant).ranked.find(
      (r) => r.cardId === cardId,
    )
    const top = recommend(catalog, simulated, purchase, merchant).ranked[0]
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
    if (top.cardId !== cardId && gain > 0.005) {
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
    spend: round(spend),
    refunds: round(refunds),
    earned: round(earned),
    best: round(best),
    byCard: [...byCard.values()].map((t) => ({
      ...t,
      spend: round(t.spend),
      earned: round(t.earned),
    })),
    missed: [...missed.values()]
      .map((m) => ({
        ...m,
        spend: round(m.spend),
        earned: round(m.earned),
        best: round(m.best),
      }))
      .sort((a, b) => b.best - b.earned - (a.best - a.earned)),
    coding: [...coding.values()].sort((a, b) => b.count - a.count),
    bookings,
    outsideCurrentPeriod,
    alreadyImported,
    bonuses: [...bonuses.values()].filter((b) => b.entries.length > 0),
  }
}
