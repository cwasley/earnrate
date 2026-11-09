import type {
  Cap,
  Card,
  Choice,
  Credit,
  Milestone,
  PaymentMethod,
} from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { WalletCard } from '../schema/wallet.ts'
import { singleMcc } from './evaluate.ts'
import type { MerchantResolution } from './types.ts'

export const num = (n: number) => String(Number(n.toFixed(2)))
export const pct = (n: number) => `${num(n)}%`
export const roundCents = (n: number) => Math.round(n * 100) / 100
// Ids for a message: "amex-gold, citi-double-cash".
export const idList = (ids: string[]) => ids.join(', ')
export const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

// "usbank.com" from "https://www.usbank.com/credit-cards/...".
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// An id in words: "gas-ev-charging" reads "gas ev charging".
export const words = (id: string) => id.replace(/[-_.]/g, ' ')

const dateWords = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    ...options,
    timeZone: 'UTC',
  })

// From YYYY-MM-DD, the same in every time zone: "Dec 31, 2026",
// "December 31, 2026", "December 2026".
export const shortDate = (date: string) =>
  dateWords(date, { month: 'short', day: 'numeric', year: 'numeric' })
export const longDate = (date: string) =>
  dateWords(date, { month: 'long', day: 'numeric', year: 'numeric' })
export const monthYear = (date: string) =>
  dateWords(date, { month: 'long', year: 'numeric' })

// "Q4 2026", from an ISO date.
export const quarterYear = (date: string) =>
  `Q${String(Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1)} ${date.slice(0, 4)}`

// Always cents ($4.00), for what one purchase earns. A loss reads −$4.00.
export const dollarsAndCents = (n: number) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Rounded to whole dollars ($2,800), for fees, caps and yearly totals.
export const wholeDollars = (n: number) => money(Math.round(n))

// Whole dollars stay whole ($2,800); anything else shows cents ($0.40). A
// loss reads −$618.
export const money = (n: number) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`

// "No foreign transaction fee", "3% foreign transaction fee"
export const foreignFeeText = (fee: number | null) =>
  fee === null
    ? 'Foreign transaction fee not on file'
    : fee === 0
      ? 'No foreign transaction fee'
      : `${pct(fee)} foreign transaction fee`

export function feeText(fees: {
  annualFee: number | null
  firstYearFee: number | null
}): string {
  const { annualFee, firstYearFee } = fees
  if (annualFee === null) return 'annual fee not on file'
  if (annualFee === 0) return 'no annual fee'
  if (firstYearFee !== null && firstYearFee !== annualFee)
    return `${money(annualFee)} annual fee (${firstYearFee === 0 ? 'waived' : money(firstYearFee)} the first year)`
  return `${money(annualFee)} annual fee`
}

export function heldName(catalog: Catalog, held: WalletCard): string {
  return (
    held.checkout_label ??
    catalog.cards.find((c) => c.id === held.id)?.name ??
    held.id
  )
}

export function currencyName(catalog: Catalog, id: string): string {
  return catalog.currencies.find((c) => c.id === id)?.name ?? id
}

export function currencyLabel(catalog: Catalog, id: string): string {
  const name = currencyName(catalog, id)
  return /^[A-Z]{2,4}$/.test(id) ? `${name} (${id})` : name
}

// Mid-sentence form: "Supermarkets" becomes "supermarkets", but "TV and
// internet service" and "EV charging" keep their acronyms.
export function categoryPhrase(catalog: Catalog, id: string): string {
  const name = catalog.categories.find((c) => c.id === id)?.name ?? id
  return /^[A-Z]{2}/.test(name)
    ? name
    : name.charAt(0).toLowerCase() + name.slice(1)
}

// A category bought as a service reads "on" (streaming services); its own
// preposition or a parent's says so. Everything else reads "at".
export function categoryReadsOn(catalog: Catalog, id: string): boolean {
  const category = catalog.categories.find((c) => c.id === id)
  if (category?.preposition === 'on') return true
  const dot = id.lastIndexOf('.')
  return dot !== -1 && categoryReadsOn(catalog, id.slice(0, dot))
}

export function categoryNote(catalog: Catalog, id: string): string | null {
  const note = catalog.categories.find((c) => c.id === id)?.note
  if (note !== undefined) return note
  const dot = id.lastIndexOf('.')
  return dot === -1 ? null : categoryNote(catalog, id.slice(0, dot))
}

export function earnText(
  catalog: Catalog,
  rate: number,
  currency: string,
): string {
  return currency === 'cash'
    ? `${pct(rate)} cash back`
    : `${num(rate)}x ${currencyName(catalog, currency)}`
}

export function codesAs(
  catalog: Catalog,
  merchant: MerchantResolution,
): string {
  const mcc = merchant.likelyMcc ?? singleMcc(catalog, merchant.category)
  const code = mcc === null ? '' : ` (MCC ${String(mcc)})`
  return `Assumes ${merchant.resolvedName} codes as ${categoryPhrase(catalog, merchant.category)}${code}.`
}

// "Point values: Membership Rewards (MR) at 1¢." for the currencies an
// answer ranks, or null when every card shown earns cash.
export function pointValuesText(
  catalog: Catalog,
  shown: { currency: string; centsPerUnit: number }[],
): string | null {
  const values = new Map<string, number>()
  for (const e of shown)
    if (e.currency !== 'cash') values.set(e.currency, e.centsPerUnit)
  if (values.size === 0) return null
  const list = [...values].map(
    ([id, cents]) => `${currencyLabel(catalog, id)} at ${num(cents)}¢`,
  )
  return `Point values: ${listed(list)}.`
}

export const NETWORK_NAMES: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  store: 'store card',
}

// How a purchase is paid, mid-sentence: "2% cash back with Apple Pay".
export const PAYMENT_PHRASES: Record<PaymentMethod, string> = {
  card: 'with the card itself',
  'apple-pay': 'with Apple Pay',
  'google-pay': 'with Google Pay',
  paypal: 'through PayPal checkout',
}

export const paidText = (payment: PaymentMethod) =>
  `Counts this as paid ${PAYMENT_PHRASES[payment]}, as you said.`

export const paymentUnknownText = (
  name: string,
  payment: PaymentMethod,
  earn: string,
  standard: string,
) =>
  `${capitalize(PAYMENT_PHRASES[payment])}, ${name} would earn ${earn} here, instead of the ${standard} it's ranked at. Say how you're paying to count it.`

export const amountUnknownText = (
  name: string,
  amount: number,
  earn: string,
  standard: string,
) =>
  `On a purchase of ${wholeDollars(amount)} or more, ${name} would earn ${earn} here, instead of the ${standard} it's ranked at. Give the amount to count it.`

// For answers that never ask how each purchase is paid (cheat sheets and
// simulations): which cards' rates that need a way of paying are left out.
export function paymentNote(
  cards: { name: string; card: Card }[],
): string | null {
  const payments = new Set<PaymentMethod>()
  const names: string[] = []
  for (const { name, card } of cards) {
    const needs = card.rules.flatMap((r) =>
      r.requires?.payment === undefined ? [] : [r.requires.payment],
    )
    if (needs.length === 0) continue
    names.push(name)
    for (const p of needs) payments.add(p)
  }
  if (names.length === 0) return null
  return `Rates ${listed(
    [...payments].map((p) => PAYMENT_PHRASES[p]),
    'or',
  )} (${listed(names)}) aren't counted: this ranks each card by what it earns however you pay.`
}

// A name with its own "and" ("drugstores and pharmacies") would run into the
// list's: those lists use commas only, with those names last.
// "Up to $1,500 of spending a quarter, then 1% cash back"
export const capSentence = (
  cap: { amount: number; period: keyof typeof CAP_PERIODS },
  then: string,
  of = 'spending',
  aside = '', // " (shared with …)", after the period
) =>
  `Up to ${wholeDollars(cap.amount)} of ${of} ${CAP_PERIODS[cap.period]}${aside}, then ${then}`

// "a Costco membership", "an Instacart credit", "an IHG card", "a Uber credit":
// by sound, so a leading "you" or "won" takes "a" and a letter said with a
// vowel sound ("an REI") takes "an".
export function withArticle(name: string): string {
  const initialism = /^[A-Z][A-Z&.-]{1,5}(?![a-z])/.test(name)
  const an = initialism
    ? /^[AEFHILMNORSX]/.test(name)
    : /^[aeiou]/i.test(name) && !/^(u[bnst]|u\.s\.|eu|one\b|once\b)/i.test(name)
  return `${an ? 'an' : 'a'} ${name}`
}

// A card's name as people say it: "Amex Blue Cash Preferred", not "American
// Express Blue Cash Preferred Card".
export const shortCardName = (name: string) =>
  name
    .replace(/^American Express /, 'Amex ')
    .replace(/^The (.+) Card from American Express$/, 'Amex $1')
    // "Card" is part of Apple Card's name, not a suffix.
    .replace(
      / (Visa Signature |Visa Infinite )?(Credit )?(?<!^Apple )Card$/,
      '',
    )
    .replace(/ Card by /, ' by ')

// "Amex Platinum's", "Capital One Savor Rewards'".
export const possessive = (name: string) =>
  name.endsWith('s') ? `${name}'` : `${name}'s`

export const listed = (parts: string[], joiner = 'and') => {
  const anded = parts.filter((p) => p.includes(' and '))
  if (anded.length > 0)
    return [...parts.filter((p) => !p.includes(' and ')), ...anded].join(', ')
  return parts.length <= 2
    ? parts.join(` ${joiner} `)
    : `${parts.slice(0, -1).join(', ')} ${joiner} ${parts.at(-1) ?? ''}`
}

const NUMBERS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
}

// "five-percent" reads "5%" and "three-x" reads "3x"; other ids read as words.
export function choiceName(id: string): string {
  return words(
    id.replace(
      /\b(one|two|three|four|five|six)-(percent|x)\b/g,
      (_, n: string, unit: string) =>
        `${NUMBERS[n] ?? n}${unit === 'x' ? 'x' : '%'}`,
    ),
  )
}

// Period words in one place: a cap of $1,500 "a quarter", a "quarterly" cap,
// a category picked "each quarter".
export const CAP_PERIODS: Record<Cap['period'], string> = {
  month: 'a month',
  quarter: 'a quarter',
  calendar_year: 'a calendar year',
  cardmember_year: 'a cardmember year',
}

// "for 2026-Q4", or "this cardmember year": a cardmember year's key is the
// year it started, which reads as the calendar year.
export const periodPhrase = (kind: Credit['period'], key: string) =>
  kind === 'cardmember_year' ? 'this cardmember year' : `for ${key}`

export const CAP_ADJECTIVES: Record<Cap['period'], string> = {
  month: 'monthly',
  quarter: 'quarterly',
  calendar_year: 'calendar-year',
  cardmember_year: 'cardmember-year',
}

// "the $15,000 calendar-year spend", for a spend bonus.
export const MILESTONE_PERIODS: Record<Milestone['period'], string> = {
  calendar_year: 'calendar-year',
  cardmember_year: 'cardmember-year',
}

export const PICK_PERIODS: Record<Choice['period'], string> = {
  month: 'each month',
  quarter: 'each quarter',
  calendar_year: 'each year',
  until_changed: 'until you change it',
}

type ChoiceWording = Pick<Choice, 'pick' | 'period'> & {
  automatic?: boolean | undefined
}

// "the 2 categories you pick each quarter", or for a card whose issuer
// applies the bonus itself, "the category you spend the most in each month".
// `oneOf` reads as one option of several: "one of the 2 categories …".
export function choicePhrase(c: ChoiceWording, oneOf = false): string {
  const which =
    c.pick === 1
      ? 'the category'
      : `${oneOf ? 'one of ' : ''}the ${String(c.pick)} categories`
  const when = c.period === 'until_changed' ? '' : ` ${PICK_PERIODS[c.period]}`
  return c.automatic
    ? `${which} you spend the most in${when}`
    : `${which} you pick${when}`
}

// What earning a picked rate takes, for an answer's conditions: "Needs
// dining as its top-category pick (picked each month)", or for an automatic
// choice, "Counts when dining is the category you spend the most in that
// month".
export function pickCondition(
  c: ChoiceWording,
  options: string,
  name: string,
): string {
  if (c.automatic) {
    const period = {
      month: ' that month',
      quarter: ' that quarter',
      calendar_year: ' that year',
      until_changed: '',
    }[c.period]
    return c.pick === 1
      ? `Counts when ${options} is the category you spend the most in${period}`
      : `Counts when ${options} is one of the ${String(c.pick)} categories you spend the most in${period}`
  }
  return `Needs ${options} as its ${name} pick (${c.period === 'until_changed' ? '' : 'picked '}${PICK_PERIODS[c.period]})`
}

// Intro rates (a card's first 365 days): "first year", "first 90 days".
export const introPeriod = (days: number) =>
  days === 365 ? 'first year' : `first ${String(days)} days`
export const introAdjective = (days: number) =>
  days === 365 ? 'first-year' : `${String(days)}-day`
// Asking for an opening date: "if it opened in the last year".
export const introSince = (days: number) =>
  days === 365 ? 'in the last year' : `in the last ${String(days)} days`

// "6% cash back in your first year, through Mar 3, 2027; 3% cash back after
// that."
export const introRateText = (
  earn: string,
  standard: string,
  days: number,
  until: string,
) =>
  `${earn} in your ${introPeriod(days)}, through ${shortDate(until)}; ${standard} after that.`

// For a card whose opening date isn't known: it's never assumed to be new.
export const introUnknownText = (
  name: string,
  earn: string,
  standard: string,
  days: number,
) =>
  `A ${introAdjective(days)} rate may apply on ${name}: ${earn} here in an account's ${introPeriod(days)}, instead of the ${standard} it's ranked at. Give the card's opening date if it opened ${introSince(days)}.`

export const introEndsText = (name: string, days: number, until: string) =>
  `${possessive(name)} ${introAdjective(days)} rate ends after ${shortDate(until)}; from then on it earns its standard rates.`

// Statement credits. Always dollars, never a percentage.
export const CREDIT_PERIODS: Record<Credit['period'], string> = {
  month: 'each month',
  quarter: 'each quarter',
  half_year: 'each half year',
  calendar_year: 'each calendar year',
  cardmember_year: 'each cardmember year',
}

export const CREDIT_THIS_PERIOD: Record<Credit['period'], string> = {
  month: 'this month',
  quarter: 'this quarter',
  half_year: 'this half year',
  calendar_year: 'this year',
  cardmember_year: 'this cardmember year',
}

export const ENROLL_FIRST = 'enroll first'

// The group of cards with a credit at the store, shown before the ranking.
export const CREDIT_GROUP = 'With a statement credit'

// A credit the cardholder said they don't use, in list_wallet.
export const CREDIT_SKIPPED = "marked as one you don't use, so it isn't counted"

// "$75 back each quarter"
export const creditBack = (c: Pick<Credit, 'amount' | 'period'>) =>
  `${money(c.amount)} back ${CREDIT_PERIODS[c.period]}`

const minPurchase = (amount: number) =>
  `a purchase of ${wholeDollars(amount)} or more`

// " on a purchase of $500 or more", " through Sep 30, 2027": the limits a
// credit's issuer sets beyond its amount and period.
export const creditTerms = (c: Pick<Credit, 'valid_to' | 'min_amount'>) =>
  `${c.min_amount === undefined ? '' : ` with ${minPurchase(c.min_amount)}`}${
    c.valid_to === undefined ? '' : ` through ${shortDate(c.valid_to)}`
  }`

// "$75 back each quarter, then 1x Amex Membership Rewards"
export const creditThen = (
  c: Pick<Credit, 'amount' | 'period' | 'valid_to' | 'min_amount'>,
  earn: string,
) => `${creditBack(c)}${creditTerms(c)}, then ${earn}`

// "$35 left this quarter"
export const creditLeft = (left: number, period: Credit['period']) =>
  `${money(left)} left ${CREDIT_THIS_PERIOD[period]}`

export type CreditWords = {
  name: string // "lululemon"
  amount: number
  period: Credit['period']
  enrolled: boolean
  left: number | null // this period, before the purchase
  until: string | null // the period's last day
  minAmount?: number | null // it pays only on a purchase this large
}

// A credit that pays here comes first: what's left of it ends with its
// period, while a spend bonus or a welcome bonus can come from other
// purchases.
export function creditFirstText(
  card: string,
  c: Pick<CreditWords, 'name' | 'until'>,
  spendBonus: string | null,
  welcome: { card: string; remaining: number; deadline: string } | null,
): string {
  const parts = [
    `Use ${possessive(card)} ${c.name} credit here${c.until === null ? '' : `: what's left of it ends ${shortDate(c.until)}`}.`,
  ]
  if (spendBonus !== null)
    parts.push(
      `${possessive(spendBonus)} spend bonus can come with a later purchase on it.`,
    )
  if (welcome !== null)
    parts.push(
      `${possessive(welcome.card)} welcome bonus can catch up on other purchases (${money(welcome.remaining)} more to spend by ${shortDate(welcome.deadline)}).`,
    )
  return parts.join(' ')
}

// A line for an answer that uses the card's credit, or says why it doesn't.
export function creditAnswerText(c: CreditWords, dollars: number | null) {
  const min = c.minAmount ?? null
  const credit = `${c.name} credit (${creditBack(c)})`
  if (!c.enrolled)
    return `Has ${withArticle(credit)} here; ${ENROLL_FIRST} with the issuer, then mark it enrolled in your wallet. It isn't counted until then.`
  if (c.left === null)
    return `Has ${withArticle(credit)} here; give the card's anniversary to track it.`
  if (c.left <= 0)
    return `Its ${c.name} credit is used up ${CREDIT_THIS_PERIOD[c.period]}${c.until === null ? '' : `; it renews after ${shortDate(c.until)}`}.`
  if (dollars === null)
    return `Its ${credit} has ${creditLeft(c.left, c.period)}; give the amount to count it${min === null ? '' : ` (it needs ${minPurchase(min)})`}.`
  if (dollars <= 0 && min !== null)
    return `Its ${credit} needs ${minPurchase(min)}, so it doesn't count here.`
  return dollars < c.left
    ? `${money(dollars)} back from its ${credit}, on top of what it earns; ${creditLeft(roundCents(c.left - dollars), c.period)} after this.`
    : `${money(dollars)} back from its ${credit}: all that's left ${CREDIT_THIS_PERIOD[c.period]}, on top of what it earns.`
}

// One short line beside a ranked card: "+ $35 back from its Lululemon
// credit", "Lululemon credit: $35 left this quarter".
export function creditShort(c: CreditWords, dollars: number | null): string {
  if (!c.enrolled) return `${c.name} credit: ${creditBack(c)}, ${ENROLL_FIRST}`
  if (c.left === null) return `${c.name} credit: ${creditBack(c)}`
  if (c.left <= 0)
    return `${c.name} credit used up ${CREDIT_THIS_PERIOD[c.period]}`
  if (dollars === null || dollars <= 0)
    return `${c.name} credit: ${creditLeft(c.left, c.period)}`
  return `+ ${money(dollars)} back from its ${c.name} credit`
}

// For the to-do list: "Use your $75 lululemon credit on Amex Platinum by Dec
// 31, 2026: $35 left."
export const useCreditText = (card: string, c: CreditWords, left: number) =>
  `Use your ${money(c.amount)} ${c.name} credit on ${card}${c.until === null ? '' : ` by ${shortDate(c.until)}`}: ${money(left)} left.`

export const enrollCreditText = (card: string, names: string[]) =>
  names.length === 1
    ? `Enroll in ${possessive(card)} ${names[0] ?? ''} credit with the issuer, then mark it enrolled.`
    : `Enroll in ${possessive(card)} ${listed(names)} credits with the issuer, then mark them enrolled.`

// Credits that need no enrolling and free nights, before the cardholder
// says whether they use them: they don't offset the annual fee until then.
export function askCreditText(card: string, names: string[], nights = 0) {
  const parts = [
    ...(names.length === 0
      ? []
      : [
          names.length === 1
            ? `${names[0] ?? ''} credit`
            : `${listed(names)} credits`,
        ]),
    ...(nights === 0 ? [] : [FREE_NIGHT_NAME]),
  ]
  return names.length + nights === 1
    ? `Do you use ${possessive(card)} ${parts[0] ?? ''}? Say you use it and it counts against the annual fee.`
    : `Do you use ${possessive(card)} ${listed(parts)}? Say which you use and they count against the annual fee.`
}

// A free night given each cardmember year, valued at its point cap.
export const FREE_NIGHT_NAME = 'anniversary free night'

// "an anniversary free night each year, up to 40,000 IHG One Rewards points"
export const freeNightText = (points: number, currencyName: string) =>
  `${withArticle(FREE_NIGHT_NAME)} each year, up to ${points.toLocaleString('en-US')} ${currencyName}`

// "up to $200 at 0.5¢ a point"
export const freeNightValueText = (value: number, cents: number) =>
  `up to ${wholeDollars(value)} at ${num(cents)}¢ a point`

// The cheat sheet: its picks are by rate alone.
export const CREDITS_LEFT_OUT =
  'Statement credits (dollars back at a named store) are left out.'

// `nights` is the dollars of `yearly` from free nights, which are "up to".
type CreditsTotal = {
  yearly: number
  names: string[]
  nights?: number
  nightIds?: string[]
}

const nightCount = (c: CreditsTotal) => c.nightIds?.length ?? 0
const upTo = (c: CreditsTotal) => ((c.nights ?? 0) > 0 ? 'up to ' : '')

// "statement credits", "free night", "statement credits and free night"
export function perksNoun(c: CreditsTotal, statement = true): string {
  const nights = nightCount(c)
  const credits = c.names.length - nights
  return listed([
    ...(credits === 0 ? [] : [statement ? 'statement credits' : 'credits']),
    ...(nights === 0 ? [] : [nights === 1 ? 'free night' : 'free nights']),
  ])
}

// "$424 a year: Dunkin', Uber, Grubhub and Resy"
export const creditsYearText = (c: CreditsTotal) =>
  `${upTo(c)}${wholeDollars(c.yearly)} a year: ${listed(c.names)}`

// A held card's credits the cardholder uses, counted against its fee:
// "Amex Gold's credits you use (Dunkin' and Uber) count against its fee: $204 a year."
export function creditsCountedText(
  card: string,
  fee: number,
  c: CreditsTotal,
): string {
  const amount = `${upTo(c)}${wholeDollars(c.yearly)} a year`
  if (nightCount(c) > 0 && c.names.length === 1)
    return fee > 0
      ? `${possessive(card)} ${c.names[0] ?? ''}, which you use, counts against its fee: ${amount}.`
      : `${possessive(card)} ${c.names[0] ?? ''}, which you use, adds ${amount}.`
  const noun = nightCount(c) > 0 ? perksNoun(c, false) : 'credits'
  return fee > 0
    ? `${possessive(card)} ${noun} you use (${listed(c.names)}) count against its fee: ${amount}.`
    : `${possessive(card)} ${noun} you use (${listed(c.names)}) add ${amount}.`
}

// Rankings of cards the person doesn't hold: the honest figure leaves
// credits out, and the one with them is shown beside it.
export const CREDITS_APART =
  "Statement credits (dollars back at named stores) and yearly free nights aren't in the ranking: they're worth it only if you'd spend at those places or stay at those hotels anyway. Where a card has them, what it nets if you'd use them all is shown apart."

export const HELD_CREDITS_COUNTED =
  "Statement credits and free nights on your own cards count against their fees once you've said you use them: marked enrolled, or marked used (or already used) for ones that need no enrolling."

export const CREDITS_ONLY_IF =
  "They're worth that only if you'd spend at those places anyway."

// What "if you'd use them all" assumes, for what the total holds.
export function onlyIfText(credits: boolean, nights: boolean): string {
  if (!nights) return CREDITS_ONLY_IF
  return credits
    ? "They're worth that only if you'd spend at those places anyway, and a free night only on a stay you'd make anyway, at a hotel that costs its full point cap."
    : "A free night is worth that only on a stay you'd make anyway, at a hotel that costs its full point cap."
}

export const creditsOnlyIf = (c: CreditsTotal) =>
  onlyIfText(c.names.length > nightCount(c), nightCount(c) > 0)

// Several cards' credits and free nights as one total.
export const perksTotal = (list: CreditsTotal[]): CreditsTotal => ({
  yearly: roundCents(list.reduce((sum, c) => sum + c.yearly, 0)),
  names: list.flatMap((c) => c.names),
  nights: roundCents(list.reduce((sum, c) => sum + (c.nights ?? 0), 0)),
  nightIds: list.flatMap((c) => c.nightIds ?? []),
})

// " · $X if you'd use all its credits ($424 a year)", for a ranked line.
export function ifCreditsShort(
  c: CreditsTotal,
  net: number,
  sign = '',
  its = 'its',
): string {
  if (c.yearly <= 0) return ''
  const noun = nightCount(c) > 0 ? perksNoun(c, false) : 'credits'
  const all = nightCount(c) > 0 && c.names.length === 1 ? '' : 'all '
  return ` · ${sign}${upTo(c)}${wholeDollars(net)} if you'd use ${all}${its} ${noun} (${upTo(c)}${wholeDollars(c.yearly)} a year)`
}

// The planner's credits and free nights, kept apart from its figures: "its
// credits are $120 a year more if you'd use them all".
export const offerPerksText = (credits: number, freeNights: number) => [
  ...(credits > 0
    ? [
        `its credits are ${wholeDollars(credits)} a year more if you'd use them all`,
      ]
    : []),
  ...(freeNights > 0
    ? [
        `its ${FREE_NIGHT_NAME} is up to ${wholeDollars(freeNights)} a year more from the first anniversary, if you'd use it`,
      ]
    : []),
]

// "If you'd use all the statement credits on Amex Gold and Sapphire Reserve
// ($724 a year), the pair nets $X a year."
export const pairCreditsUsedText = (
  cards: string[],
  yearly: number,
  dollars: number,
  nights = false, // the total includes a free night, so it's "up to"
) =>
  `If you'd use all the statement credits${nights ? ' and free nights' : ''} on ${listed(cards)} (${nights ? 'up to ' : ''}${wholeDollars(yearly)} a year), the pair nets ${nights ? 'up to ' : ''}${wholeDollars(dollars)} a year.`

// "If you'd use all its statement credits ($424 a year: …), it nets $X a
// year." `adds` for a card beside the ones already held.
export function ifCreditsUsedText(
  c: CreditsTotal,
  dollars: number,
  verb: 'nets' | 'adds' = 'nets',
  owner = 'its', // "the Amex Gold's" beside another card
): string {
  if (nightCount(c) === 0)
    return `If you'd use all ${owner} statement credits (${creditsYearText(c)}), it ${verb} ${wholeDollars(dollars)} a year.`
  const all = c.names.length > 1 ? 'all ' : ''
  return `If you'd use ${all}${owner} ${perksNoun(c)} (${creditsYearText(c)}), it ${verb} up to ${wholeDollars(dollars)} a year.`
}

// The renewal check on the to-do list. A card well ahead gets one short
// line; one that's close or behind gets the parts of the math.
export function renewalText(
  name: string,
  issuer: string,
  r: {
    due: string
    fee: number
    firstYearFee: number | null
    rewardsAdded: number
    credits: number
    freeNights: number
    nightsNotCounted: number
    net: number
    against: string | null
    typical: boolean
  },
): string {
  const fee =
    r.firstYearFee === null
      ? `${money(r.fee)} fee`
      : `${money(r.fee)} fee, up from ${money(r.firstYearFee)} the first year`
  const when = `${name} renews around ${shortDate(r.due)} (${fee})`
  // The free night is what puts it ahead: give the math and name it.
  const tipped = r.freeNights > 0 && r.net >= 0 && r.net < r.freeNights
  if (r.net >= r.fee && !tipped)
    return `${when}: it's paying for itself, about ${wholeDollars(r.net)} a year ahead after the fee.`
  const basis = r.typical ? 'At typical spending' : 'On your spending'
  const over =
    r.against === null ? 'your other cards would' : `${r.against} would`
  const earns =
    Math.round(r.rewardsAdded) > 0
      ? `it earns about ${wholeDollars(r.rewardsAdded)} a year more than ${over}`
      : Math.round(r.rewardsAdded) < 0
        ? `it earns about ${wholeDollars(-r.rewardsAdded)} a year less than ${over}`
        : `it earns about the same as ${over}`
  const creditDollars = roundCents(r.credits - r.freeNights)
  const extras = [
    ...(creditDollars > 0
      ? [`${wholeDollars(creditDollars)} in credits you use`]
      : []),
    ...(r.freeNights > 0
      ? [`up to ${wholeDollars(r.freeNights)} for its ${FREE_NIGHT_NAME}`]
      : []),
  ]
  const credits = extras.length > 0 ? `, plus ${listed(extras)}` : ''
  const withNight = roundCents(r.net + r.nightsNotCounted)
  const uncounted =
    r.nightsNotCounted > 0
      ? ` Its ${FREE_NIGHT_NAME} (up to ${wholeDollars(r.nightsNotCounted)}) isn't counted until you say you use it${withNight >= 0 ? `; with it, up to about ${wholeDollars(withNight)} a year ahead` : ''}.`
      : ''
  const result =
    r.net >= 0
      ? `about ${wholeDollars(r.net)} a year ahead after the fee${tipped ? ', but only with the free night at its full value' : ''}.`
      : `about ${wholeDollars(-r.net)} a year short of the fee.${uncounted} Check with ${issuer} before the fee posts.`
  return `${when}. ${basis}, ${earns}${credits}: ${result}`
}

// The next-card planner's figures: "about $1,690 over the first two years
// ($1,290 the first year, then $394 a year)".
export const twoYearText = (p: {
  yearOne: number
  yearTwo: number
  twoYears: number
}) =>
  `about ${wholeDollars(p.twoYears)} over the first two years (${wholeDollars(p.yearOne)} the first year, then ${wholeDollars(p.yearTwo)} a year${p.yearTwo < 0 ? ' after its fee' : ''})`

// Whether a welcome offer's minimum spend fits, at the person's spending.
export function minimumSpendText(
  spend: number,
  months: number,
  m: { reachable: boolean; weeks: number },
  typical: boolean,
): string {
  const whose = typical ? 'typical spending' : 'your spending'
  return m.reachable
    ? `The ${money(spend)} minimum takes about ${String(m.weeks)} weeks of all ${whose}.`
    : `The ${money(spend)} minimum in ${String(months)} months is more than ${whose}, so the bonus isn't counted.`
}
