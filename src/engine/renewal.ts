import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { ALL_PERSONAL_CARDS, matchesFilters } from './explore.ts'
import { nightStates, usedCreditsYear } from './credits.ts'
import { daysBetween, isAnniversary } from './periods.ts'
import {
  projectedWallet,
  simulateSingles,
  simulateWallet,
  typicalSpendLines,
  type ResolvedLine,
} from './simulate.ts'
import { roundCents, shortCardName } from './text.ts'

// Node-free: earnrate.dev runs it in the browser.

// A fee card shows up this many days before its anniversary, and stays
// until this many after: the fee posts on the statement after it.
export const RENEWAL_BEFORE = 30
export const RENEWAL_AFTER = 15

// The card's anniversary as MM-DD: the saved one, or from the day it opened.
export function anniversaryOf(held: WalletCard): string | null {
  return (
    held.anniversary ?? (held.opened ?? held.bonus?.opened)?.slice(5) ?? null
  )
}

const openedOf = (held: WalletCard) => held.opened ?? held.bonus?.opened ?? null

// A real date for MM-DD in `year`: Feb 29 falls on Feb 28 in other years.
function onYear(year: number, mmdd: string): string {
  const date = `${String(year)}-${mmdd}`
  if (mmdd !== '02-29') return date
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return leap ? date : `${String(year)}-02-28`
}

// The renewal date near `today`, from RENEWAL_BEFORE days ahead back to
// RENEWAL_AFTER days past; null outside that, without an anniversary, or
// before the account's first year is nearly over.
export function renewalDue(held: WalletCard, today: string): string | null {
  const mmdd = anniversaryOf(held)
  if (mmdd === null || !isAnniversary(mmdd)) return null
  const opened = openedOf(held)
  const year = Number(today.slice(0, 4))
  for (const y of [year - 1, year, year + 1]) {
    const due = onYear(y, mmdd)
    const days = daysBetween(today, due)
    if (days > RENEWAL_BEFORE || days < -RENEWAL_AFTER) continue
    if (opened !== null && daysBetween(opened, due) < 300) continue
    return due
  }
  return null
}

export type Spending = {
  lines: ResolvedLine[]
  typical: boolean // rough U.S. amounts, not the person's own
}

export type Renewal = {
  cardId: string
  due: string // YYYY-MM-DD, approximate
  fee: number // the yearly fee that's coming
  // The first year's lower fee, when this renewal is the first at the full one.
  firstYearFee: number | null
  // What the wallet earns a year with the card, beyond what it would without
  // it (its other cards picking up the spending). Alone, against the best
  // no-fee card.
  rewardsAdded: number
  credits: number // its statement credits and free nights the cardholder uses, a year
  freeNights: number // the part of credits from free nights, "up to"
  // Free nights the cardholder hasn't said they use or don't: not in net.
  nightsNotCounted: number
  net: number // rewardsAdded + credits - fee
  against: string | null // the no-fee card compared with, for a card held alone
  typical: boolean
}

// Whether a fee card still pays for itself, for the year after `due`.
export function renewalCheck(
  catalog: Catalog,
  wallet: Wallet,
  card: Card,
  due: string,
  spending: Spending = {
    lines: typicalSpendLines(catalog),
    typical: true,
  },
): Renewal {
  const held = wallet.cards.find((c) => c.id === card.id)
  const projected = projectedWallet(wallet, catalog, due)
  const ids = projected.cards.map((c) => c.id)
  const withCard = simulateWallet(catalog, projected, spending.lines, due, ids)
  const others = projected.cards.filter((c) => c.id !== card.id)
  let without = null
  let against: string | null = null
  if (others.length > 0) {
    without = simulateWallet(
      catalog,
      { ...projected, cards: others },
      spending.lines,
      due,
      ids.filter((id) => id !== card.id),
    )
  } else {
    const noFee = catalog.cards.filter(
      (c) =>
        matchesFilters(c, {
          ...ALL_PERSONAL_CARDS,
          business: card.business,
          noAnnualFee: true,
        }) &&
        c.requires_membership === undefined &&
        c.network !== 'store',
    )
    const [best] = simulateSingles(catalog, noFee, spending.lines, {
      filters: { ...ALL_PERSONAL_CARDS, noAnnualFee: true },
      memberships: wallet.memberships,
      valuations: wallet.valuations,
      start: due,
    })
    if (best) {
      without = best
      const bestId = best.cards[0]?.cardId
      const bestCard = catalog.cards.find((c) => c.id === bestId)
      against = bestCard ? shortCardName(bestCard.name) : null
    }
  }
  // From the saved card: projectedWallet drops credit usage, which is how
  // a credit that needs no enrolling is confirmed in use.
  const used = held
    ? usedCreditsYear(catalog, card, held, due, wallet.valuations)
    : null
  const credits = used?.yearly ?? 0
  const rewardsAdded = roundCents(withCard.rewards - (without?.rewards ?? 0))
  const fee = card.annual_fee ?? 0
  const opened = held ? openedOf(held) : null
  return {
    cardId: card.id,
    due,
    fee,
    firstYearFee:
      opened !== null &&
      daysBetween(opened, due) < 400 &&
      (card.first_year_fee ?? fee) < fee
        ? (card.first_year_fee ?? 0)
        : null,
    rewardsAdded,
    credits,
    freeNights: used?.nights ?? 0,
    nightsNotCounted: roundCents(
      nightStates(catalog, wallet.valuations, card, held ?? null)
        .filter((n) => !n.confirmed && !n.skipped)
        .reduce((sum, n) => sum + n.value, 0),
    ),
    net: roundCents(rewardsAdded + credits - fee),
    against,
    typical: spending.typical,
  }
}
