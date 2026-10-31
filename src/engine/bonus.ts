import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { daysBetween } from './periods.ts'
import { cardValuation } from './valuation.ts'
import { roundCents } from './text.ts'

export type BonusStatus = {
  cardId: string
  opened: string
  spent: number
  // null when neither the card's published offer nor the wallet says
  spend: number | null
  deadline: string | null
  remaining: number | null
  daysLeft: number | null
  value: number | null // dollars, at the wallet's point values
  state: 'open' | 'met' | 'expired' | 'incomplete'
}

// "Within 3 months of opening": the same day of the month, three months on,
// or the month's last day when that day doesn't exist (Nov 30 + 3 → Feb 28).
export function addMonths(date: string, months: number): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  const total = m - 1 + months
  const year = y + Math.floor(total / 12)
  const month = (total % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(d, last)
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// A welcome bonus in dollars at the given point value; null when it has
// neither points nor dollars.
export function bonusDollars(
  card: Card,
  centsPerUnit: number,
  points: number | undefined,
  dollars: number | undefined,
): number | null {
  if (points !== undefined) return (points * centsPerUnit) / 100
  if (dollars === undefined) return null
  // A cash back card's bonus is paid like its rewards, so it pools when they
  // do; a points card's dollar bonus is a statement credit.
  return card.currency === 'cash' ? dollars * centsPerUnit : dollars
}

export function bonusStatus(
  catalog: Catalog,
  wallet: Wallet,
  held: WalletCard,
  today: string,
): BonusStatus | null {
  const bonus = held.bonus
  if (!bonus) return null
  const card = catalog.cards.find((c) => c.id === held.id)
  if (!card) return null
  const offer = card.welcome_offer

  const spend = bonus.spend ?? offer?.spend ?? null
  const deadline =
    bonus.by ?? (offer ? addMonths(bonus.opened, offer.months) : null)

  const valuation = cardValuation(catalog, wallet, card)
  const points =
    bonus.points ?? (bonus.dollars === undefined ? offer?.points : undefined)
  const dollars =
    bonus.dollars ?? (bonus.points === undefined ? offer?.dollars : undefined)
  const value = bonusDollars(card, valuation.centsPerUnit, points, dollars)

  const base = {
    cardId: held.id,
    opened: bonus.opened,
    spent: bonus.spent,
    spend,
    deadline,
    value: value === null ? null : roundCents(value),
  }
  if (spend === null || deadline === null) {
    return {
      ...base,
      remaining: null,
      daysLeft: null,
      state: 'incomplete',
    }
  }
  const remaining = roundCents(Math.max(0, spend - bonus.spent))
  const daysLeft = daysBetween(today, deadline)
  return {
    ...base,
    remaining,
    daysLeft,
    state: remaining === 0 ? 'met' : daysLeft < 0 ? 'expired' : 'open',
  }
}

// Whether a purchase on this date counts toward the bonus.
export function countsTowardBonus(
  window: Pick<BonusStatus, 'opened' | 'deadline'>,
  date: string,
): boolean {
  return (
    date >= window.opened &&
    (window.deadline === null || date <= window.deadline)
  )
}
