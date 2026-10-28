import type { Catalog } from '../data/load.ts'
import type { Card } from '../schema/card.ts'
import type { Wallet } from '../schema/wallet.ts'
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

const round = (n: number) => Math.round(n * 100) / 100

function bonusValue(
  card: Card,
  centsPerUnit: number,
  points: number | undefined,
  dollars: number | undefined,
): number {
  if (points !== undefined) return (points * centsPerUnit) / 100
  if (dollars === undefined) return 0
  // A cash back card's bonus is paid like its rewards, so it pools when they
  // do; a points card's dollar bonus is a statement credit.
  return card.currency === 'cash' ? dollars * centsPerUnit : dollars
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
    if (card.business !== filters.business) continue
    if (!filters.includeHeld && held.has(card.id)) continue
    const isCash = card.currency === 'cash'
    if (filters.kind === 'cash' && !isCash) continue
    if (filters.kind === 'points' && isCash) continue
    if (filters.noAnnualFee && card.annual_fee !== 0) continue

    const offer = card.welcome_offer
    if (!offer || (offer.valid_to !== undefined && offer.valid_to < today)) {
      withoutOffer.push(card.id)
      continue
    }
    const valuation = cardValuation(catalog, wallet, card)
    const value = bonusValue(
      card,
      valuation.centsPerUnit,
      offer.points,
      offer.dollars,
    )
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
      note: offer.note ?? null,
      annualFee: card.annual_fee ?? null,
      firstYearFee,
      bonusValue: round(value),
      firstYearValue: round(value - (firstYearFee ?? 0)),
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
    "Each offer is the public one on the issuer's page, checked weekly. Offers can differ by person and by how you apply, and issuers limit who can get a bonus; each card's note says how.",
    "First-year value is the bonus at your point values minus the first year's annual fee. It leaves out what the card earns on your spending and any credits or perks.",
  ]
  return { offers, withoutOffer, notes }
}
