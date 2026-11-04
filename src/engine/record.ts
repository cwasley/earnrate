import { resolveMerchant } from '../merchants/resolve.ts'
import type { Cap, Milestone } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { bonusStatus, countsTowardBonus } from './bonus.ts'
import { evaluateCard, purchaseContext } from './evaluate.ts'
import { milestoneProgress } from './milestones.ts'
import { roundCents } from './text.ts'
import type { MerchantResolution, RecordedPurchase } from './types.ts'

export type CapBooking = {
  cardId: string
  capKey: string // shared cap id, or the rule id for an inline cap
  ruleId: string
  period: string
  periodKind: Cap['period']
  capAmount: number
  before: number // dollars spent this period before the purchase
  after: number
}

// Books the spend against the cap of the highest-rate rule that matches, even
// when that cap is already used up, so usage stays accurate across a reset.
// Returns null when there's nothing to track: no cap, or a cardmember-year cap
// on a card with no anniversary.
export function capBooking(
  catalog: Catalog,
  wallet: Wallet,
  purchase: RecordedPurchase,
  merchant: MerchantResolution = resolveMerchant(
    catalog,
    purchase.merchant,
    purchase.channel,
  ),
): CapBooking | null {
  const held = wallet.cards.find((c) => c.id === purchase.cardId)
  if (!held) throw new Error(`${purchase.cardId} isn't in the wallet`)
  const card = catalog.cards.find((c) => c.id === purchase.cardId)
  if (!card) throw new Error(`${purchase.cardId} isn't in the card catalog`)

  const ctx = purchaseContext(catalog, wallet, merchant, merchant.category, {
    amount: purchase.amount,
    date: purchase.date,
    country: 'US',
  })
  const { cap, rule } = evaluateCard(card, held, ctx).nominal
  if (!cap || !rule || cap.period === null) return null

  const previous = held.cap_usage[cap.key]
  const before = previous?.period === cap.period ? previous.spent : 0
  return {
    cardId: card.id,
    capKey: cap.key,
    ruleId: rule.id,
    period: cap.period,
    periodKind: cap.cap.period,
    capAmount: cap.cap.amount,
    before,
    after: roundCents(before + purchase.amount),
  }
}

export function applyBooking(wallet: Wallet, booking: CapBooking): Wallet {
  return {
    ...wallet,
    cards: wallet.cards.map((c) =>
      c.id === booking.cardId
        ? {
            ...c,
            cap_usage: {
              ...c.cap_usage,
              [booking.capKey]: {
                period: booking.period,
                spent: booking.after,
              },
            },
          }
        : c,
    ),
  }
}

export type BonusBooking = {
  cardId: string
  before: number // dollars toward the welcome bonus before the purchase
  after: number
  spend: number
  deadline: string | null
}

// The purchase's progress toward the card's open welcome bonus, if it counts.
function bonusBooking(
  catalog: Catalog,
  wallet: Wallet,
  purchase: RecordedPurchase,
): BonusBooking | null {
  const held = wallet.cards.find((c) => c.id === purchase.cardId)
  const status = held ? bonusStatus(catalog, wallet, held, purchase.date) : null
  if (
    !status ||
    status.spend === null ||
    (status.remaining ?? 0) <= 0 ||
    !countsTowardBonus(status, purchase.date)
  )
    return null
  return {
    cardId: purchase.cardId,
    before: status.spent,
    after: roundCents(status.spent + purchase.amount),
    spend: status.spend,
    deadline: status.deadline,
  }
}

export function applyBonusBooking(
  wallet: Wallet,
  b: Pick<BonusBooking, 'cardId' | 'after'>,
): Wallet {
  return {
    ...wallet,
    cards: wallet.cards.map((c) =>
      c.id === b.cardId && c.bonus
        ? { ...c, bonus: { ...c.bonus, spent: b.after } }
        : c,
    ),
  }
}

export type MilestoneBooking = {
  cardId: string
  milestoneId: string
  period: string
  periodKind: Milestone['period']
  spend: number // the milestone's total
  before: number // tracked dollars this period before the purchase
  after: number
}

// Every purchase on a card counts toward each of its spend milestones. None
// for a cardmember-year milestone on a card with no anniversary.
export function milestoneBookings(
  catalog: Catalog,
  wallet: Wallet,
  purchase: RecordedPurchase,
): MilestoneBooking[] {
  const held = wallet.cards.find((c) => c.id === purchase.cardId)
  const card = catalog.cards.find((c) => c.id === purchase.cardId)
  if (!held || !card) return []
  return milestoneProgress(card, held, purchase.date).flatMap((p) =>
    p.period === null
      ? []
      : [
          {
            cardId: card.id,
            milestoneId: p.milestone.id,
            period: p.period,
            periodKind: p.milestone.period,
            spend: p.milestone.spend,
            before: p.spent,
            after: roundCents(Math.max(0, p.spent + purchase.amount)),
          },
        ],
  )
}

export function applyMilestoneBooking(
  wallet: Wallet,
  b: Pick<MilestoneBooking, 'cardId' | 'milestoneId' | 'period' | 'after'>,
): Wallet {
  return {
    ...wallet,
    cards: wallet.cards.map((c) =>
      c.id === b.cardId
        ? {
            ...c,
            milestone_usage: {
              ...c.milestone_usage,
              [b.milestoneId]: { period: b.period, spent: b.after },
            },
          }
        : c,
    ),
  }
}

export type BookedPurchase = {
  wallet: Wallet
  cap: CapBooking | null
  bonus: BonusBooking | null
  milestones: MilestoneBooking[]
}

export function bookPurchase(
  catalog: Catalog,
  wallet: Wallet,
  purchase: RecordedPurchase,
  merchant?: MerchantResolution,
): BookedPurchase {
  const cap = capBooking(catalog, wallet, purchase, merchant)
  const bonus = bonusBooking(catalog, wallet, purchase)
  const milestones = milestoneBookings(catalog, wallet, purchase)
  let next = cap ? applyBooking(wallet, cap) : wallet
  if (bonus) next = applyBonusBooking(next, bonus)
  for (const m of milestones) next = applyMilestoneBooking(next, m)
  return { wallet: next, cap, bonus, milestones }
}
