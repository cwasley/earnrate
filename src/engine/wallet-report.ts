// "Rate my wallet": what a set of cards nets in a year on some spending,
// against one flat-rate card and the best two cards for that spending, with
// each fee card's verdict, the card that would add the most, and the lines
// where a better card earns clearly more. Built only from what a shared
// report link carries (cards, picks, memberships, point values, spending),
// so whoever opens one sees the same figures. Node-free: earnrate.dev runs
// it in the browser.
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { findMerchant } from '../merchants/resolve.ts'
import { EPSILON, HALF_CENT, isClose } from './compare.ts'
import {
  ALL_PERSONAL_CARDS,
  idealHolding,
  matchesFilters,
  type CardFilters,
  type Picks,
} from './explore.ts'
import {
  keepOrReplace,
  keepOrReplaceUnsaid,
  keepOrReplaceVerdict,
  OTHER_PERKS,
  type KeepOrReplaceOutcome,
} from './keep-or-replace.ts'
import {
  creditChoices,
  unsaidCreditsYear,
  usedCreditsYear,
  type CreditChoice,
  type CreditsYear,
} from './credits.ts'
import { missingMembership, paidMemberships } from './memberships.ts'
import { inEffect } from './periods.ts'
import type { Spending } from './renewal.ts'
import { optionName } from './rule-text.ts'
import {
  bestSimulation,
  countedLines,
  projectedWallet,
  simulateAdditions,
  simulateCatalog,
  simulateSingles,
  simulateWallet,
  TYPICAL_SPEND_NOTE,
  type Addition,
  type PairSimulation,
  type ResolvedLine,
  type SimulateOptions,
  type Simulation,
} from './simulate.ts'
import {
  capitalize,
  creditsOnlyIf,
  feeCardExtrasText,
  FREE_NIGHT_NAME,
  inOrder,
  listed,
  midSentence,
  money,
  pct,
  perksNoun,
  perksTotal,
  roundCents,
  shortCardName,
  wholeDollars,
  type Voice,
} from './text.ts'

export type ReportInput = {
  // `used` and `skipped`: the card's credit and free night ids the wallet
  // marks as used, or as not used.
  cards: { id: string; picks: Picks; used?: string[]; skipped?: string[] }[]
  memberships: string[]
  valuations: Record<string, number> // cents a point, by currency
}

export type ReportCard = {
  cardId: string
  picks: Picks
  // No picks came with the card, so the best ones for the spending are used.
  assumed: boolean
}

export type FlatComparison = {
  cardId: string
  net: number // a year, alone on the same spending
  returnPct: number
  ties: string[] // flat-rate cards that net the same
}

export type FeeVerdict = {
  cardId: string
  fee: number
  // What it adds beyond the other cards after its fee; held alone, beyond
  // the best no-fee card.
  net: number
  // On rewards alone, after its fee.
  paysForItself: boolean
  // It doesn't on rewards, but its credits would cover the rest if used.
  creditsCover: boolean
  perks: string // "statement credits", "free night"; empty for none
  outcome: KeepOrReplaceOutcome
  counted: number // its credits marked as used, a year: in `net`
  verdict: string // keep-or-replace's answer
  credits: string // what its statement credits would add, or empty
  // The same answer as figures, for the short sentences on /rate.
  alone: boolean
  against: string | null // held alone: the no-fee card `net` is against
  used: string[] // the names of its credits counted in `net`
  unsaid: CreditsYear // its credits not marked either way
  unvaluedNight: boolean // a free night with no value to count it at
  instead: { cardId: string; net: number; annualFee: number } | null
}

export type Gap = {
  label: string
  spend: number // a year
  heldPct: number
  heldCardId: string | null
  bestCardId: string
  bestPct: number
  fee: number // its annual fee
  dollars: number // a year more with the best card on this line
}

// The fast part, for the page's first paint.
export type ReportStart = {
  cards: ReportCard[]
  empty: boolean
  business: boolean
  typical: boolean
  monthly: number // dollars a month counted
  lines: ResolvedLine[] // the lines counted
  simulation: Simulation
  net: number
  flat: FlatComparison | null
  // Each card's credits and free nights marked as used: in `net`.
  counted: CreditsYear[]
  // Each card's credits and free nights not marked either way, as if all
  // were used: left out of `net`.
  credits: CreditsYear[]
  // While any of those is worth something: `net`, to what the cards would
  // net with every one used. Null once each is answered.
  range: NetRange | null
  // Each card with credits or free nights, to mark as used or not.
  creditChoices: CardCredits[]
}

export type NetRange = { low: number; high: number }

export type CardCredits = { cardId: string; choices: CreditChoice[] }

// The best two cards for the spending, and the best one, which is the
// answer when no pair beats it.
export type BestCards = {
  pair: PairSimulation | null
  single: Simulation | null
}

export type WalletReport = ReportStart & {
  best: BestCards
  feeCards: FeeVerdict[]
  next: Addition | null
  gaps: Gap[]
  dataVersion: string
}

const whole = (n: number) => Math.round(n)

const nameOf = (catalog: Catalog, id: string) =>
  shortCardName(catalog.cards.find((c) => c.id === id)?.name ?? id)

const known = (catalog: Catalog, input: ReportInput) =>
  input.cards.filter((c) => catalog.cards.some((x) => x.id === c.id))

function options(
  catalog: Catalog,
  input: ReportInput,
  today: string,
): SimulateOptions & { filters: CardFilters } {
  const cards = known(catalog, input)
  const business =
    cards.length > 0 &&
    cards.every((c) => catalog.cards.find((x) => x.id === c.id)?.business)
  return {
    filters: { ...ALL_PERSONAL_CARDS, business },
    memberships: input.memberships,
    valuations: input.valuations,
    start: today,
  }
}

// The wallet a report runs on: the cards with their picks, and for a card
// with a choice and no picks, the picks that net the most beside the others.
export function reportWallet(
  catalog: Catalog,
  input: ReportInput,
  today: string,
  spending: Spending,
): { wallet: Wallet; cards: ReportCard[] } {
  const ids = known(catalog, input).map((c) => c.id)
  const picks = new Map(input.cards.map((c) => [c.id, c.picks]))
  const marks = new Map(input.cards.map((c) => [c.id, c]))
  const assumed = new Set<string>()
  const holding = (id: string) => {
    const card = catalog.cards.find((c) => c.id === id)
    return card ? [idealHolding(card, today, picks.get(id) ?? {})] : []
  }
  for (const id of ids) {
    const card = catalog.cards.find((c) => c.id === id)
    const given = picks.get(id) ?? {}
    if (!card || card.choices.every((c) => (given[c.id] ?? []).length > 0))
      continue
    const best = bestSimulation(
      catalog,
      ids.filter((x) => x !== id).flatMap(holding),
      card,
      spending.lines,
      { ...options(catalog, input, today), held: ids },
    )
    picks.set(id, { ...(best.cards.at(-1)?.picks ?? {}), ...given })
    assumed.add(id)
  }
  const picked = (id: string) => picks.get(id) ?? {}
  return {
    wallet: {
      valuations: input.valuations,
      memberships: input.memberships,
      cards: ids.map((id): WalletCard => ({
        id,
        cap_usage: {},
        activated: [],
        ...((marks.get(id)?.used ?? []).length > 0
          ? { enrolled: marks.get(id)?.used ?? [] }
          : {}),
        ...((marks.get(id)?.skipped ?? []).length > 0
          ? { skipped_credits: marks.get(id)?.skipped ?? [] }
          : {}),
        ...(Object.keys(picked(id)).length > 0
          ? { chosen: { period: '', picks: picked(id) } }
          : {}),
      })),
    },
    cards: ids.map((id) => ({
      cardId: id,
      picks: picked(id),
      assumed: assumed.has(id),
    })),
  }
}

// A no-fee card anyone can get that pays one rate on everything: any higher
// rate is for a membership tier, a way of paying, or a booking site.
export function flatRateCard(
  catalog: Catalog,
  card: Card,
  today: string,
): boolean {
  if (
    card.annual_fee !== 0 ||
    card.requires_membership !== undefined ||
    card.network === 'store' ||
    card.applications_closed !== undefined ||
    card.choices.length > 0
  )
    return false
  return card.rules.every((rule) => {
    if (!inEffect(rule, today) || rule.rate <= card.base_rate) return true
    const { any, categories, mccs, choice, merchants } = rule.match
    if (any)
      return (
        rule.requires?.membership !== undefined ||
        rule.requires?.payment !== undefined
      )
    return (
      categories === undefined &&
      mccs === undefined &&
      choice === undefined &&
      (merchants ?? []).every((m) => {
        const kind = findMerchant(catalog, m)?.kind
        return kind === 'portal' || kind === 'booking'
      })
    )
  })
}

function flatComparison(
  catalog: Catalog,
  input: ReportInput,
  today: string,
  spending: Spending,
): FlatComparison | null {
  const opts = options(catalog, input, today)
  const flat = catalog.cards.filter(
    (c) =>
      flatRateCard(catalog, c, today) &&
      matchesFilters(c, { ...opts.filters, noAnnualFee: true }),
  )
  const [best, ...rest] = simulateSingles(catalog, flat, spending.lines, opts)
  const cardId = best?.cards[0]?.cardId
  if (!best || cardId === undefined) return null
  return {
    cardId,
    net: best.net,
    returnPct: best.spend > 0 ? (best.rewards / best.spend) * 100 : 0,
    ties: rest
      .filter((s) => Math.abs(s.net - best.net) < HALF_CENT)
      .flatMap((s) => s.cards.map((c) => c.cardId)),
  }
}

export function reportStart(
  catalog: Catalog,
  input: ReportInput,
  today: string,
  spending: Spending,
  voice: Voice = 'you',
): ReportStart {
  const { wallet, cards } = reportWallet(catalog, input, today, spending)
  const ids = wallet.cards.map((c) => c.id)
  const simulation = simulateWallet(
    catalog,
    projectedWallet(wallet, catalog, today),
    spending.lines,
    today,
    ids,
    voice,
  )
  const lines = countedLines(catalog, spending.lines)
  const credits = wallet.cards.flatMap((held) => {
    const card = catalog.cards.find((c) => c.id === held.id)
    if (!card) return []
    const year = unsaidCreditsYear(catalog, card, held, today, input.valuations)
    return year.yearly > 0 ? [year] : []
  })
  const unanswered = perksTotal(credits).yearly
  return {
    cards,
    empty: ids.length === 0,
    business: options(catalog, input, today).filters.business,
    typical: spending.typical,
    monthly: lines.reduce((sum, l) => sum + l.monthly, 0),
    lines,
    simulation,
    net: simulation.net,
    flat: flatComparison(catalog, input, today, spending),
    counted: simulation.credits.filter((c) => c.held && c.yearly > 0),
    credits,
    range:
      unanswered > 0
        ? {
            low: simulation.net,
            high: roundCents(simulation.net + unanswered),
          }
        : null,
    creditChoices: wallet.cards.flatMap((held) => {
      const card = catalog.cards.find((c) => c.id === held.id)
      const choices = card
        ? creditChoices(catalog, card, held, today, input.valuations)
        : []
      return choices.length > 0 ? [{ cardId: held.id, choices }] : []
    }),
  }
}

// Each card's part of the report's figure, in whole dollars: what it earns
// on the spending it takes plus its credits counted, less its fee. The
// cards' nets add up to the figure, and while credits are unanswered each
// card's `upTo` (its net where it has none) adds up to the range's top.
export type CardShare = {
  cardId: string
  fee: number // its annual fee, and a membership it needs that isn't paid
  earned: number // rewards on the spending it takes, plus credits counted
  net: number // earned less fee
  // Its net with every credit and free night not yet answered used; null
  // when it has none.
  upTo: number | null
}

// Whole dollars for `amounts` that add up to `total` rounded: each rounded
// down, then a dollar more for the largest remainders, or a dollar less for
// the smallest when cents leave the total lower.
function apportion(amounts: number[], total: number): number[] {
  const out = amounts.map((a) => Math.floor(a + EPSILON))
  let left = Math.round(total) - out.reduce((sum, n) => sum + n, 0)
  const order = amounts
    .map((a, i) => ({ i, rest: a - Math.floor(a + EPSILON) }))
    .sort((a, b) => b.rest - a.rest)
  for (let k = 0; left !== 0 && order.length > 0; k++) {
    const up = left > 0
    const at = up
      ? order[k % order.length]
      : order[order.length - 1 - (k % order.length)]
    if (!at) break
    out[at.i] = (out[at.i] ?? 0) + (up ? 1 : -1)
    left += up ? -1 : 1
  }
  return out
}

export function cardShares(catalog: Catalog, r: ReportStart): CardShare[] {
  const sim = r.simulation
  const ids = sim.byCard.map((c) => c.cardId)
  // A membership two cards need is counted once, on the first.
  const membershipFee = (cardId: string) =>
    sim.memberships
      .filter((m) => m.cardIds.find((id) => ids.includes(id)) === cardId)
      .reduce((sum, m) => sum + m.annualFee, 0)
  const parts = sim.byCard.map((c) => {
    const fee =
      (catalog.cards.find((x) => x.id === c.cardId)?.annual_fee ?? 0) +
      membershipFee(c.cardId)
    const credits = r.counted.find((x) => x.cardId === c.cardId)?.yearly ?? 0
    const unsaid = r.credits.find((x) => x.cardId === c.cardId)?.yearly ?? 0
    return { cardId: c.cardId, fee, exact: c.rewards + credits - fee, unsaid }
  })
  const nets = apportion(
    parts.map((p) => p.exact),
    r.net,
  )
  const extra =
    r.range === null
      ? parts.map(() => 0)
      : apportion(
          parts.map((p) => p.unsaid),
          Math.round(r.range.high) - Math.round(r.net),
        )
  return parts.map((p, i) => {
    const net = nets[i] ?? 0
    const fee = Math.round(p.fee)
    return {
      cardId: p.cardId,
      fee,
      earned: net + fee,
      net,
      upTo: p.unsaid > 0 ? net + (extra[i] ?? 0) : null,
    }
  })
}

export function reportBest(
  catalog: Catalog,
  input: ReportInput,
  today: string,
  spending: Spending,
  // The card to add: beside one held card it makes a pair, which the
  // catalog's shortlist of pairs can miss.
  next: Addition | null = null,
): BestCards {
  const { pairs, singles } = simulateCatalog(
    catalog,
    spending.lines,
    options(catalog, input, today),
  )
  const [pair = null] = pairs
  const [single = null] = singles
  const held = known(catalog, input)
  const withNext =
    next !== null && held.length === 1
      ? {
          ...next.simulation,
          alternatives: [],
          // Like with like: no pair counts any credits.
          heldCredits: 0,
          net: roundCents(next.simulation.net - next.simulation.heldCredits),
        }
      : null
  const bestPair =
    withNext !== null && (pair === null || withNext.net > pair.net + EPSILON)
      ? withNext
      : pair
  const bestSingle =
    next !== null &&
    held.length === 0 &&
    (single === null || next.simulation.net > single.net + EPSILON)
      ? next.simulation
      : single
  return { pair: bestPair, single: bestSingle }
}

// A pair beats one card when it nets at least half a dollar more, as Get a
// card says.
export const pairBeats = (
  b: BestCards,
): b is BestCards & {
  pair: PairSimulation
} => b.pair !== null && (b.single === null || b.pair.net - b.single.net >= 0.5)

// Each fee card's keep-or-replace answer on the report's wallet, which
// counts no statement credits: the report doesn't know which are used.
// `only` asks about one card, so a page can show each as it's done.
export function reportFeeCards(
  catalog: Catalog,
  input: ReportInput,
  today: string,
  spending: Spending,
  only?: string,
  voice: Voice = 'you',
): FeeVerdict[] {
  const { wallet } = reportWallet(catalog, input, today, spending)
  return wallet.cards.flatMap((held) => {
    if (only !== undefined && held.id !== only) return []
    const k = keepOrReplace(catalog, wallet, held.id, today, spending)
    if (!k) return []
    const unsaid = k.unsaid
    const credits = keepOrReplaceUnsaid(k, voice)
    const paysForItself = whole(k.renewal.net) > 0
    const card = catalog.cards.find((c) => c.id === held.id)
    const [best] = k.replacements
    return [
      {
        cardId: held.id,
        fee: k.fee,
        net: k.renewal.net,
        counted: k.renewal.credits,
        paysForItself,
        creditsCover:
          whole(k.renewal.net) <= 0 && whole(k.renewal.net + unsaid.yearly) > 0,
        perks: unsaid.yearly > 0 ? perksNoun(unsaid, true, true) : '',
        outcome: k.outcome,
        verdict: keepOrReplaceVerdict(catalog, k, paysForItself, voice),
        credits,
        alone: k.alone,
        against: k.renewal.against,
        used: card
          ? usedCreditsYear(catalog, card, held, k.start, wallet.valuations)
              .names
          : [],
        unsaid,
        unvaluedNight:
          k.renewal.nightsUnvalued > 0 && unsaid.unvaluedNightIds.length > 0,
        instead:
          best === undefined || k.outcome === 'not-needed'
            ? null
            : { cardId: best.cardId, net: best.net, annualFee: best.annualFee },
      },
    ]
  })
}

export function reportNext(
  catalog: Catalog,
  input: ReportInput,
  today: string,
  spending: Spending,
): Addition | null {
  const { wallet } = reportWallet(catalog, input, today, spending)
  const [best] = simulateAdditions(
    catalog,
    wallet,
    spending.lines,
    options(catalog, input, today),
  ).additions
  return best && whole(best.gain) > 0 ? best : null
}

// Lines where the wallet's return isn't close to the best one card's on that
// line alone (with its best picks), by `isClose`; most dollars first.
export function reportGaps(
  catalog: Catalog,
  input: ReportInput,
  today: string,
  spending: Spending,
  simulation: Simulation,
  nextCardId: string | null,
): Gap[] {
  const ids = known(catalog, input).map((c) => c.id)
  if (ids.length === 0) return []
  const opts = options(catalog, input, today)
  const has = paidMemberships(catalog, {
    memberships: input.memberships,
    heldCards: ids,
    merchantIds: spending.lines.map((l) => l.merchant.merchantId),
  })
  const eligible = catalog.cards.filter(
    (c) =>
      matchesFilters(c, opts.filters) && missingMembership(c, has) === null,
  )
  const pctOf = (s: Simulation) => s.lines[0]?.returnPct ?? 0
  return countedLines(catalog, spending.lines)
    .flatMap((line): Gap[] => {
      const held = simulation.lines.find((l) => l.label === line.label)
      if (!held) return []
      const ranked = simulateSingles(catalog, eligible, [line], opts).sort(
        (a, b) => pctOf(b) - pctOf(a),
      )
      const [top] = ranked
      if (!top || isClose(held.returnPct, pctOf(top))) return []
      // The best card on the line that would pay its own fee from the line
      // alone, or that is the card to add, so the two never disagree.
      const gaps = ranked.flatMap((s): Gap[] => {
        const cardId = s.cards[0]?.cardId
        if (cardId === undefined || ids.includes(cardId)) return []
        if (isClose(held.returnPct, pctOf(s))) return []
        const dollars = roundCents(
          ((pctOf(s) - held.returnPct) / 100) * held.spend,
        )
        const fee = catalog.cards.find((c) => c.id === cardId)?.annual_fee ?? 0
        if (fee > 0 && whole(dollars - fee) <= 0 && cardId !== nextCardId)
          return []
        return [
          {
            label: line.label,
            spend: held.spend,
            heldPct: held.returnPct,
            heldCardId: held.cards[0] ?? null,
            bestCardId: cardId,
            bestPct: pctOf(s),
            fee,
            dollars,
          },
        ]
      })
      return gaps.slice(0, 1)
    })
    .sort((a, b) => b.dollars - a.dollars)
}

export function walletReport(
  catalog: Catalog,
  input: ReportInput,
  today: string,
  spending: Spending,
  dataVersion: string,
): WalletReport {
  const start = reportStart(catalog, input, today, spending)
  const next = reportNext(catalog, input, today, spending)
  return {
    ...start,
    best: reportBest(catalog, input, today, spending, next),
    feeCards: reportFeeCards(catalog, input, today, spending),
    next,
    gaps: reportGaps(
      catalog,
      input,
      today,
      spending,
      start.simulation,
      next?.cardId ?? null,
    ),
    dataVersion,
  }
}

// "on your spending of $1,750 a month", "on typical U.S. spending of about
// $1,990 a month"
export const spendingBasis = (r: Pick<ReportStart, 'typical' | 'monthly'>) =>
  r.typical
    ? `on typical U.S. spending of about ${wholeDollars(r.monthly)} a month`
    : `on your spending of ${wholeDollars(r.monthly)} a month`

// The headline figure: "$1,240", or while credits are unanswered,
// "−$591 to +$2,827" (a plus only beside a minus).
export function netFigure(r: Pick<ReportStart, 'net' | 'range'>): string {
  if (r.range === null) return wholeDollars(r.net)
  const { low, high } = r.range
  return `${wholeDollars(low)} to ${low < 0 && high > 0 ? '+' : ''}${wholeDollars(high)}`
}

// The headline figure in a sentence, with what makes it up. With a range
// and no credit used, that's its low end, without credits.
export function headlineText(catalog: Catalog, r: ReportStart): string {
  if (r.empty)
    return r.flat === null
      ? 'There are no cards to rate yet.'
      : `There are no cards to rate yet. ${capitalize(spendingBasis(r))}, the ${nameOf(catalog, r.flat.cardId)} alone would net about ${wholeDollars(r.flat.net)} a year.`
  const one = r.cards.length === 1
  const subject = one
    ? `Your ${nameOf(catalog, r.cards[0]?.cardId ?? '')} nets`
    : `Your ${String(r.cards.length)} cards net`
  const fees = r.simulation.annualFees + r.simulation.membershipFees
  const counted = perksTotal(r.counted)
  const extras =
    r.counted.length === 0
      ? ''
      : `${feeCardExtrasText({
          credits: counted.yearly,
          freeNights: counted.nights ?? 0,
          ownNights: 0,
        })} on ${listed(r.counted.map((c) => `the ${nameOf(catalog, c.cardId)}`))}`
  const made =
    fees > 0
      ? `: ${wholeDollars(r.simulation.rewards)} in rewards${extras}, less ${one ? `its ${money(fees)} annual fee` : `${money(fees)} in annual fees`}`
      : extras === ''
        ? ` in rewards, with no annual fee${one ? '' : 's'}`
        : `: ${wholeDollars(r.simulation.rewards)} in rewards${extras}, with no annual fee${one ? '' : 's'}`
  const sentence = `${subject} about ${wholeDollars(r.net)} a year${made}, ${spendingBasis(r)}.`
  return r.range !== null && r.counted.length === 0
    ? `Without credits, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`
    : sentence
}

// What makes up the headline figure, for a page that shows the figure and
// the spending beside it: "$688 in rewards, plus $304 in credits you use,
// less $420 in annual fees."
export function breakdownText(
  catalog: Catalog,
  r: ReportStart,
  voice: Voice = 'you',
): string {
  if (r.empty) return headlineText(catalog, r)
  const one = r.cards.length === 1
  const fees = r.simulation.annualFees + r.simulation.membershipFees
  const counted = perksTotal(r.counted)
  const extras =
    r.counted.length === 0
      ? ''
      : feeCardExtrasText(
          {
            credits: counted.yearly,
            freeNights: counted.nights ?? 0,
            ownNights: 0,
          },
          voice,
        )
  const less =
    fees > 0
      ? `, less ${one ? `its ${money(fees)} annual fee` : `${money(fees)} in annual fees`}`
      : `, with no annual fee${one ? '' : 's'}`
  const sentence = `${wholeDollars(r.simulation.rewards)} in rewards${extras}${less}.`
  return r.range !== null && r.counted.length === 0
    ? `Without credits: ${sentence}`
    : sentence
}

// Against the best no-fee card with one rate for everything, held alone.
// "(2%; 4 others earn the same)"
function flatRate(f: FlatComparison): string {
  const rate = pct(Math.round(f.returnPct * 100) / 100)
  const others =
    f.ties.length === 0
      ? ''
      : `; ${f.ties.length === 1 ? 'one other earns' : `${String(f.ties.length)} others earn`} the same`
  return `(${rate}${others})`
}

export function flatText(catalog: Catalog, r: ReportStart): string {
  const f = r.flat
  if (f === null || r.empty) return ''
  const held = r.cards.map((c) => c.cardId)
  if (held.length === 1 && [f.cardId, ...f.ties].includes(held[0] ?? ''))
    return `It's the best no-fee card with one rate for everything ${flatRate(f)}.`
  const name = nameOf(catalog, f.cardId)
  const diff = r.net - f.net
  const than =
    whole(diff) === 0
      ? `That's about what the ${name} alone would earn`
      : `That's about ${wholeDollars(Math.abs(diff))} a year ${diff > 0 ? 'more' : 'less'} than the ${name} alone`
  return `${than}, the best no-fee card with one rate for everything ${flatRate(f)}.`
}

// Under the flat-rate card's bar, which shows its amount: why it's the one.
export function flatNote(r: ReportStart): string {
  const f = r.flat
  if (f === null || r.empty) return ''
  return `The best no-fee card with one rate for everything ${flatRate(f)}.`
}

// A spending line mid-sentence: "supermarkets", "other travel", "TV and
// internet service", but "Amazon" as it is.
export const lineName = (catalog: Catalog, label: string) =>
  catalog.categories.some((c) => c.name === label) || /^Other /.test(label)
    ? midSentence(label)
    : label

// Which card of a pair takes which lines: "the Amex Blue Cash Preferred for
// supermarkets and gas stations and the Citi Double Cash for the rest".
function pairSplit(catalog: Catalog, pair: Simulation): string {
  const byCard = new Map<string, string[]>()
  for (const line of pair.lines) {
    const first = line.cards[0]
    if (first !== undefined)
      byCard.set(first, [...(byCard.get(first) ?? []), line.label])
  }
  const other = catalog.categories.find((c) => c.id === 'other')?.name
  const parts = [...byCard]
    .map(([id, labels]) => ({
      id,
      rest: other !== undefined && labels.includes(other),
      covers: listed(labels.map((l) => lineName(catalog, l))),
    }))
    .sort((a, b) => Number(a.rest) - Number(b.rest))
  if (parts.length < 2)
    return listed(pair.cards.map((c) => `the ${nameOf(catalog, c.cardId)}`))
  return inOrder(
    parts.map(
      (p) =>
        `the ${nameOf(catalog, p.id)} for ${p.rest ? 'the rest' : p.covers}`,
    ),
  )
}

// Against the best two cards for the spending, or the best one when no pair
// beats it.
export function bestText(
  catalog: Catalog,
  r: ReportStart,
  best: BestCards,
): string {
  const top = pairBeats(best) ? best.pair : best.single
  if (top === null) return ''
  const ids = top.cards.map((c) => c.cardId)
  const held = r.cards.map((c) => c.cardId)
  if (held.length === ids.length && ids.every((id) => held.includes(id)))
    return ids.length === 2
      ? 'These are the best two cards earnrate finds for this spending.'
      : 'No pair of cards nets more on this spending than this one alone.'
  const lead =
    ids.length === 2
      ? `The best two cards for this spending, ${pairSplit(catalog, top)}, would net about ${wholeDollars(top.net)} a year`
      : `No pair of cards nets more on this spending than the ${nameOf(catalog, ids[0] ?? '')} alone, at about ${wholeDollars(top.net)} a year`
  if (r.empty) return `${lead}.`
  const diff = r.net - top.net
  return whole(diff) === 0
    ? `${lead}, about the same as yours.`
    : diff > 0
      ? `${lead}; your cards earn about ${wholeDollars(diff)} more.`
      : `${lead}, about ${wholeDollars(-diff)} more than yours.`
}

// Under the best cards' bar, which shows their amount: which card takes
// which spending.
export function bestNote(
  catalog: Catalog,
  r: ReportStart,
  best: BestCards,
): string {
  const top = pairBeats(best) ? best.pair : best.single
  if (top === null) return ''
  const ids = top.cards.map((c) => c.cardId)
  const held = r.cards.map((c) => c.cardId)
  if (held.length === ids.length && ids.every((id) => held.includes(id)))
    return ids.length === 2
      ? 'These are the best two cards earnrate finds for this spending.'
      : 'No pair of cards nets more on this spending than this one alone.'
  return ids.length === 2
    ? `${capitalize(pairSplit(catalog, top))}.`
    : 'No pair of cards nets more on this spending.'
}

// "Doesn't pay for itself" is about rewards and the credits marked as used,
// on this spending, so a card whose other credits would cover the rest
// says so first.
export function feeCardLead(
  catalog: Catalog,
  v: FeeVerdict,
  voice: Voice = 'you',
): string {
  const name = nameOf(catalog, v.cardId)
  if (v.paysForItself) return ''
  const on =
    v.counted > 0
      ? `On rewards and the credits ${voice === 'you' ? 'you use' : 'used'} (${wholeDollars(v.counted)} a year)`
      : 'On rewards alone'
  const other = v.counted > 0 ? 'other ' : ''
  if (v.perks === '')
    return v.counted > 0
      ? `${on}, the ${name} doesn't pay for itself on this spending.`
      : `The ${name} doesn't pay for itself on this spending.`
  return v.creditsCover
    ? `${on}, the ${name} doesn't pay for itself on this spending; its ${other}${v.perks} would cover the rest ${voice === 'you' ? `if you'd use ${/s$/.test(v.perks) ? 'them' : 'it'}` : 'if used'}.`
    : `${on}, the ${name} doesn't pay for itself on this spending, and its ${other}${v.perks} wouldn't cover the rest.`
}

export function feeCardText(catalog: Catalog, v: FeeVerdict): string {
  return [feeCardLead(catalog, v), v.verdict, v.credits]
    .filter((t) => t !== '')
    .join(' ')
}

// The one label beside each fee card on /rate.
export const FEE_BADGES = {
  pays: 'Pays for itself',
  credits: 'Only with credits',
  not: "Doesn't pay for itself",
} as const

export const feeCardBadge = (v: FeeVerdict): string =>
  v.paysForItself
    ? FEE_BADGES.pays
    : v.creditsCover
      ? FEE_BADGES.credits
      : FEE_BADGES.not

// "Dunkin'", "Uber, Grubhub and Resy", or past three a count: "all 11
// credits".
function fewCredits(c: CreditsYear, all: boolean): string {
  if (c.names.length <= 3) return listed(c.names)
  const nights = c.nightIds.length
  const noun =
    nights === 0
      ? 'credits'
      : nights === c.names.length
        ? 'free nights'
        : 'credits and free nights'
  return `${all ? 'all ' : ''}${String(c.names.length)} ${noun}`
}

// A fee card's answer on /rate in a sentence or two, from the same figures
// as `feeCardText`: "Adds about $114 a year beyond your other cards,
// counting Dunkin', less than its $325 fee."
export function feeCardShort(
  catalog: Catalog,
  v: FeeVerdict,
  voice: Voice = 'you',
): string {
  const fee = `its ${money(v.fee)} fee`
  const verb = v.alone ? 'Earns' : 'Adds'
  const beyond = v.alone
    ? v.against === null
      ? ''
      : ` more than the ${v.against}`
    : voice === 'you'
      ? ' beyond your other cards'
      : ' beyond the other cards'
  const counting =
    v.used.length === 0
      ? ''
      : `, counting ${v.used.length <= 3 ? listed(v.used) : `${String(v.used.length)} credits`}`
  const gross = v.net + v.fee
  const lead =
    whole(v.net) > 0
      ? `${verb} about ${wholeDollars(v.net)} a year${beyond} after ${fee}${counting}.`
      : whole(gross) <= 0
        ? v.alone
          ? `${verb} no more${v.against === null ? '' : ` than the ${v.against}`}, and has ${v.fee > 0 ? `a ${money(v.fee)} fee` : 'no fee'}.`
          : `${verb} nothing${beyond}, against ${fee}.`
        : `${verb} about ${wholeDollars(gross)} a year${beyond}${counting}, ${whole(v.net) === 0 ? `about what ${fee} costs` : `less than ${fee}`}.`
  return [lead, insteadShort(catalog, v)].filter((s) => s !== '').join(' ')
}

// The cheaper card that would keep the most of it, or that none comes close.
export function insteadShort(catalog: Catalog, v: FeeVerdict): string {
  if (v.outcome === 'not-needed') return ''
  const i = v.instead
  if (i === null) return 'No card with a lower fee comes close.'
  const name = nameOf(catalog, i.cardId)
  const net = wholeDollars(i.net)
  const withFee =
    i.annualFee === 0 ? 'with no fee' : `with a ${money(i.annualFee)} fee`
  if (v.alone)
    return `In its place, the ${name} would net about ${net} a year, ${withFee}.`
  if (v.outcome === 'keeps')
    return `The ${name} would keep about ${net} of that, ${withFee}.`
  return whole(i.net) === whole(v.net)
    ? `The ${name} would add about as much in its place, ${withFee}.`
    : `The ${name} would add more in its place: about ${net} a year, ${withFee}.`
}

// Keep or swap, in a sentence under a fee card's figures on /rate, from its
// share of the figure and keep-or-replace's numbers. With other cards:
// "Without it, your other cards would earn $210 of that, so it adds $160
// after its fee." Alone: "The Citi Double Cash, with no fee, would net $478
// on the same spending." A cheaper card that would add as much is named.
export function feeCardKeepShort(
  catalog: Catalog,
  share: CardShare,
  v: FeeVerdict,
  voice: Voice = 'you',
): string {
  if (v.alone) {
    const i = v.instead
    if (i === null) return 'No card with a lower fee comes close.'
    const withFee =
      i.annualFee === 0 ? 'with no fee' : `with a ${money(i.annualFee)} fee`
    return `The ${nameOf(catalog, i.cardId)}, ${withFee}, would net ${wholeDollars(i.net)} on the same spending.`
  }
  const adds = whole(v.net)
  const kept = share.earned - share.fee - adds
  const others = voice === 'you' ? 'your other cards' : 'the other cards'
  const lead =
    kept > 0
      ? `Without it, ${others} would earn ${wholeDollars(kept)} of that`
      : `Without it, ${others} would earn none of that`
  const so =
    adds > 0
      ? `so it adds ${wholeDollars(adds)} after its fee`
      : adds === 0
        ? 'so it adds about what its fee costs'
        : `so it falls ${wholeDollars(-adds)} short of its fee`
  return [
    `${lead}, ${so}.`,
    v.outcome === 'ahead' ? insteadShort(catalog, v) : '',
  ]
    .filter((t) => t !== '')
    .join(' ')
}

// A card's credits and free nights not answered yet, under its figures:
// "With Uber, Grubhub and Resy used, it would net $410." Empty with none.
export function shareCreditsShort(
  share: CardShare,
  unsaid: CreditsYear | undefined,
): string {
  if (share.upTo === null || !unsaid || unsaid.yearly <= 0) return ''
  const upTo = unsaid.nights > 0 ? 'up to ' : ''
  return `With ${fewCredits(unsaid, true)} used, it would net ${upTo}${wholeDollars(share.upTo)}.`
}

// Its credits not marked either way, as one short line: what the card
// would add with them all used. Empty when there are none.
export function feeCardCreditsShort(
  v: FeeVerdict,
  voice: Voice = 'you',
): string {
  const u = v.unsaid
  if (u.yearly > 0) {
    const what = fewCredits(u, true)
    const withAll = roundCents(v.net + u.yearly)
    const upTo = u.nights > 0 ? 'up to ' : ''
    const than = v.against === null ? '' : ` than the ${v.against}`
    if (whole(withAll) <= 0)
      return v.alone
        ? `Even with ${what} used, it wouldn't earn more${than} after its fee.`
        : `Even with ${what} used, it wouldn't cover its fee.`
    return v.alone
      ? `With ${what} used, it would earn ${upTo}about ${wholeDollars(withAll)} a year more${than} after its fee.`
      : `With ${what} used, it would add ${upTo}about ${wholeDollars(withAll)} a year after its fee.`
  }
  if (v.unvaluedNight)
    return voice === 'you'
      ? `Its ${FREE_NIGHT_NAME} counts once you say what it's worth to you.`
      : `Its ${FREE_NIGHT_NAME} isn't counted: no value was set for it.`
  return ''
}

// Right under the headline: the credits the figure leaves out, and what the
// cards would net with every one used.
export function creditsText(catalog: Catalog, r: ReportStart): string {
  if (r.empty || r.credits.length === 0) return ''
  const total = perksTotal(r.credits)
  const upTo = (total.nights ?? 0) > 0 ? 'up to ' : ''
  const one = total.names.length === 1
  const on = listed(r.credits.map((c) => `the ${nameOf(catalog, c.cardId)}`))
  const subject = r.cards.length === 1 ? 'it' : 'these cards'
  const yearly = `${upTo}${wholeDollars(total.yearly)} a year`
  const withAll = `${upTo}about ${wholeDollars(r.net + total.yearly)} a year`
  const sentence =
    r.counted.length === 0
      ? `This figure leaves out the ${perksNoun(total, true, true)} on ${on}. If you'd use ${one ? 'it' : 'every one'} (${yearly}), ${subject} would net ${withAll}.`
      : `This figure counts the credits marked as used. The other ${perksNoun(total, true, true)} on ${on} (${yearly}) would make it ${withAll} if you'd use ${one ? 'it' : 'every one'}.`
  return `${sentence} ${creditsOnlyIf(total)}`.trim()
}

export function nextText(catalog: Catalog, next: Addition | null): string {
  if (next === null)
    return 'No other card would add more than its annual fee on this spending.'
  const fee =
    next.annualFee > 0
      ? `after its ${money(next.annualFee)} fee`
      : 'with no annual fee'
  return `The card that would add the most is the ${nameOf(catalog, next.cardId)}: about ${wholeDollars(next.gain)} a year more, ${fee}.`
}

const pctText = (n: number) => pct(Math.round(n * 10) / 10)

export function gapText(
  catalog: Catalog,
  g: Gap,
  voice: Voice = 'you',
): string {
  const fee = g.fee > 0 ? ` (its annual fee is ${money(g.fee)})` : ''
  return `On ${lineName(catalog, g.label)}, ${voice === 'you' ? 'your' : 'these'} cards earn ${pctText(g.heldPct)}; the ${nameOf(catalog, g.bestCardId)} earns ${pctText(g.bestPct)}${fee}, about ${wholeDollars(g.dollars)} a year more on ${wholeDollars(g.spend)}.`
}

// "Assumes the best picks for this spending: Citi Custom Cash, restaurants."
export function assumedPicksText(catalog: Catalog, r: ReportStart): string {
  const parts = r.cards.flatMap((c) => {
    const card = catalog.cards.find((x) => x.id === c.cardId)
    if (!c.assumed || !card) return []
    const chosen = Object.entries(c.picks).flatMap(([choice, ids]) =>
      ids.map((o) => optionName(catalog, card, choice, o)),
    )
    return chosen.length === 0
      ? []
      : [`${shortCardName(card.name)}, ${listed(chosen)}`]
  })
  return parts.length === 0
    ? ''
    : `Assumes the best picks for this spending: ${parts.join('; ')}.`
}

export const CREDITS_NOT_COUNTED =
  "Statement credits and free nights count only where they're marked as used, at face value and a free night at its point cap; the best two cards and the flat-rate card count none. Each fee card says what its other credits would add."

export const REPORT_PERKS = `Annual fees are counted; ${OTHER_PERKS}.`

// What the figures rest on.
export function reportNotes(
  catalog: Catalog,
  r: ReportStart,
  dataVersion: string,
  voice: Voice = 'you',
): string[] {
  return [
    voice === 'you'
      ? r.typical
        ? TYPICAL_SPEND_NOTE
        : 'Uses the monthly amounts you entered.'
      : r.typical
        ? 'The report has no spending of its own, so this uses rough typical monthly amounts for a U.S. household.'
        : "Uses the report's own monthly amounts.",
    assumedPicksText(catalog, r),
    ...r.simulation.notes,
    CREDITS_NOT_COUNTED,
    REPORT_PERKS,
    `Card data ${dataVersion}, from each issuer's own terms.`,
  ].filter((s) => s !== '')
}

// The whole report as plain text.
export function walletReportText(catalog: Catalog, r: WalletReport): string {
  return [
    headlineText(catalog, r),
    creditsText(catalog, r),
    flatText(catalog, r),
    bestText(catalog, r, r.best),
    ...r.feeCards.map((v) => feeCardText(catalog, v)),
    nextText(catalog, r.next),
    ...r.gaps.map((g) => gapText(catalog, g)),
    ...reportNotes(catalog, r, r.dataVersion),
  ]
    .filter((s) => s !== '')
    .join(' ')
}
