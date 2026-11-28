// Every card's public welcome offer ranked from no cards, for earnrate.dev's
// /welcome-offers pages: the bonus at earnrate's default point values less
// the first year's fee, the same bonus at transfer value where the points
// transfer, which offers a planned amount of spending unlocks, and which of
// two cards to open first so both bonuses stay possible. Node-free.
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import { bonusDollars } from './bonus.ts'
import { TRANSFER_VALUES } from './fee-worth.ts'
import { compareOffers, type OfferSummary } from './offers.ts'
import { inEffect } from './periods.ts'
import {
  capitalize,
  listed,
  possessive,
  roundCents,
  shortCardName,
} from './text.ts'

export type RankedOffer = OfferSummary & {
  // The membership the card needs, when the ranking is for someone without
  // it; null for a card anyone can get.
  membership: string | null
  // The bonus at transfer value (Amex and Chase points), and that value.
  transfer: { cents: number; value: number; firstYearValue: number } | null
}

const EMPTY = { valuations: {}, memberships: [], cards: [] }

// Highest first-year value first, then the higher bonus, then by name.
export const firstYearOrder = (a: RankedOffer, b: RankedOffer) =>
  b.firstYearValue - a.firstYearValue ||
  b.bonusValue - a.bonusValue ||
  a.cardName.localeCompare(b.cardName)

// Personal and business offers apart, each ranked on the bonus less the
// first year's fee, with cards that need a membership in place (they say
// which). Cards closed to applicants are left out.
export function rankedOffers(
  catalog: Catalog,
  today: string,
): { personal: RankedOffer[]; business: RankedOffer[] } {
  const cards = new Map(catalog.cards.map((c) => [c.id, c]))
  const ranked = (business: boolean) => {
    const { offers, membersOnly } = compareOffers(
      catalog,
      EMPTY,
      { kind: 'any', business, noAnnualFee: false, includeHeld: true },
      today,
    )
    return [...offers.map((o) => ({ ...o, membership: null })), ...membersOnly]
      .filter((o) => cards.get(o.cardId)?.applications_closed === undefined)
      .map((o): RankedOffer => {
        const card = cards.get(o.cardId)
        const cents = TRANSFER_VALUES[o.currency]
        const value =
          card === undefined || cents === undefined
            ? null
            : bonusDollars(
                card,
                cents,
                o.points ?? undefined,
                o.dollars ?? undefined,
              )
        return {
          ...o,
          transfer:
            cents === undefined || value === null
              ? null
              : {
                  cents,
                  value: roundCents(value),
                  firstYearValue: roundCents(value - (o.firstYearFee ?? 0)),
                },
        }
      })
      .sort(firstYearOrder)
  }
  return { personal: ranked(false), business: ranked(true) }
}

// Whether `total` dollars, spent the same amount each month over
// `overMonths` months, reaches an offer's minimum inside its own window
// (which starts the day the account opens). No minimum is always reached.
export function reachesMinimum(
  offer: { spend: number; months: number },
  total: number,
  overMonths: number,
): boolean {
  if (offer.spend <= 0) return total > 0
  if (total <= 0 || overMonths <= 0) return false
  const byDeadline = (total * Math.min(offer.months, overMonths)) / overMonths
  return byDeadline + 1e-9 >= offer.spend
}

// The picker's taps: about how much goes on the new card, and over how many
// months.
export const PICKER_AMOUNTS = [1000, 2500, 5000, 10000, 15000, 25000]
export const PICKER_MONTHS = [1, 3, 6, 12]

export const pickerKey = (total: number, months: number) =>
  `${String(total)}-${String(months)}`

// The picker's keys an offer is unlocked at, for the page's script to match.
export const unlockedAt = (offer: { spend: number; months: number }) =>
  PICKER_AMOUNTS.flatMap((total) =>
    PICKER_MONTHS.filter((m) => reachesMinimum(offer, total, m)).map((m) =>
      pickerKey(total, m),
    ),
  )

export const EVEN_SPENDING =
  'This assumes the same amount each month, all on the new card, and counts an offer when its minimum is reached inside its own window.'

export const FROM_OPENING =
  'Each window starts the day the account opens, and only purchases from then on count toward the minimum.'

// "Open the Amex Gold before the Amex Platinum": one card's offer names
// another whose holders (or past holders) may not get it, and the other's
// offer doesn't name it back. Opening the named one second keeps both
// bonuses possible under the rules the issuers publish.
export type OpenFirst = {
  first: string // card id
  then: string[] // card ids, in catalog order
  // Why, one sentence per reason: holding the other card, or having had it.
  reasons: string[]
}

const names = (card: Card): Set<string> =>
  new Set([
    ...(card.welcome_offer?.not_with ?? []),
    ...(card.welcome_offer?.repeat?.also ?? []),
  ])

// Every such pair among cards with a public offer open to applicants,
// grouped by the card to open first. Two cards that name each other get no
// note: either order costs one bonus.
export function openFirst(catalog: Catalog, today: string): OpenFirst[] {
  const open = catalog.cards.filter(
    (c) =>
      c.applications_closed === undefined &&
      c.welcome_offer !== undefined &&
      inEffect(c.welcome_offer, today),
  )
  const byId = new Map(open.map((c) => [c.id, c]))
  const issuer = (card: Card) =>
    catalog.issuers.find((i) => i.id === card.issuer)?.name ?? card.issuer
  const short = (id: string) => shortCardName(byId.get(id)?.name ?? id)
  const result: OpenFirst[] = []
  for (const card of open) {
    const offer = card.welcome_offer
    if (!offer) continue
    const then = [...names(card)].filter((id) => {
      const other = byId.get(id)
      return other !== undefined && !names(other).has(card.id)
    })
    if (then.length === 0) continue
    const had = then.filter((id) => offer.repeat?.also?.includes(id))
    const holding = then.filter(
      (id) => offer.not_with?.includes(id) && !had.includes(id),
    )
    const may = offer.repeat?.may === true
    const these = (ids: string[]) => `the ${listed(ids.map(short), 'or')}`
    const mine = `the ${possessive(short(card.id))}`
    const reasons = [
      had.length > 0
        ? `${issuer(card)} says ${mine} bonus ${may ? 'may not be' : "isn't"} available if you have or have had ${these(had)}.`
        : null,
      holding.length > 0
        ? `${possessive(issuer(card))} terms rule out holders of ${these(holding)} from ${mine} offer.`
        : null,
      then.length === 1
        ? `${capitalize(possessive(these(then)))} offer doesn't name the ${short(card.id)}.`
        : `Their offers don't name the ${short(card.id)}.`,
    ].filter((r) => r !== null)
    result.push({ first: card.id, then, reasons })
  }
  return result
}
