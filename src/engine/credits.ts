import { merchantFamily } from '../merchants/resolve.ts'
import type { Card, Credit, FreeNight } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { categoryMatches } from './evaluate.ts'
import { inEffect, periodEnd, periodKey } from './periods.ts'
import { creditLabel, creditName } from './rule-text.ts'
import {
  capitalize,
  FREE_NIGHT_NAME,
  ownNightName,
  roundCents,
  type CreditWords,
} from './text.ts'
import type { MerchantResolution } from './types.ts'
import { currencyValuation } from './valuation.ts'

// Node-free: earnrate.dev ranks with it in the browser.

export type CreditState = CreditWords & {
  credit: Credit
  skipped: boolean // the cardholder doesn't use it
  confirmed: boolean // the cardholder said they use it (creditConfirmed)
  key: string | null // the period, like 2026-Q4; null for a cardmember year without an anniversary
  used: number // dollars of credit received this period
}

// Only a store itself has a credit: a search for a kind of purchase
// ("clothing") never does, and a listed credit covers no purchase at all.
// A credit naming a merchant also covers its brands (Hilton's covers Hampton).
export function creditCovers(
  catalog: Catalog,
  credit: Credit,
  merchant: Pick<MerchantResolution, 'merchantId' | 'category' | 'source'>,
): boolean {
  if (merchant.source === 'category' || merchant.source === 'none') return false
  const { match } = credit
  if (match === undefined) return false
  const named = match.merchants
  if (named)
    return merchantFamily(catalog, merchant.merchantId).some((id) =>
      named.includes(id),
    )
  return (match.categories ?? []).some((c) =>
    categoryMatches(c, merchant.category),
  )
}

// A credit that needs enrolling counts only once the wallet says it's done.
const isEnrolled = (credit: Credit, held: WalletCard) =>
  credit.enroll !== true || (held.enrolled ?? []).includes(credit.id)

// The cardholder said they don't use it: it counts nowhere, enrolled or not.
export const isSkipped = (credit: Credit, held: WalletCard) =>
  (held.skipped_credits ?? []).includes(credit.id)

// The cardholder said they use it: it's in `enrolled` (for one that needs
// no enrolling, that means "using it"), or one that needs no enrolling has
// already paid out. Until then a credit doesn't offset the annual fee.
export const creditConfirmed = (credit: Credit, held: WalletCard) =>
  (held.enrolled ?? []).includes(credit.id) ||
  (credit.enroll !== true && held.credit_usage?.[credit.id] !== undefined)

// A credit that counts against the fee: confirmed and not skipped.
export const creditInUse = (credit: Credit, held: WalletCard) =>
  creditConfirmed(credit, held) && !isSkipped(credit, held)

// The credit's dollars for one period: a monthly credit can pay more in some
// months (Uber Cash's December).
export function periodAmount(
  credit: Pick<Credit, 'amount' | 'period' | 'month_amounts'>,
  key: string | null,
): number {
  if (credit.period !== 'month' || key === null) return credit.amount
  return (
    credit.month_amounts?.[String(Number(key.slice(5, 7)))] ?? credit.amount
  )
}

function creditState(
  catalog: Catalog,
  credit: Credit,
  held: WalletCard,
  date: string,
): CreditState {
  const anniversary = held.anniversary ?? null
  const period = periodKey(credit.period, date, anniversary)
  const usage = held.credit_usage?.[credit.id]
  const used =
    period !== null && usage !== undefined && usage.period === period
      ? usage.used
      : 0
  const amount = periodAmount(credit, period)
  return {
    credit,
    key: period,
    name: creditName(catalog, credit),
    amount: credit.amount,
    month_amounts: credit.month_amounts,
    periodAmount: amount,
    period: credit.period,
    enrolled: isEnrolled(credit, held),
    skipped: isSkipped(credit, held),
    confirmed: creditConfirmed(credit, held),
    used,
    minAmount: credit.min_amount ?? null,
    left: period === null ? null : roundCents(Math.max(0, amount - used)),
    until:
      period === null ? null : periodEnd(credit.period, period, anniversary),
  }
}

// The card's credits the issuer still offers on `date`.
export const liveCredits = (card: Card, date: string) =>
  card.credits.filter((c) => inEffect(c, date))

export const creditStates = (
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  date: string,
) => liveCredits(card, date).map((c) => creditState(catalog, c, held, date))

export const counts = (s: CreditState) =>
  s.enrolled && !s.skipped && s.left !== null && s.left > 0

// The card's credit at this merchant, if any: one that counts first, then
// the one with the most left. A skipped credit isn't mentioned at all.
export function creditAt(
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  merchant: Pick<MerchantResolution, 'merchantId' | 'category' | 'source'>,
  date: string,
): CreditState | null {
  const here = liveCredits(card, date)
    .filter((c) => !isSkipped(c, held) && creditCovers(catalog, c, merchant))
    .map((c) => creditState(catalog, c, held, date))
    .sort(
      (a, b) =>
        Number(counts(b)) - Number(counts(a)) || (b.left ?? 0) - (a.left ?? 0),
    )
  return here[0] ?? null
}

// Dollars back on a purchase: null without an amount, 0 when the credit
// doesn't count (not enrolled, or used up).
export function creditDollars(
  s: CreditState,
  amount: number | null,
): number | null {
  if (amount === null) return null
  if (!counts(s) || amount <= 0) return 0
  if (s.credit.min_amount !== undefined && amount < s.credit.min_amount)
    return 0
  return roundCents(Math.min(amount, s.left ?? 0))
}

const PER_YEAR: Record<Credit['period'], number> = {
  month: 12,
  quarter: 4,
  half_year: 2,
  calendar_year: 1,
  cardmember_year: 1,
}

const monthIndex = (date: string) =>
  Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1

// How many times the credit pays in the 12 months from `date`, counting the
// period `date` is in: every period's, or for a credit that ends, those that
// start by its last day.
function payoutsAYear(credit: Credit, date: string): number {
  const all = PER_YEAR[credit.period]
  if (credit.valid_to === undefined) return all
  if (!inEffect(credit, date)) return 0
  if (all === 1) return 1
  const step = 12 / all
  const first = monthIndex(date) - (monthIndex(date) % step)
  const starts = Math.floor((monthIndex(credit.valid_to) - first) / step) + 1
  return Math.min(all, starts)
}

const monthKey = (index: number) =>
  `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}`

// The credit's dollars over the 12 months from `date`, at face value.
function yearDollars(credit: Credit, date: string): number {
  const payouts = payoutsAYear(credit, date)
  if (credit.period !== 'month' || credit.month_amounts === undefined)
    return credit.amount * payouts
  let total = 0
  for (let i = 0; i < payouts; i++)
    total += periodAmount(credit, monthKey(monthIndex(date) + i))
  return total
}

// Dollars a year at face value, the most first: for ordering cards by credit.
export const creditPerYear = (
  c: Pick<Credit, 'amount' | 'period' | 'month_amounts'>,
) =>
  c.amount * PER_YEAR[c.period] +
  (c.period === 'month'
    ? Object.values(c.month_amounts ?? {}).reduce(
        (sum, v) => sum + v - c.amount,
        0,
      )
    : 0)

// A free night at its point cap, at the person's value for the card's own
// currency: the most it's worth, so always said as "up to". Null for a night
// with no cap.
export const nightValue = (
  catalog: Catalog,
  valuations: Wallet['valuations'],
  card: Card,
  night: FreeNight,
): number | null =>
  night.points === undefined
    ? null
    : roundCents(
        (night.points *
          currencyValuation(catalog, { valuations }, card.currency)
            .centsPerUnit) /
          100,
      )

// What the cardholder says the night is worth to them, if they have.
export const ownNightValue = (night: FreeNight, held: WalletCard | null) =>
  held?.night_values?.[night.id] ?? null

// Like a credit that needs no enrolling: in use once it's in `enrolled`,
// or once the cardholder has said what it's worth to them (wallets saved
// before a value always marked the night may lack the `enrolled` entry).
export const nightConfirmed = (night: FreeNight, held: WalletCard) =>
  (held.enrolled ?? []).includes(night.id) ||
  held.night_values?.[night.id] !== undefined

export const nightSkipped = (night: FreeNight, held: WalletCard) =>
  (held.skipped_credits ?? []).includes(night.id)

export const nightInUse = (night: FreeNight, held: WalletCard) =>
  nightConfirmed(night, held) && !nightSkipped(night, held)

export type NightState = {
  night: FreeNight
  name: string
  points: number | null // its cap, in the card's currency; null without one
  value: number | null // dollars at its cap, "up to"; null without a cap
  own: number | null // dollars the cardholder says it's worth to them
  worth: number | null // what it counts at: own, else value
  confirmed: boolean // the cardholder said they use it
  skipped: boolean
}

export const nightStates = (
  catalog: Catalog,
  valuations: Wallet['valuations'],
  card: Card,
  held: WalletCard | null,
): NightState[] =>
  card.free_nights.map((night) => {
    const value = nightValue(catalog, valuations, card, night)
    const own = ownNightValue(night, held)
    return {
      night,
      name: FREE_NIGHT_NAME,
      points: night.points ?? null,
      value,
      own,
      worth: own ?? value,
      confirmed: held !== null && nightConfirmed(night, held),
      skipped: held !== null && nightSkipped(night, held),
    }
  })

// A card's credits and free nights added up over the 12 months from a date:
// credits at face value, each night once at the cardholder's value for it,
// else at its "up to" value. A night with neither isn't counted.
export type CreditsYear = {
  cardId: string
  yearly: number // dollars a year, nights included
  creditIds: string[] // credit ids, then the ids of nights counted
  names: string[] // creditLabel of each credit, then each night's name
  nights: number // the dollars of `yearly` from nights at their cap
  nightIds: string[] // every night counted
  ownNights: number // the dollars of `yearly` from nights at the cardholder's value
  ownNightIds: string[]
  unvaluedNightIds: string[] // no cap and no value of the cardholder's
}

function creditsYear(
  catalog: Catalog,
  card: Card,
  credits: Credit[],
  nights: FreeNight[],
  valuations: Wallet['valuations'],
  date: string,
  held: WalletCard | null,
): CreditsYear {
  const live = credits.filter((c) => inEffect(c, date))
  const valued = nights.map((night) => {
    const own = ownNightValue(night, held)
    return {
      night,
      own,
      worth: own ?? nightValue(catalog, valuations, card, night),
    }
  })
  const counted = valued.filter((n) => n.worth !== null)
  const owned = counted.filter((n) => n.own !== null)
  const sum = (list: typeof valued) =>
    roundCents(list.reduce((total, n) => total + (n.worth ?? 0), 0))
  const nightDollars = sum(counted.filter((n) => n.own === null))
  const ownDollars = sum(owned)
  return {
    cardId: card.id,
    yearly: roundCents(
      live.reduce((total, c) => total + yearDollars(c, date), 0) +
        nightDollars +
        ownDollars,
    ),
    creditIds: [...live.map((c) => c.id), ...counted.map((n) => n.night.id)],
    names: [
      ...live.map((c) => creditLabel(catalog, c)),
      ...counted.map((n) =>
        n.own === null ? FREE_NIGHT_NAME : ownNightName(n.own),
      ),
    ],
    nights: nightDollars,
    nightIds: counted.map((n) => n.night.id),
    ownNights: ownDollars,
    ownNightIds: owned.map((n) => n.night.id),
    unvaluedNightIds: valued
      .filter((n) => n.worth === null)
      .map((n) => n.night.id),
  }
}

// Every credit and free night on the card, as if each were used in full:
// for a card the person doesn't hold, or the fee math on one they do (with
// `held`, for their own night values).
export const allCreditsYear = (
  catalog: Catalog,
  card: Card,
  date: string,
  valuations: Wallet['valuations'],
  held: WalletCard | null = null,
) =>
  creditsYear(
    catalog,
    card,
    card.credits,
    card.free_nights,
    valuations,
    date,
    held,
  )

// The credits and free nights a cardholder uses, in full each period: what
// counts against the fee of a card they hold.
export const usedCreditsYear = (
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  date: string,
  valuations: Wallet['valuations'],
) =>
  creditsYear(
    catalog,
    card,
    card.credits.filter((c) => creditInUse(c, held)),
    card.free_nights.filter((n) => nightInUse(n, held)),
    valuations,
    date,
    held,
  )

// One statement credit or free night on a held card, as a list of what to
// mark as used or not: its short name, its dollars over the 12 months from
// the date (a night at the cardholder's value, else its point cap; null
// with neither), and what the cardholder has said, by the same rules the fee
// math uses.
export type CreditChoice = {
  id: string
  name: string // "Uber", "Airline fee", "Anniversary free night"
  yearly: number | null
  night: boolean
  enroll: boolean // the issuer needs enrolling before it pays
  answer: 'used' | 'skipped' | null
}

// The card's live credits, then its free nights, the most dollars first.
export function creditChoices(
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  date: string,
  valuations: Wallet['valuations'],
): CreditChoice[] {
  const credits = liveCredits(card, date).map((c): CreditChoice => ({
    id: c.id,
    name: capitalize(creditLabel(catalog, c)),
    yearly: roundCents(yearDollars(c, date)),
    night: false,
    enroll: c.enroll === true,
    answer: isSkipped(c, held)
      ? 'skipped'
      : creditConfirmed(c, held)
        ? 'used'
        : null,
  }))
  const nights = card.free_nights.map((n): CreditChoice => ({
    id: n.id,
    name: capitalize(FREE_NIGHT_NAME),
    yearly: ownNightValue(n, held) ?? nightValue(catalog, valuations, card, n),
    night: true,
    enroll: false,
    answer: nightSkipped(n, held)
      ? 'skipped'
      : nightConfirmed(n, held)
        ? 'used'
        : null,
  }))
  const most = (a: CreditChoice, b: CreditChoice) =>
    (b.yearly ?? 0) - (a.yearly ?? 0)
  return [...credits.sort(most), ...nights.sort(most)]
}

// The credits and free nights a cardholder hasn't said they use or don't:
// left out of the fee math until they do.
export const unsaidCreditsYear = (
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  date: string,
  valuations: Wallet['valuations'],
) =>
  creditsYear(
    catalog,
    card,
    card.credits.filter(
      (c) => !creditConfirmed(c, held) && !isSkipped(c, held),
    ),
    card.free_nights.filter(
      (n) => !nightConfirmed(n, held) && !nightSkipped(n, held),
    ),
    valuations,
    date,
    held,
  )
