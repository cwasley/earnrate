import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { bonusDollars } from './bonus.ts'
import { allCreditsYear } from './credits.ts'
import { matchesFilters } from './explore.ts'
import type { Spending } from './renewal.ts'
import { simulateAdditions, typicalSpendLines } from './simulate.ts'
import { membershipCosts, paidMemberships } from './memberships.ts'
import { inEffect } from './periods.ts'
import { CREDITS_APART, heldName, listed, money, roundCents } from './text.ts'
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
  // Its statement credits, a year at face value, and firstYearValue with
  // them all used: shown apart, never ranked on.
  credits: number
  firstYearValueIfCreditsUsed: number
  // On the person's spending (or typical amounts), beside the cards they
  // hold; null for a card they hold.
  plan: OfferPlan | null
  held: boolean
  lastVerified: string
  verifiedBy: string
}

export type OfferPlan = {
  extraRewards: number // a year, beyond the wallet without it
  // Whether the minimum spend fits in the window with all spending on the
  // card, and how many weeks of it that takes; null with no minimum.
  minimumSpend: { reachable: boolean; weeks: number } | null
  yearOne: number // extraRewards, plus the bonus if reachable, less first-year fees
  yearTwo: number // extraRewards less the full fee and any membership
  twoYears: number // what it's ranked on
}

export type OfferComparison = {
  offers: OfferSummary[]
  typical: boolean // the spending is typical U.S. amounts
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
    : `Likely not eligible: you hold ${listed(held)}, and the issuer's terms rule out its cardholders.`
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

const WEEKS_A_MONTH = 52 / 12

function minimumSpend(
  spend: number,
  months: number,
  monthly: number,
): OfferPlan['minimumSpend'] {
  if (spend <= 0) return null
  const weeks =
    monthly > 0 ? Math.ceil(spend / (monthly / WEEKS_A_MONTH)) : Infinity
  return {
    reachable: monthly * months >= spend,
    weeks: Number.isFinite(weeks) ? weeks : 0,
  }
}

export function compareOffers(
  catalog: Catalog,
  wallet: Wallet,
  filters: OfferFilters,
  today: string,
  spending: Spending = { lines: typicalSpendLines(catalog), typical: true },
): OfferComparison {
  const held = new Set(wallet.cards.map((c) => c.id))
  const skipped = new Set(wallet.skipped_issuers ?? [])
  const monthly = spending.lines.reduce((sum, l) => sum + l.monthly, 0)
  // A wallet card earnrate no longer lists can't be simulated.
  const known = {
    ...wallet,
    cards: wallet.cards.filter((h) => catalog.cards.some((c) => c.id === h.id)),
  }
  const { additions } = simulateAdditions(catalog, known, spending.lines, {
    filters: { ...filters, issuer: null, includeClosed: true },
    memberships: wallet.memberships,
    valuations: wallet.valuations,
    start: today,
  })
  const added = new Map(additions.map((a) => [a.cardId, a]))
  const paid = paidMemberships(catalog, {
    memberships: wallet.memberships,
    heldCards: [...held],
  })
  const offers: OfferSummary[] = []
  const withoutOffer: string[] = []
  for (const card of catalog.cards) {
    if (card.network === 'store') continue
    if (!filters.includeHeld && held.has(card.id)) continue
    if (skipped.has(card.issuer)) continue
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
    const firstYearValue = roundCents(
      value - (firstYearFee ?? 0) - membershipFee,
    )
    const credits = allCreditsYear(catalog, card, today).yearly
    const addition = added.get(card.id)
    const minimum = minimumSpend(offer.spend, offer.months, monthly)
    const plan: OfferPlan | null = addition
      ? (() => {
          const reached = minimum === null || minimum.reachable
          const yearOne = roundCents(
            addition.extraRewards +
              (reached ? value : 0) -
              (firstYearFee ?? 0) -
              addition.membershipFee,
          )
          const yearTwo = roundCents(
            addition.extraRewards - addition.annualFee - addition.membershipFee,
          )
          return {
            extraRewards: addition.extraRewards,
            minimumSpend: minimum,
            yearOne,
            yearTwo,
            twoYears: roundCents(yearOne + yearTwo),
          }
        })()
      : null
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
      firstYearValue,
      credits,
      firstYearValueIfCreditsUsed: roundCents(firstYearValue + credits),
      plan,
      held: held.has(card.id),
      lastVerified: card.last_verified,
      verifiedBy: card.verified_by,
    })
  }
  offers.sort(
    (a, b) =>
      Number(a.ineligible !== null) - Number(b.ineligible !== null) ||
      (b.plan?.twoYears ?? -Infinity) - (a.plan?.twoYears ?? -Infinity) ||
      b.firstYearValue - a.firstYearValue ||
      a.cardId.localeCompare(b.cardId),
  )

  const notes = [
    `Compares the ${String(catalog.cards.length)} cards earnrate knows, not every card on the market.`,
    `Each offer is the public one on the issuer's page on the date shown, checked weekly. ${OFFERS_MAY_DIFFER} Issuers also limit who can get a bonus; each card's note says how.`,
    `Ranked on the first two years together: what each card ${wallet.cards.length > 0 ? 'adds to your cards' : 'earns'} on ${spending.typical ? 'typical U.S. spending' : 'your spending'}${wallet.cards.length > 0 ? ' (it takes the purchases where it earns more)' : ''}, plus the welcome bonus in year one if the minimum spend fits in the window with all your spending on it, less each year's annual fee and any membership it needs. Year one counts the card at its standard rates.`,
    "First-year value is the bonus alone at your point values, less the first year's fee and membership.",
    CREDITS_APART,
    ...(skipped.size > 0
      ? [
          `Leaves out cards from ${listed([...skipped].map((i) => catalog.issuers.find((x) => x.id === i)?.name ?? i))}, as you asked.`,
        ]
      : []),
  ]
  return { offers, withoutOffer, notes, typical: spending.typical }
}
