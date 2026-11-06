import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { bonusDollars } from './bonus.ts'
import { matchesFilters } from './explore.ts'
import { membershipCosts, paidMemberships } from './memberships.ts'
import { inEffect } from './periods.ts'
import { CREDITS_LEFT_OUT, heldName, money, roundCents } from './text.ts'
import { cardValuation } from './valuation.ts'

export type OfferFilters = {
  kind: 'any' | 'cash' | 'points'
  business: boolean // business cards instead of personal ones
  noAnnualFee: boolean
  includeHeld: boolean
}

export type OfferSummary = {
  cardId: string
  cardName: string
  issuer: string
  business: boolean
  currency: string // after pooling with the cards in the wallet
  centsPerUnit: number
  points: number | null
  dollars: number | null
  spend: number
  months: number
  validTo: string | null
  varies: boolean // the amount is the most it can be ("up to")
  note: string | null
  annualFee: number | null
  firstYearFee: number | null // what the first year costs
  bonusValue: number // dollars, at the wallet's point values
  // A membership the card needs that the wallet doesn't pay for (Costco).
  membershipFee: number
  // Why the issuer may not give this offer to this wallet's holder, if so.
  ineligible: string | null
  firstYearValue: number // bonus value minus the first year's fee and membership
  held: boolean
  lastVerified: string
  verifiedBy: string
}

export type OfferComparison = {
  offers: OfferSummary[]
  withoutOffer: string[] // card ids that match the filters but publish no offer
  notes: string[]
}

function ineligibleText(
  catalog: Catalog,
  wallet: Wallet,
  notWith: string[],
): string | null {
  const held = wallet.cards
    .filter((c) => notWith.includes(c.id))
    .map((c) => heldName(catalog, c))
  return held.length === 0
    ? null
    : `Likely not eligible: you hold ${held.join(' and ')}, and the issuer's terms rule out its cardholders.`
}

export const OFFERS_MAY_DIFFER =
  'Yours may differ: issuers test and target offers, so use the one shown to you when you apply.'

type OfferTerms = {
  points?: number | null | undefined
  dollars?: number | null | undefined
  spend: number
  months: number
  varies?: boolean | undefined
}

// "Up to 60,000 Chase Ultimate Rewards after $4,000 in purchases within 3
// months": one wording for the site, the search pages and the CLI.
export function offerTerms(o: OfferTerms, currencyName: string): string {
  const amount =
    o.points !== null && o.points !== undefined
      ? `${o.points.toLocaleString('en-US')} ${currencyName}`
      : money(o.dollars ?? 0)
  const spend =
    o.spend > 0
      ? `after ${money(o.spend)} in purchases within ${String(o.months)} month${o.months === 1 ? '' : 's'}`
      : 'with no spending required'
  return `${o.varies ? 'Up to ' : ''}${amount} ${spend}`
}

export function compareOffers(
  catalog: Catalog,
  wallet: Wallet,
  filters: OfferFilters,
  today: string,
): OfferComparison {
  const held = new Set(wallet.cards.map((c) => c.id))
  const paid = paidMemberships(catalog, {
    memberships: wallet.memberships,
    heldCards: [...held],
  })
  const offers: OfferSummary[] = []
  const withoutOffer: string[] = []
  for (const card of catalog.cards) {
    if (card.network === 'store') continue
    if (!filters.includeHeld && held.has(card.id)) continue
    if (
      !matchesFilters(card, { ...filters, issuer: null, includeClosed: true })
    )
      continue

    const offer = card.welcome_offer
    if (!offer || !inEffect(offer, today)) {
      withoutOffer.push(card.id)
      continue
    }
    const valuation = cardValuation(catalog, wallet, card)
    const value =
      bonusDollars(card, valuation.centsPerUnit, offer.points, offer.dollars) ??
      0
    const firstYearFee = card.first_year_fee ?? card.annual_fee ?? null
    const membershipFee =
      membershipCosts(catalog, [card], paid)[0]?.annualFee ?? 0
    offers.push({
      cardId: card.id,
      cardName: card.name,
      issuer: card.issuer,
      business: card.business,
      currency: valuation.currency,
      centsPerUnit: valuation.centsPerUnit,
      points: offer.points ?? null,
      dollars: offer.dollars ?? null,
      spend: offer.spend,
      months: offer.months,
      validTo: offer.valid_to ?? null,
      varies: offer.varies === true,
      note: offer.note ?? null,
      annualFee: card.annual_fee ?? null,
      firstYearFee,
      bonusValue: roundCents(value),
      membershipFee,
      ineligible: ineligibleText(catalog, wallet, offer.not_with ?? []),
      firstYearValue: roundCents(value - (firstYearFee ?? 0) - membershipFee),
      held: held.has(card.id),
      lastVerified: card.last_verified,
      verifiedBy: card.verified_by,
    })
  }
  offers.sort(
    (a, b) =>
      Number(a.ineligible !== null) - Number(b.ineligible !== null) ||
      b.firstYearValue - a.firstYearValue ||
      a.cardId.localeCompare(b.cardId),
  )

  const notes = [
    `Compares the ${String(catalog.cards.length)} cards earnrate knows, not every card on the market.`,
    `Each offer is the public one on the issuer's page on the date shown, checked weekly. ${OFFERS_MAY_DIFFER} Issuers also limit who can get a bonus; each card's note says how.`,
    "First-year value is the bonus at your point values minus the first year's annual fee and any membership the card needs that you don't have. It leaves out what the card earns on your spending and any credits or perks.",
    CREDITS_LEFT_OUT,
  ]
  return { offers, withoutOffer, notes }
}
