import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { bonusDollars } from './bonus.ts'
import { allCreditsYear } from './credits.ts'
import { matchesFilters } from './explore.ts'
import type { Spending } from './renewal.ts'
import {
  countedLines,
  simulateAdditions,
  typicalSpendLines,
  type MembersOnly,
} from './simulate.ts'
import { missingMembership, paidMemberships } from './memberships.ts'
import { bonusEligibility, type MonthAsk } from './repeat-bonus.ts'
import { inEffect } from './periods.ts'
import { CREDITS_APART, heldName, listed, money, roundCents } from './text.ts'
import { cardValuation } from './valuation.ts'

export type OfferFilters = {
  kind: 'any' | 'cash' | 'points'
  business: boolean // business cards instead of personal ones
  noAnnualFee: boolean
  includeHeld: boolean
  // Just these card ids, held or not, in place of the filters above and the
  // issuers left out.
  only?: string[]
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
  // Why the issuer may not give this offer to this wallet's holder, if so.
  ineligible: string | null
  eligibleFrom: string | null // YYYY-MM a repeat-bonus wait ends
  // What the repeat-bonus rule says when it doesn't rule the offer out: a
  // month it needs, or a date that's only approximate.
  eligibilityNote: string | null
  // The month that would settle eligibilityNote, and where it goes.
  monthAsk: MonthAsk | null
  firstYearValue: number // bonus value minus the first year's fee
  // Its statement credits, a year at face value, and firstYearValue with
  // them all used: shown apart, never ranked on.
  credits: number
  firstYearValueIfCreditsUsed: number
  // Its free nights a year, from the first anniversary on, at their "up to"
  // value: shown apart too.
  freeNights: number
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
  yearTwo: number // extraRewards less the full fee
  twoYears: number // what it's ranked on
}

export type OfferComparison = {
  offers: OfferSummary[]
  // Offers on cards that need a membership the person hasn't given, valued
  // for a member: out of offers.
  membersOnly: MembersOnly<OfferSummary>[]
  typical: boolean // the spending is typical U.S. amounts
  withoutOffer: string[] // card ids that match the filters but publish no offer
  notes: string[]
}

export type OfferEligibility = {
  // Why the issuer may not give this offer to this wallet's holder, if so.
  ineligible: string | null
  // The month a repeat-bonus wait ends, when one applies.
  eligibleFrom: string | null
  // The repeat-bonus rule's note when it doesn't rule the offer out (a
  // month it needs, an approximate date), with the month to ask for.
  eligibilityNote: string | null
  monthAsk: MonthAsk | null
}

// A card held now is the wallet's own business; only the cards it rules out
// (`not_with`) and the issuer's repeat rule speak to someone getting it new.
// `asNew` asks about a held card too, as if applying for it again (the best
// cards from scratch).
export function offerEligibility(
  catalog: Catalog,
  wallet: Wallet,
  cardId: string,
  today: string,
  asNew = false,
): OfferEligibility {
  const offer = catalog.cards.find((c) => c.id === cardId)?.welcome_offer
  const notWith = offer?.not_with ?? []
  const held = wallet.cards
    .filter((c) => notWith.includes(c.id))
    .map((c) => heldName(catalog, c))
  const none = { eligibleFrom: null, eligibilityNote: null, monthAsk: null }
  if (held.length > 0)
    return {
      ...none,
      ineligible: `Likely not eligible: you hold ${listed(held)}, and the issuer's terms rule out its cardholders.`,
    }
  if (!asNew && wallet.cards.some((c) => c.id === cardId))
    return { ...none, ineligible: null }
  const repeat = bonusEligibility(catalog, wallet, cardId, today)
  if (
    repeat === null ||
    repeat.state === 'eligible' ||
    repeat.state === 'unstated'
  )
    return { ...none, ineligible: null }
  // A missing or approximate month never rules the offer out.
  if (repeat.state === 'needs-date' || repeat.state === 'likely')
    return {
      ineligible: null,
      eligibleFrom: repeat.from,
      eligibilityNote: repeat.text,
      monthAsk: repeat.ask,
    }
  return {
    ineligible: repeat.text,
    eligibleFrom: repeat.from,
    eligibilityNote: null,
    monthAsk: null,
  }
}

// What of a wallet decides who can get a welcome bonus: the cards held and
// their opening and bonus dates, and the card history. Null with neither.
export function historyOf(wallet: Wallet | null): Wallet | null {
  if (!wallet) return null
  const past = wallet.past_cards ?? []
  if (wallet.cards.length === 0 && past.length === 0) return null
  return {
    valuations: {},
    memberships: [],
    cards: wallet.cards.map((c) => ({
      id: c.id,
      cap_usage: {},
      activated: [],
      ...(c.checkout_label === undefined
        ? {}
        : { checkout_label: c.checkout_label }),
      ...(c.opened === undefined ? {} : { opened: c.opened }),
      ...(c.bonus === undefined ? {} : { bonus: c.bonus }),
      ...(c.bonus_received === undefined
        ? {}
        : { bonus_received: c.bonus_received }),
    })),
    ...(past.length > 0 ? { past_cards: past } : {}),
  }
}

export const OFFERS_MAY_DIFFER =
  'Yours may differ: issuers test and target offers, so use the one shown to you when you apply.'

export const offerCheckedOn = (
  card: Pick<Card, 'last_verified' | 'offer_checked'>,
): string =>
  card.offer_checked !== undefined && card.offer_checked > card.last_verified
    ? card.offer_checked
    : card.last_verified

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

export const offerOrder = (a: OfferSummary, b: OfferSummary) =>
  Number(a.ineligible !== null) - Number(b.ineligible !== null) ||
  (b.plan?.twoYears ?? -Infinity) - (a.plan?.twoYears ?? -Infinity) ||
  b.firstYearValue - a.firstYearValue ||
  a.cardId.localeCompare(b.cardId)

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

// `history`, for offers ranked from no cards (`wallet` holds none): the
// cards the person holds and has had, which decide only who can get each
// bonus (historyOf).
export function compareOffers(
  catalog: Catalog,
  wallet: Wallet,
  filters: OfferFilters,
  today: string,
  spending: Spending = { lines: typicalSpendLines(catalog), typical: true },
  history: Wallet | null = null,
): OfferComparison {
  const held = new Set(wallet.cards.map((c) => c.id))
  const skipped = new Set(wallet.skipped_issuers ?? [])
  const monthly = countedLines(catalog, spending.lines).reduce(
    (sum, l) => sum + l.monthly,
    0,
  )
  const only = filters.only ?? null
  const tried = (business: boolean) => {
    const { additions, membersOnly } = simulateAdditions(
      catalog,
      only === null ? wallet : { ...wallet, skipped_issuers: [] },
      spending.lines,
      {
        filters:
          only === null
            ? { ...filters, issuer: null, includeClosed: true }
            : {
                kind: 'any',
                noAnnualFee: false,
                business,
                issuer: null,
                includeClosed: true,
              },
        memberships: wallet.memberships,
        valuations: wallet.valuations,
        start: today,
      },
      only === null ? undefined : (card) => only.includes(card.id),
    )
    return [...additions, ...membersOnly]
  }
  const added = new Map(
    [
      ...tried(filters.business),
      ...(only === null ? [] : tried(!filters.business)),
    ].map((a) => [a.cardId, a]),
  )
  const paid = paidMemberships(catalog, {
    memberships: wallet.memberships,
    heldCards: [...held],
    merchantIds: spending.lines.map((l) => l.merchant.merchantId),
  })
  const offers: OfferSummary[] = []
  const membersOnly: MembersOnly<OfferSummary>[] = []
  const withoutOffer: string[] = []
  for (const card of catalog.cards) {
    if (only !== null) {
      if (!only.includes(card.id)) continue
    } else {
      if (card.network === 'store') continue
      if (!filters.includeHeld && held.has(card.id)) continue
      if (skipped.has(card.issuer)) continue
      if (
        !matchesFilters(card, { ...filters, issuer: null, includeClosed: true })
      )
        continue
    }

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
    const membership = missingMembership(card, paid)
    const firstYearValue = roundCents(value - (firstYearFee ?? 0))
    // A free night comes after each anniversary, so not in year one.
    const year = allCreditsYear(catalog, card, today, wallet.valuations)
    const credits = roundCents(year.yearly - year.nights)
    const addition = added.get(card.id)
    const minimum = minimumSpend(offer.spend, offer.months, monthly)
    const plan: OfferPlan | null = addition
      ? (() => {
          const reached = minimum === null || minimum.reachable
          // Yearly points come after each anniversary, so not in year one.
          const anniversary = addition.simulation.yearlyPoints
            .filter((y) => y.cardId === card.id)
            .reduce((sum, y) => sum + y.value, 0)
          const yearOne = roundCents(
            addition.extraRewards -
              anniversary +
              (reached ? value : 0) -
              (firstYearFee ?? 0),
          )
          const yearTwo = roundCents(addition.extraRewards - addition.annualFee)
          return {
            extraRewards: addition.extraRewards,
            minimumSpend: minimum,
            yearOne,
            yearTwo,
            twoYears: roundCents(yearOne + yearTwo),
          }
        })()
      : null
    const summary: OfferSummary = {
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
      ...(history === null
        ? offerEligibility(catalog, wallet, card.id, today)
        : offerEligibility(catalog, history, card.id, today, true)),
      firstYearValue,
      credits,
      firstYearValueIfCreditsUsed: roundCents(firstYearValue + credits),
      freeNights: year.nights,
      plan,
      held: held.has(card.id),
      lastVerified: offerCheckedOn(card),
      verifiedBy: card.verified_by,
    }
    if (membership === null) offers.push(summary)
    else membersOnly.push({ ...summary, membership })
  }
  offers.sort(offerOrder)
  membersOnly.sort(offerOrder)

  const cardName = (id: string) =>
    catalog.cards.find((c) => c.id === id)?.name ?? id
  const notes = [
    only === null
      ? `Compares the ${String(catalog.cards.length)} cards earnrate knows, not every card on the market.`
      : `Compares only the cards you named: ${listed(only.map(cardName))}.`,
    `Each offer is the public one on the issuer's page on the date shown, checked weekly. ${OFFERS_MAY_DIFFER} Issuers also limit who can get a bonus; each card's note says how, and cards you have or had are checked against the issuer's repeat-bonus rule.`,
    `Ranked on the first two years together: what each card ${wallet.cards.length > 0 ? 'adds to your cards' : 'earns'} on ${spending.typical ? 'typical U.S. spending' : 'your spending'}${wallet.cards.length > 0 ? ' (it takes the purchases where it earns more)' : ''}, plus the welcome bonus in year one if the minimum spend fits in the window with all your spending on it, less each year's annual fee. Year one counts the card at its standard rates${offers.some((o) => (catalog.cards.find((c) => c.id === o.cardId)?.yearly_points.length ?? 0) > 0) ? ', and points a card gives every year from year two, after its first anniversary' : ''}.`,
    "First-year value is the bonus alone at your point values, less the first year's fee.",
    CREDITS_APART,
    ...(skipped.size > 0 && only === null
      ? [
          `Leaves out cards from ${listed([...skipped].map((i) => catalog.issuers.find((x) => x.id === i)?.name ?? i))}, as you asked.`,
        ]
      : []),
  ]
  return { offers, membersOnly, withoutOffer, notes, typical: spending.typical }
}
