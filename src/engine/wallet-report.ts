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
import { HALF_CENT, isClose } from './compare.ts'
import {
  ALL_PERSONAL_CARDS,
  idealHolding,
  matchesFilters,
  type CardFilters,
  type Picks,
} from './explore.ts'
import {
  keepOrReplace,
  keepOrReplaceVerdict,
  OTHER_PERKS,
  type KeepOrReplaceOutcome,
} from './keep-or-replace.ts'
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
  ifCreditsUsedText,
  inOrder,
  listed,
  money,
  pct,
  possessive,
  roundCents,
  shortCardName,
  wholeDollars,
} from './text.ts'

export type ReportInput = {
  cards: { id: string; picks: Picks }[]
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
  paysForItself: boolean
  outcome: KeepOrReplaceOutcome
  verdict: string // keep-or-replace's answer
  credits: string // what its statement credits would add, or empty
}

export type Gap = {
  label: string
  spend: number // a year
  heldPct: number
  heldCardId: string | null
  bestCardId: string
  bestPct: number
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
}

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
): ReportStart {
  const { wallet, cards } = reportWallet(catalog, input, today, spending)
  const ids = wallet.cards.map((c) => c.id)
  const simulation = simulateWallet(
    catalog,
    projectedWallet(wallet, catalog, today),
    spending.lines,
    today,
    ids,
  )
  const lines = countedLines(catalog, spending.lines)
  return {
    cards,
    empty: ids.length === 0,
    business: options(catalog, input, today).filters.business,
    typical: spending.typical,
    monthly: lines.reduce((sum, l) => sum + l.monthly, 0),
    lines,
    simulation,
    net: roundCents(
      simulation.rewards - simulation.annualFees - simulation.membershipFees,
    ),
    flat: flatComparison(catalog, input, today, spending),
  }
}

export function reportBest(
  catalog: Catalog,
  input: ReportInput,
  today: string,
  spending: Spending,
): BestCards {
  const { pairs, singles } = simulateCatalog(
    catalog,
    spending.lines,
    options(catalog, input, today),
  )
  return { pair: pairs[0] ?? null, single: singles[0] ?? null }
}

// A pair beats one card when it nets at least half a dollar more, as Find a
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
): FeeVerdict[] {
  const { wallet } = reportWallet(catalog, input, today, spending)
  return wallet.cards.flatMap((held) => {
    if (only !== undefined && held.id !== only) return []
    const k = keepOrReplace(catalog, wallet, held.id, today, spending)
    if (!k) return []
    const unsaid = k.unsaid
    const credits =
      unsaid.yearly > 0
        ? `${ifCreditsUsedText(unsaid, roundCents(k.added + unsaid.yearly), 'adds', possessive(`the ${k.name}`))} ${creditsOnlyIf(unsaid)}`.trim()
        : ''
    return [
      {
        cardId: held.id,
        fee: k.fee,
        net: k.renewal.net,
        paysForItself: whole(k.renewal.net) > 0,
        outcome: k.outcome,
        verdict: keepOrReplaceVerdict(catalog, k),
        credits,
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
  return countedLines(catalog, spending.lines)
    .flatMap((line): Gap[] => {
      const held = simulation.lines.find((l) => l.label === line.label)
      const [best] = simulateSingles(catalog, eligible, [line], opts)
      const bestCardId = best?.cards[0]?.cardId
      const bestLine = best?.lines[0]
      if (!held || !bestLine || bestCardId === undefined) return []
      if (
        ids.includes(bestCardId) ||
        isClose(held.returnPct, bestLine.returnPct)
      )
        return []
      return [
        {
          label: line.label,
          spend: held.spend,
          heldPct: held.returnPct,
          heldCardId: held.cards[0] ?? null,
          bestCardId,
          bestPct: bestLine.returnPct,
          dollars: roundCents(
            ((bestLine.returnPct - held.returnPct) / 100) * held.spend,
          ),
        },
      ]
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
  return {
    ...start,
    best: reportBest(catalog, input, today, spending),
    feeCards: reportFeeCards(catalog, input, today, spending),
    next: reportNext(catalog, input, today, spending),
    gaps: reportGaps(catalog, input, today, spending, start.simulation),
    dataVersion,
  }
}

// "on your spending of $1,750 a month", "on typical U.S. spending of about
// $1,990 a month"
export const spendingBasis = (r: Pick<ReportStart, 'typical' | 'monthly'>) =>
  r.typical
    ? `on typical U.S. spending of about ${wholeDollars(r.monthly)} a month`
    : `on your spending of ${wholeDollars(r.monthly)} a month`

// The headline figure in a sentence, with what makes it up.
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
  const made =
    fees > 0
      ? `: ${wholeDollars(r.simulation.rewards)} in rewards, less ${one ? `its ${money(fees)} annual fee` : `${money(fees)} in annual fees`}`
      : ` in rewards, with no annual fee${one ? '' : 's'}`
  return `${subject} about ${wholeDollars(r.net)} a year${made}, ${spendingBasis(r)}.`
}

// Against the best no-fee card with one rate for everything, held alone.
export function flatText(catalog: Catalog, r: ReportStart): string {
  const f = r.flat
  if (f === null || r.empty) return ''
  const rate = pct(Math.round(f.returnPct * 100) / 100)
  const others =
    f.ties.length === 0
      ? ''
      : `; ${f.ties.length === 1 ? 'one other earns' : `${String(f.ties.length)} others earn`} the same`
  const held = r.cards.map((c) => c.cardId)
  if (held.length === 1 && [f.cardId, ...f.ties].includes(held[0] ?? ''))
    return `It's the best no-fee card with one rate for everything (${rate}${others}).`
  const name = nameOf(catalog, f.cardId)
  const diff = r.net - f.net
  const than =
    whole(diff) === 0
      ? `That's about what the ${name} alone would earn`
      : `That's about ${wholeDollars(Math.abs(diff))} a year ${diff > 0 ? 'more' : 'less'} than the ${name} alone`
  return `${than}, the best no-fee card with one rate for everything (${rate}${others}).`
}

// A spending line mid-sentence: "supermarkets", "other travel", "streaming
// services", but "Amazon" as it is.
export const lineName = (catalog: Catalog, label: string) =>
  catalog.categories.some((c) => c.name === label) || /^Other /.test(label)
    ? label.toLowerCase()
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

export function feeCardText(catalog: Catalog, v: FeeVerdict): string {
  const lead = v.paysForItself
    ? ''
    : `The ${nameOf(catalog, v.cardId)} doesn't pay for itself on this spending. `
  return `${lead}${v.verdict}${v.credits === '' ? '' : ` ${v.credits}`}`
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

export function gapText(catalog: Catalog, r: ReportStart, g: Gap): string {
  return `On ${lineName(catalog, g.label)}, your cards earn ${pctText(g.heldPct)}; the ${nameOf(catalog, g.bestCardId)} earns ${pctText(g.bestPct)}, about ${wholeDollars(g.dollars)} a year more on ${wholeDollars(g.spend)}.`
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
  "Statement credits and free nights aren't counted, since the report doesn't know which ones you use; each fee card says what its credits would add."

export const REPORT_PERKS = `Annual fees are counted; ${OTHER_PERKS}.`

// What the figures rest on.
export function reportNotes(
  catalog: Catalog,
  r: ReportStart,
  dataVersion: string,
): string[] {
  return [
    r.typical ? TYPICAL_SPEND_NOTE : 'Uses the monthly amounts you entered.',
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
    flatText(catalog, r),
    bestText(catalog, r, r.best),
    ...r.feeCards.map((v) => feeCardText(catalog, v)),
    nextText(catalog, r.next),
    ...r.gaps.map((g) => gapText(catalog, r, g)),
    ...reportNotes(catalog, r, r.dataVersion),
  ]
    .filter((s) => s !== '')
    .join(' ')
}
