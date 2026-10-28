import type { Catalog } from '../data/load.ts'
import { resolveMerchant } from '../merchants/resolve.ts'
import type { Wallet } from '../schema/wallet.ts'
import { evaluateCard, purchaseContext } from './evaluate.ts'
import type { MerchantResolution, RecordedPurchase } from './types.ts'

export type CapBooking = {
  cardId: string
  capKey: string // shared cap id, or the rule id for an inline cap
  ruleId: string
  period: string
  capAmount: number
  before: number // dollars spent this period before the purchase
  after: number
}

const roundCents = (n: number) => Math.round(n * 100) / 100

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

export function recordPurchase(
  catalog: Catalog,
  wallet: Wallet,
  purchase: RecordedPurchase,
): Wallet {
  const booking = capBooking(catalog, wallet, purchase)
  return booking ? applyBooking(wallet, booking) : wallet
}
