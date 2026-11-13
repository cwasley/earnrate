// "Is the annual fee worth it?": the monthly spending in the card's bonus
// categories at which it nets more than the best no-fee card on the same
// spending, from the year-long simulation. earnrate.dev's card pages and the
// card search answer both say it.
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { EPSILON } from './compare.ts'
import { allCreditsYear, type CreditsYear } from './credits.ts'
import { matchesFilters } from './explore.ts'
import { VALUATION_PROFILES } from './profiles.ts'
import { creditWhere } from './rule-text.ts'
import {
  resolveSpendLines,
  simulateSingles,
  typicalSpend,
  type ResolvedLine,
  type Simulation,
} from './simulate.ts'
import {
  creditsOnlyIf,
  creditsYearText,
  currencyName,
  FREE_NIGHT_NAME,
  inOrder,
  midSentence,
  num,
  perksNoun,
  pct,
  roundCents,
  shortCardName,
  wholeDollars,
} from './text.ts'
import { currencyValuation } from './valuation.ts'
import { yearlyPointsCounted } from './yearly-points.ts'

export const STEP = 50 // dollars a month between the amounts tried
export const MAX_MONTHLY = 5000
// A break-even past this many times typical spending in the card's lines
// says why it's that high.
export const HIGH_TIMES_TYPICAL = 2

// Amex Membership Rewards and Chase Ultimate Rewards at what transferring
// them can be worth: a card earning one gets the fee math again at it.
export const TRANSFER_VALUES: Record<string, number> =
  VALUATION_PROFILES['points-heavy']

export type FeeWorth = {
  card: Card
  lines: ResolvedLine[] // the typical mix, scaled to $1 a month in all
  everywhere: boolean // no typical line is a bonus category: the whole mix
  breakEven: number | null // dollars a month in those lines
  stopsAt: number | null // past this a cap ends its lead
  // The same with every statement credit used in full: 0 when the credits
  // alone outweigh the fee. Null without credits.
  credits: CreditsYear | null
  unvaluedNights: string[] // free nights with no cap and no value of the person's
  held: boolean // the person holds it, so can say what a night is worth
  creditsBreakEven: number | null
  creditsStopAt: number | null
  rivals: number // no-fee cards it was compared with
  // Why a break-even past typical spending in these lines is that high.
  high: HighBreakEven | null
  at: (monthly: number) => { card: Simulation; best: Simulation }
}

export type HighBreakEven = {
  typical: number // dollars a month typical spending puts in these lines
  rival: string // the best no-fee card below the break-even, short name
  // Lines the rival earns more on there, and whether a cap of its own ends
  // that before the break-even.
  rivalAhead: ResolvedLine[]
  rivalCapped: boolean
  edgeCents: number // cents a dollar more the card earns on the whole mix
}

// The best no-fee card for a mix and an amount doesn't depend on the fee
// card asking, and finding it is the slow part, so it's kept per catalog
// across calls. Cleared when it grows, to stay small on the hosted server.
const BEST_NO_FEE_LIMIT = 1500
const bestNoFeeRuns = new WeakMap<Catalog, Map<string, Simulation>>()

const scaled = (lines: ResolvedLine[], monthly: number) =>
  lines.map((l) => ({ ...l, monthly: l.monthly * monthly }))

// `valuations` overrides point values: the wallet's, or transfer values.
// `held` are the person's saved cards, for what their free nights are worth
// to them.
export function feeWorthKit(
  catalog: Catalog,
  today: string,
  valuations: Wallet['valuations'] = {},
  held: WalletCard[] = [],
) {
  const typical = resolveSpendLines(catalog, typicalSpend(catalog))
  let cache = bestNoFeeRuns.get(catalog)
  if (!cache) {
    cache = new Map()
    bestNoFeeRuns.set(catalog, cache)
  }
  const shared = cache
  const run = `${today}|${JSON.stringify(Object.entries(valuations).sort())}`

  const options = (card: Card) => ({
    filters: {
      kind: 'any' as const,
      business: card.business,
      noAnnualFee: false,
      issuer: null,
      includeClosed: false,
    },
    memberships: [],
    valuations,
    start: today,
  })

  // Only cards anyone can get: one that needs a membership (a Verizon
  // account, a credit union, Costco) isn't the no-fee alternative for most.
  const noFee = (card: Card) =>
    catalog.cards.filter(
      (c) =>
        c.annual_fee === 0 &&
        c.requires_membership === undefined &&
        matchesFilters(c, { ...options(card).filters, noAnnualFee: true }),
    )

  function bestNoFee(card: Card, lines: ResolvedLine[], monthly: number) {
    const key = `${run}|${String(card.business)}|${lines.map((l) => `${l.label}:${String(l.monthly)}`).join(',')}|${String(monthly)}`
    const hit = shared.get(key)
    if (hit) return hit
    const [best] = simulateSingles(
      catalog,
      noFee(card),
      scaled(lines, monthly),
      options(card),
    )
    if (!best) throw new Error('no no-fee card to compare with')
    if (shared.size >= BEST_NO_FEE_LIMIT) shared.clear()
    shared.set(key, best)
    return best
  }

  // The card's bonus lines: those where it earns more than its own base
  // rate on the typical month, all at once with its best picks. A card that
  // picks two categories of six earns a bonus on two of them, not all six.
  function bonusLines(card: Card): ResolvedLine[] {
    const cents = currencyValuation(
      catalog,
      { valuations },
      card.currency,
    ).centsPerUnit
    const [sim] = simulateSingles(catalog, [card], typical, options(card))
    return typical.filter(
      (line) =>
        (sim?.lines.find((l) => l.label === line.label)?.returnPct ?? 0) >
        card.base_rate * cents + EPSILON,
    )
  }

  function feeWorth(card: Card): FeeWorth | null {
    if (!card.annual_fee || card.applications_closed !== undefined) return null
    if (noFee(card).length === 0) return null
    const bonus = bonusLines(card)
    const everywhere = bonus.length === 0
    // Read out in this order, so everything else comes last.
    const chosen = [...(everywhere ? typical : bonus)].sort(
      (a, b) =>
        Number(a.merchant.category === 'other') -
        Number(b.merchant.category === 'other'),
    )
    const total = chosen.reduce((s, l) => s + l.monthly, 0)
    const lines = chosen.map((l) => ({ ...l, monthly: l.monthly / total }))
    const runs = new Map<number, { card: Simulation; best: Simulation }>()
    const at = (monthly: number) => {
      const hit = runs.get(monthly)
      if (hit) return hit
      const [own] = simulateSingles(
        catalog,
        [card],
        scaled(lines, monthly),
        options(card),
      )
      if (!own) throw new Error(`no simulation for ${card.id}`)
      const run = { card: own, best: bestNoFee(card, lines, monthly) }
      runs.set(monthly, run)
      return run
    }
    const { breakEven, stopsAt } = firstLead(
      (m) => at(m).card.net > at(m).best.net,
      STEP,
    )
    const high =
      breakEven === null || breakEven <= HIGH_TIMES_TYPICAL * total
        ? null
        : highBreakEven(lines, breakEven, total, at)
    const own = held.find((h) => h.id === card.id) ?? null
    const year = allCreditsYear(catalog, card, today, valuations, own)
    // The simulation counts each night at its cap; the person's own value
    // replaces that.
    const ownExtra = roundCents(
      year.yearly - allCreditsYear(catalog, card, today, valuations).yearly,
    )
    const credits = year.creditIds.length > 0 ? year : null
    const withCredits =
      credits === null
        ? { breakEven: null, stopsAt: null }
        : firstLead(
            (m) => at(m).card.netIfCreditsUsed + ownExtra > at(m).best.net,
            0,
          )
    return {
      card,
      lines,
      everywhere,
      breakEven,
      stopsAt,
      credits,
      unvaluedNights: year.unvaluedNightIds,
      held: own !== null,
      creditsBreakEven: withCredits.breakEven,
      creditsStopAt: withCredits.stopsAt,
      rivals: noFee(card).length,
      high,
      at,
    }
  }

  // Read halfway to the break-even, where the no-fee card still leads.
  function highBreakEven(
    lines: ResolvedLine[],
    breakEven: number,
    typical: number,
    at: FeeWorth['at'],
  ): HighBreakEven | null {
    const half = Math.max(STEP, Math.round(breakEven / 2 / STEP) * STEP)
    const { card, best } = at(half)
    const rival = catalog.cards.find((c) => c.id === best.cards[0]?.cardId)
    if (!rival || card.spend <= 0) return null
    const rate = (sim: Simulation, label: string) =>
      sim.lines.find((l) => l.label === label)?.returnPct ?? 0
    const rivalAhead = lines.filter(
      (l) => rate(best, l.label) > rate(card, l.label) + EPSILON,
    )
    const later = at(breakEven).best
    return {
      typical,
      rival: shortCardName(rival.name),
      rivalAhead,
      rivalCapped: rivalAhead.some(
        (l) => rate(later, l.label) < rate(best, l.label) - EPSILON,
      ),
      edgeCents: ((card.rewards - best.rewards) / card.spend) * 100,
    }
  }

  return { feeWorth }
}

// The first monthly amount, from `from` up, at which `ahead` holds (to the
// nearest $10), and the amount past which it stops holding, if it does.
function firstLead(ahead: (monthly: number) => boolean, from: number) {
  let breakEven: number | null = null
  let stopsAt: number | null = null
  for (let m = from; m <= MAX_MONTHLY; m += STEP) {
    const lead = ahead(m)
    if (breakEven === null && lead) {
      let lo = m - STEP
      let hi = m
      while (m > 0 && hi - lo > 10) {
        const mid = Math.round((lo + hi) / 20) * 10
        if (mid <= lo || mid >= hi) break
        if (ahead(mid)) hi = mid
        else lo = mid
      }
      breakEven = hi
    } else if (breakEven !== null && !lead) {
      stopsAt = m - STEP
      break
    }
  }
  return { breakEven, stopsAt }
}

// The sentences take `esc` and `strong` so the card page can mark them up;
// plain text by default.
export type Markup = {
  esc: (s: string) => string
  strong: (s: string) => string
}

const PLAIN: Markup = { esc: (s) => s, strong: (s) => s }

// "supermarkets" mid-sentence, but "Amazon" keeps its capital. A line spent
// at a store and named for its kind ("Streaming services" at Netflix) reads
// as the kind.
export const lineWords = (l: ResolvedLine) =>
  l.merchant.source === 'category' || l.label !== l.merchant.resolvedName
    ? midSentence(l.label)
    : l.label

// Whole percents of `lines` that add up to 100: each share rounded down,
// then the points left over to the largest remainders.
export function wholeShares(lines: ResolvedLine[]): number[] {
  const total = lines.reduce((s, l) => s + l.monthly, 0)
  if (total <= 0) return lines.map(() => 0)
  const exact = lines.map((l) => (l.monthly / total) * 100)
  const shares = exact.map(Math.floor)
  let left = 100 - shares.reduce((s, n) => s + n, 0)
  const byRemainder = exact
    .map((x, i) => ({ i, rest: x - Math.floor(x) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (const { i } of byRemainder) {
    if (left <= 0) break
    shares[i] = (shares[i] ?? 0) + 1
    left -= 1
  }
  return shares
}

// "67% supermarkets and 33% restaurants"
export function feeWorthMix(w: FeeWorth): string {
  const shares = wholeShares(w.lines)
  return inOrder(
    w.lines.map((l, i) => `${pct(shares[i] ?? 0)} ${lineWords(l)}`),
  )
}

export const EARNING_ONLY =
  'This counts only what the card earns, not lounge access or other benefits.'

export function feeWorthVerdict(
  w: FeeWorth,
  name: string,
  { esc, strong }: Markup = PLAIN,
  withWhy = true,
): string {
  const fee = wholeDollars(w.card.annual_fee ?? 0)
  const where = w.everywhere
    ? 'spending'
    : `spending on ${inOrder(w.lines.map(lineWords))}`
  const verdict =
    w.breakEven === null
      ? `On earning alone, the ${esc(name)} doesn't earn more than the best no-fee card after its ${esc(fee)} fee, at any amount up to ${esc(wholeDollars(MAX_MONTHLY))} a month of ${esc(where)}.`
      : `On earning alone, the ${esc(name)} earns more than the best no-fee card, after its ${esc(fee)} fee, from about ${strong(`${esc(wholeDollars(w.breakEven))} a month`)} of ${esc(where)}${w.stopsAt === null ? '' : `, up to about ${esc(wholeDollars(w.stopsAt))} a month (past that, a spending cap ends its lead)`}.`
  const why = withWhy ? highText(w) : ''
  return why === '' ? verdict : `${verdict} ${esc(why)}`
}

// "That's far more than typical spending on these (about $385 a month),
// because the Ink Business Cash, a no-fee card, earns more on cell phone
// service, and TV and internet service until its spending cap runs out."
export function highText(w: FeeWorth): string {
  const h = w.high
  if (h === null) return ''
  const these = w.everywhere ? 'this spending' : 'these'
  const typical = `That's far more than typical spending on ${these} (about ${wholeDollars(h.typical)} a month)`
  if (h.rivalAhead.length > 0) {
    const ahead = `the ${h.rival}, a no-fee card, earns more on ${inOrder(h.rivalAhead.map(lineWords))}`
    return h.rivalCapped
      ? `${typical}, because ${ahead} until its spending cap runs out.`
      : `${typical}, because ${ahead}, so this card's lead on the rest has to make up its fee.`
  }
  const edge = Math.round(h.edgeCents * 10) / 10
  return edge <= 0
    ? ''
    : `${typical}, because it earns about ${num(edge)}¢ more per dollar than the ${h.rival}, a no-fee card, and that has to add up to its ${wholeDollars(w.card.annual_fee ?? 0)} fee.`
}

// "If you transfer Chase Ultimate Rewards to airlines and hotels and count
// them at 1.7¢ each": `points` as it should appear, escaped if need be.
export const transferIfText = (points: string, cents: number) =>
  `If you transfer ${points} to airlines and hotels and count them at ${num(cents)}¢ each`

// The same math with points transferred to airlines and hotels.
export function feeWorthTransfer(
  catalog: Catalog,
  card: Card,
  transfer: { worth: FeeWorth | null; cents: number },
  { esc, strong }: Markup = PLAIN,
): string {
  const points = currencyName(catalog, card.currency)
  const breakEven = transfer.worth?.breakEven ?? null
  return breakEven === null
    ? `${transferIfText(esc(points), transfer.cents)}, it still doesn't come out ahead within ${esc(wholeDollars(MAX_MONTHLY))} a month.`
    : `${transferIfText(esc(points), transfer.cents)}, it comes out ahead from about ${strong(`${esc(wholeDollars(breakEven))} a month`)}.`
}

// A free night with no point cap, which the math leaves out.
function unvaluedText(w: FeeWorth): string {
  if (w.unvaluedNights.length === 0) return ''
  return w.held
    ? `Its ${FREE_NIGHT_NAME} isn't counted until you say what it's worth to you.`
    : `Its ${FREE_NIGHT_NAME} isn't counted: with no point cap, what it's worth depends on the hotel.`
}

// With every credit and free night used; empty for a card without them.
export function feeWorthCredits(
  catalog: Catalog,
  w: FeeWorth,
  markup: Markup = PLAIN,
): string {
  return [creditsSentences(catalog, w, markup), markup.esc(unvaluedText(w))]
    .filter((s) => s !== '')
    .join(' ')
}

// The no-fee card that overtakes the fee card once its credits stop being
// enough: the best one just past that amount. Null when it never does.
function overtaker(catalog: Catalog, w: FeeWorth): Card | null {
  if (w.credits === null || w.creditsStopAt === null) return null
  const id = w.at(w.creditsStopAt + STEP).best.cards[0]?.cardId
  return catalog.cards.find((c) => c.id === id) ?? null
}

function creditsSentences(
  catalog: Catalog,
  w: FeeWorth,
  { esc, strong }: Markup,
): string {
  if (w.credits === null) return ''
  const fee = wholeDollars(w.card.annual_fee ?? 0)
  // Why the credits' lead ends: a cap on the card's rate, or a rate below
  // the no-fee card's, so each dollar more narrows it.
  const why =
    w.stopsAt !== null
      ? ", since a spending cap ends this card's lead"
      : ', since each extra dollar earns less on this card than on that one'
  const rival = overtaker(catalog, w)
  const rivalName =
    rival === null ? 'the best no-fee card' : `the ${shortCardName(rival.name)}`
  const pastThat =
    w.creditsStopAt === null
      ? ''
      : `; past about ${esc(wholeDollars(w.creditsStopAt))} a month, ${esc(rivalName)} earns more${why}`
  // "all its statement credits", "its statement credit", "its free night",
  // "all its statement credits and free night", "its statement credit and
  // free night"
  const credits = w.credits.names.length - w.credits.nightIds.length
  const perks = `${w.credits.names.length > 1 && credits !== 1 ? 'all ' : ''}its ${perksNoun(w.credits, true, true)}`
  // The yearly points count too, so they're named beside the credits.
  const yearly = yearlyPointsCounted(catalog, w.card)
  const worthMore =
    yearly !== null
      ? `${w.credits.names.length === 1 ? 'it' : 'they'} and ${yearly} are worth`
      : w.credits.names.length === 1
        ? "it's worth"
        : "they're worth"
  // "$100 a year at Chase Travel" for one credit, else the list.
  const lone =
    w.credits.names.length === 1 && w.credits.nightIds.length === 0
      ? w.card.credits.find((c) => c.id === w.credits?.creditIds[0])
      : undefined
  const year =
    lone === undefined
      ? creditsYearText(w.credits)
      : `${wholeDollars(w.credits.yearly)} a year ${creditWhere(catalog, lone)}`
  const sentence =
    w.creditsBreakEven === null
      ? `Even if you'd use ${esc(perks)} (${esc(year)}), it doesn't come out ahead within ${esc(wholeDollars(MAX_MONTHLY))} a month.`
      : w.creditsBreakEven === 0 && w.creditsStopAt === 0
        ? `If you'd use ${esc(perks)} (${esc(year)}), ${worthMore} more than its ${esc(fee)} fee, but from about ${esc(wholeDollars(STEP))} a month of spending ${esc(rivalName)} earns more${why}.`
        : w.creditsBreakEven === 0
          ? `If you'd use ${esc(perks)} (${esc(year)}), ${worthMore} more than its ${esc(fee)} fee, so it comes out ahead ${w.creditsStopAt === null ? 'at any amount' : `up to about ${esc(wholeDollars(w.creditsStopAt))} a month; past that, ${esc(rivalName)} earns more${why}`}.`
          : `If you'd use ${esc(perks)} (${esc(year)}), the fee pays off from about ${strong(`${esc(wholeDollars(w.creditsBreakEven))} a month`)}${pastThat}.`
  const onlyIf = creditsOnlyIf(w.credits, true)
  return onlyIf === '' ? sentence : `${sentence} ${esc(onlyIf)}`
}

export type FeeWorthAnswer = {
  annualFee: number
  mix: { label: string; share: number }[] // share in percent
  everywhere: boolean
  breakEven: number | null
  stopsAt: number | null
  creditsYearly: number | null
  creditsBreakEven: number | null
  creditsStopAt: number | null
  centsPerUnit: number
  savedValue: boolean // the wallet's point value, not earnrate's default
  rivals: number
  // At transfer value, for points that transfer and have no saved value.
  transfer: { cents: number; breakEven: number | null } | null
  text: string
}

// The card page's verdict as plain text, with what it assumes, for answers.
export function feeWorthAnswer(
  catalog: Catalog,
  w: FeeWorth,
  valuations: Wallet['valuations'],
  transfer: { worth: FeeWorth | null; cents: number } | null = null,
): FeeWorthAnswer {
  const { card } = w
  const { centsPerUnit } = currencyValuation(
    catalog,
    { valuations },
    card.currency,
  )
  const savedValue =
    card.currency !== 'cash' && valuations[card.currency] !== undefined
  const value =
    card.currency === 'cash'
      ? 'cash back at face value'
      : `${currencyName(catalog, card.currency)} at ${num(centsPerUnit)}¢ each (${savedValue ? 'the saved point value' : "earnrate's default"})`
  // The person's own value for the overtaking card's points, which can be
  // what puts it ahead.
  const rival = overtaker(catalog, w)
  const rivalValue =
    rival === null ||
    rival.currency === 'cash' ||
    rival.currency === card.currency ||
    valuations[rival.currency] === undefined
      ? ''
      : `; ${currencyName(catalog, rival.currency)} at your ${num(currencyValuation(catalog, { valuations }, rival.currency).centsPerUnit)}¢ each`
  const mix = feeWorthMix(w)
  const membership =
    w.at(STEP).card.membershipFees > 0
      ? ', the membership it needs counted like a fee'
      : ''
  const yearly = yearlyPointsCounted(catalog, card)
  const assumes = `Assumes typical U.S. spending (${w.everywhere ? `no typical category earns it a bonus, so earnrate's whole typical mix: ${mix}` : `the typical mix of its bonus categories: ${mix}`}), the same every month for a year; ${value}${rivalValue}; the regular annual fee${membership}${yearly === null ? '' : `; ${yearly}`}; no welcome bonus or first-year rates. Compared with the best of ${String(w.rivals)} no-fee ${card.business ? 'business' : 'personal'} cards that need no membership.`
  return {
    annualFee: card.annual_fee ?? 0,
    mix: w.lines.map((l, i) => ({
      label: l.label,
      share: wholeShares(w.lines)[i] ?? 0,
    })),
    everywhere: w.everywhere,
    breakEven: w.breakEven,
    stopsAt: w.stopsAt,
    creditsYearly: w.credits?.yearly ?? null,
    creditsBreakEven: w.creditsBreakEven,
    creditsStopAt: w.creditsStopAt,
    centsPerUnit,
    savedValue,
    rivals: w.rivals,
    transfer:
      transfer === null
        ? null
        : {
            cents: transfer.cents,
            breakEven: transfer.worth?.breakEven ?? null,
          },
    text: [
      feeWorthVerdict(w, shortCardName(card.name)),
      transfer === null ? '' : feeWorthTransfer(catalog, card, transfer),
      EARNING_ONLY,
      feeWorthCredits(catalog, w),
      assumes,
    ]
      .filter((s) => s !== '')
      .join(' '),
  }
}
