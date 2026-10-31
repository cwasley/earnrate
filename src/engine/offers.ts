import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { bonusDollars } from './bonus.ts'
import { matchesFilters } from './explore.ts'
import { roundCents } from './text.ts'
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
  firstYearValue: number // bonus value minus the first year's fee
  held: boolean
  lastVerified: string
  verifiedBy: string
}

export type OfferComparison = {
  offers: OfferSummary[]
  withoutOffer: string[] // card ids that match the filters but publish no offer
  notes: string[]
}

export function compareOffers(
  catalog: Catalog,
  wallet: Wallet,
  filters: OfferFilters,
  today: string,
): OfferComparison {
  const held = new Set(wallet.cards.map((c) => c.id))
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
    if (!offer || (offer.valid_to !== undefined && offer.valid_to < today)) {
      withoutOffer.push(card.id)
      continue
    }
    const valuation = cardValuation(catalog, wallet, card)
    const value =
      bonusDollars(card, valuation.centsPerUnit, offer.points, offer.dollars) ??
      0
    const firstYearFee = card.first_year_fee ?? card.annual_fee ?? null
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
      firstYearValue: roundCents(value - (firstYearFee ?? 0)),
      held: held.has(card.id),
      lastVerified: card.last_verified,
      verifiedBy: card.verified_by,
    })
  }
  offers.sort(
    (a, b) =>
      b.firstYearValue - a.firstYearValue || a.cardId.localeCompare(b.cardId),
  )

  const notes = [
    `Compares the ${String(catalog.cards.length)} cards earnrate knows, not every card on the market.`,
    "Each offer is the public one on the issuer's page on the date shown, checked weekly. Yours may differ: issuers test and target offers, so use the one shown to you when you apply. Issuers also limit who can get a bonus; each card's note says how.",
    "First-year value is the bonus at your point values minus the first year's annual fee. It leaves out what the card earns on your spending and any credits or perks.",
  ]
  return { offers, withoutOffer, notes }
}
