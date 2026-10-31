import type { Catalog } from '../schema/catalog.ts'
import { resolveMerchant } from '../merchants/resolve.ts'
import type { Card } from '../schema/card.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { evaluateCard, purchaseContext } from './evaluate.ts'
import {
  categoryResolution,
  choicePeriod,
  findCategory,
  idealHolding,
  matchesFilters,
  type CardFilters,
  type Picks,
} from './explore.ts'
import { periodKey } from './periods.ts'
import { applyBooking, capBooking } from './record.ts'
import { rotationGap } from './rotation.ts'
import type { MerchantResolution } from './types.ts'
import { cardValuation } from './valuation.ts'

const EPSILON = 1e-9
const MONTHS = 12
const SHORTLIST = 8 // best single cards considered for pairs
const PER_LINE = 2 // plus the best cards for each spending line

export type SpendLine = {
  merchant: string | null
  category: string | null // used when merchant is null
  monthly: number // dollars
}

export type ResolvedLine = {
  label: string
  monthly: number
  merchant: MerchantResolution
}

export type LineResult = {
  label: string
  spend: number // dollars a year
  earned: number // dollars a year
  returnPct: number
  cards: string[] // card ids that took this spend, most first
}

export type Simulation = {
  cards: { cardId: string; picks: Picks }[]
  spend: number // dollars a year
  rewards: number // dollars a year, at the point values given
  annualFees: number
  net: number // rewards minus annual fees
  lines: LineResult[]
  notes: string[]
}

export type SimulateOptions = {
  filters: CardFilters
  memberships: string[]
  valuations: Wallet['valuations']
  start: string // YYYY-MM-DD; the year simulated starts in this month
}

const round = (n: number) => Math.round(n * 100) / 100

export function resolveSpendLines(
  catalog: Catalog,
  lines: SpendLine[],
): ResolvedLine[] {
  return lines
    .filter((l) => l.monthly > 0)
    .map((l) => {
      const merchant =
        l.merchant !== null
          ? resolveMerchant(catalog, l.merchant, null)
          : categoryResolution(catalog, l.category ?? 'other', null)
      return { label: merchant.resolvedName, monthly: l.monthly, merchant }
    })
}

function monthDates(start: string): string[] {
  const year = Number(start.slice(0, 4))
  const month = Number(start.slice(5, 7)) - 1
  return Array.from({ length: MONTHS }, (_, i) => {
    const y = year + Math.floor((month + i) / 12)
    const m = ((month + i) % 12) + 1
    return `${String(y)}-${String(m).padStart(2, '0')}-15`
  })
}

// Picks carry over from period to period, so a quarter's picks hold all year.
function withCurrentPicks(
  card: Card,
  held: WalletCard,
  date: string,
): WalletCard {
  if (!held.chosen) return held
  return {
    ...held,
    chosen: {
      ...held.chosen,
      period: periodKey(choicePeriod(card), date, null) ?? '',
    },
  }
}

function usableAt(card: Card, merchant: MerchantResolution): boolean {
  if (card.only_at)
    return (
      merchant.merchantId !== null && card.only_at.includes(merchant.merchantId)
    )
  return (
    card.network === 'store' ||
    merchant.accepts === null ||
    merchant.accepts.includes(card.network)
  )
}

// Spends `lines` every month for a year. Each dollar goes to the card that
// earns the most on it right then, so spend moves to another card once a
// cap runs out.
export function simulateWallet(
  catalog: Catalog,
  wallet: Wallet,
  lines: ResolvedLine[],
  start: string,
): Simulation {
  const cards = wallet.cards.map((held) => {
    const card = catalog.cards.find((c) => c.id === held.id)
    if (!card) throw new Error(`${held.id} isn't in the card catalog`)
    return { card, cents: cardValuation(catalog, wallet, card).centsPerUnit }
  })
  let state = wallet
  const results = lines.map(() => ({
    spend: 0,
    earned: 0,
    byCard: new Map<string, number>(),
  }))

  for (const date of monthDates(start)) {
    lines.forEach((line, i) => {
      const result = results[i]
      if (!result) return
      let left = line.monthly
      result.spend += left
      for (let guard = 0; left > EPSILON && guard < 20; guard++) {
        let pick: {
          card: Card
          perDollar: number
          room: number
        } | null = null
        for (const { card, cents } of cards) {
          if (!usableAt(card, line.merchant)) continue
          const raw = state.cards.find((h) => h.id === card.id)
          if (!raw) continue
          const held = withCurrentPicks(card, raw, date)
          const ctx = purchaseContext(
            catalog,
            state,
            line.merchant,
            line.merchant.category,
            { amount: null, date, country: 'US' },
          )
          const { best } = evaluateCard(card, held, ctx)
          const perDollar = (best.rate * cents) / 100
          const room =
            best.cap && best.cap.remaining > 0 ? best.cap.remaining : Infinity
          if (!pick || perDollar > pick.perDollar + EPSILON)
            pick = { card, perDollar, room }
        }
        if (!pick) break
        const chosen = pick
        const amount = Math.min(left, chosen.room)
        result.earned += amount * chosen.perDollar
        result.byCard.set(
          chosen.card.id,
          (result.byCard.get(chosen.card.id) ?? 0) + amount,
        )
        const booking = capBooking(
          catalog,
          {
            ...state,
            cards: state.cards.map((h) =>
              h.id === chosen.card.id
                ? withCurrentPicks(chosen.card, h, date)
                : h,
            ),
          },
          {
            cardId: chosen.card.id,
            merchant: line.label,
            amount,
            date,
            channel: line.merchant.channel,
          },
          line.merchant,
        )
        if (booking) state = applyBooking(state, booking)
        left -= amount
      }
    })
  }

  const lineResults: LineResult[] = lines.map((line, i) => {
    const r = results[i] ?? {
      spend: 0,
      earned: 0,
      byCard: new Map<string, number>(),
    }
    return {
      label: line.label,
      spend: round(r.spend),
      earned: round(r.earned),
      returnPct: r.spend > 0 ? (r.earned / r.spend) * 100 : 0,
      cards: [...r.byCard].sort((a, b) => b[1] - a[1]).map(([id]) => id),
    }
  })
  const rewards = round(lineResults.reduce((sum, l) => sum + l.earned, 0))
  const annualFees = cards.reduce((sum, c) => sum + (c.card.annual_fee ?? 0), 0)
  const notes: string[] = []
  const dates = monthDates(start)
  for (const { card } of cards) {
    const gaps = [
      ...new Set(
        dates.map((d) => rotationGap(card, d)).filter((g) => g !== null),
      ),
    ]
    if (gaps.length > 0)
      notes.push(
        `${card.name}'s rotating categories for ${gaps.join(', ')} aren't in earnrate's data yet, so those quarters count at its everyday rates.`,
      )
    if (card.annual_fee === undefined)
      notes.push(
        `${card.name}'s annual fee isn't on file, so none is subtracted.`,
      )
    else if (
      card.first_year_fee !== undefined &&
      card.first_year_fee !== card.annual_fee
    )
      notes.push(
        `${card.name}'s fee is $${String(card.first_year_fee)} the first year; the yearly figure uses the $${String(card.annual_fee)} that follows.`,
      )
  }
  return {
    cards: wallet.cards.map((h) => ({
      cardId: h.id,
      picks: h.chosen?.picks ?? {},
    })),
    spend: round(lineResults.reduce((sum, l) => sum + l.spend, 0)),
    rewards,
    annualFees,
    net: round(rewards - annualFees),
    lines: lineResults,
    notes,
  }
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]]
  if (items.length < size) return [items]
  const [first, ...rest] = items
  if (first === undefined) return [[]]
  return [
    ...combinations(rest, size - 1).map((c) => [first, ...c]),
    ...combinations(rest, size),
  ]
}

// Pick sets worth trying: only options that raise the card's rate on one of
// the lines, combined up to the number of picks the card allows.
function candidatePicks(
  catalog: Catalog,
  card: Card,
  lines: ResolvedLine[],
  memberships: string[],
  date: string,
): Picks[] {
  let sets: Picks[] = [{}]
  for (const choice of card.choices) {
    const useful = Object.keys(choice.options).filter((option) => {
      const plain = idealHolding(card, date)
      const picked = idealHolding(card, date, { [choice.id]: [option] })
      return lines.some((line) => {
        const ctx = purchaseContext(
          catalog,
          { valuations: {}, memberships, cards: [picked] },
          line.merchant,
          line.merchant.category,
          { amount: null, date, country: 'US' },
        )
        return (
          evaluateCard(card, picked, ctx).best.rate >
          evaluateCard(card, plain, ctx).best.rate + EPSILON
        )
      })
    })
    if (useful.length === 0) continue
    const combos = combinations(useful, Math.min(choice.pick, useful.length))
    sets = sets.flatMap((s) => combos.map((c) => ({ ...s, [choice.id]: c })))
  }
  return sets
}

function walletWith(
  base: WalletCard[],
  card: Card,
  picks: Picks,
  options: Pick<SimulateOptions, 'memberships' | 'valuations' | 'start'>,
): Wallet {
  return {
    valuations: options.valuations,
    memberships: options.memberships,
    cards: [...base, idealHolding(card, options.start, picks)],
  }
}

// The best picks for `card` alongside the cards already in `base`.
function bestSimulation(
  catalog: Catalog,
  base: WalletCard[],
  card: Card,
  lines: ResolvedLine[],
  options: SimulateOptions,
): Simulation {
  let best: Simulation | null = null
  for (const picks of candidatePicks(
    catalog,
    card,
    lines,
    options.memberships,
    options.start,
  )) {
    const sim = simulateWallet(
      catalog,
      walletWith(base, card, picks, options),
      lines,
      options.start,
    )
    if (!best || sim.net > best.net + EPSILON) best = sim
  }
  if (!best) throw new Error(`no simulation for ${card.id}`)
  return best
}

const byNet = (a: Simulation, b: Simulation) =>
  b.net - a.net || a.annualFees - b.annualFees

export type PairSimulation = Simulation & {
  // Cards that could replace the second card for the same result.
  alternatives: string[]
}

export type CatalogSimulation = {
  singles: Simulation[] // one card each, best net first
  pairs: PairSimulation[] // the best two-card wallets, best net first
}

// Pairs that tie and share their first card differ only in an
// interchangeable second card (several flat 2% cards), so they fold into one.
function foldTies(pairs: Simulation[]): PairSimulation[] {
  const folded: PairSimulation[] = []
  for (const pair of pairs) {
    const [a, b] = pair.cards
    const twin = folded.find(
      (f) =>
        Math.abs(f.net - pair.net) < 0.005 &&
        f.annualFees === pair.annualFees &&
        f.cards.some((c) => c.cardId === a?.cardId || c.cardId === b?.cardId),
    )
    if (!twin) {
      folded.push({ ...pair, alternatives: [] })
      continue
    }
    const shared = new Set(twin.cards.map((c) => c.cardId))
    const other = [a, b].find((c) => c && !shared.has(c.cardId))
    if (other) twin.alternatives.push(other.cardId)
  }
  return folded
}

export function simulateCatalog(
  catalog: Catalog,
  lines: ResolvedLine[],
  options: SimulateOptions,
): CatalogSimulation {
  const eligible = catalog.cards.filter((c) =>
    matchesFilters(c, options.filters),
  )
  const singles = eligible
    .map((card) => bestSimulation(catalog, [], card, lines, options))
    .sort(byNet)

  const shortlist = new Set(
    singles.slice(0, SHORTLIST).map((s) => s.cards[0]?.cardId),
  )
  lines.forEach((line) => {
    const best = [...singles].sort(
      (a, b) =>
        (b.lines.find((l) => l.label === line.label)?.earned ?? 0) -
        (a.lines.find((l) => l.label === line.label)?.earned ?? 0),
    )
    for (const s of best.slice(0, PER_LINE)) shortlist.add(s.cards[0]?.cardId)
  })
  // A card whose points pool into a shortlisted card's is worth more beside it.
  for (const card of eligible) {
    if (card.pools_into?.when_wallet_has.some((id) => shortlist.has(id)))
      shortlist.add(card.id)
  }
  const finalists = eligible.filter((c) => shortlist.has(c.id))
  const singleFor = new Map(singles.map((s) => [s.cards[0]?.cardId, s]))

  const pairs: Simulation[] = []
  finalists.forEach((first, i) => {
    const firstPicks = singleFor.get(first.id)?.cards[0]?.picks ?? {}
    for (const second of finalists.slice(i + 1)) {
      const base = [idealHolding(first, options.start, firstPicks)]
      pairs.push(bestSimulation(catalog, base, second, lines, options))
    }
  })
  pairs.sort(byNet)
  return { singles, pairs: foldTies(pairs).slice(0, 10) }
}

export type Addition = {
  cardId: string
  picks: Picks
  extraRewards: number // dollars a year over the current wallet
  annualFee: number
  gain: number // extra rewards minus the annual fee
  simulation: Simulation
}

export type WalletWhatIf = {
  current: Simulation
  additions: Addition[] // best gain first
}

// The person's own wallet, set up as it would run all year: their picks carry
// over, rotating categories get activated, caps start fresh.
function projectedWallet(
  wallet: Wallet,
  catalog: Catalog,
  start: string,
): Wallet {
  return {
    ...wallet,
    cards: wallet.cards.map((held) => {
      const card = catalog.cards.find((c) => c.id === held.id)
      const ideal = card
        ? idealHolding(card, start, held.chosen?.picks ?? {})
        : held
      return {
        ...ideal,
        ...(held.checkout_label !== undefined
          ? { checkout_label: held.checkout_label }
          : {}),
        ...(held.anniversary !== undefined
          ? { anniversary: held.anniversary }
          : {}),
      }
    }),
  }
}

export function simulateAdditions(
  catalog: Catalog,
  wallet: Wallet,
  lines: ResolvedLine[],
  options: SimulateOptions,
): WalletWhatIf {
  const projected = projectedWallet(wallet, catalog, options.start)
  const current = simulateWallet(catalog, projected, lines, options.start)
  const held = new Set(wallet.cards.map((c) => c.id))
  const additions: Addition[] = []
  for (const card of catalog.cards) {
    if (held.has(card.id) || !matchesFilters(card, options.filters)) continue
    const simulation = bestSimulation(catalog, projected.cards, card, lines, {
      ...options,
      memberships: wallet.memberships,
      valuations: wallet.valuations,
    })
    const extraRewards = round(simulation.rewards - current.rewards)
    const annualFee = card.annual_fee ?? 0
    additions.push({
      cardId: card.id,
      picks: simulation.cards.at(-1)?.picks ?? {},
      extraRewards,
      annualFee,
      gain: round(extraRewards - annualFee),
      simulation,
    })
  }
  additions.sort((a, b) => b.gain - a.gain || a.annualFee - b.annualFee)
  return { current, additions }
}

// Rough monthly amounts for a U.S. household: the starting point when someone
// hasn't said what they spend. Answers built on them say so.
export const TYPICAL_MONTHLY_SPEND: { what: string; monthly: number }[] = [
  { what: 'Groceries', monthly: 500 },
  { what: 'Dining', monthly: 250 },
  { what: 'Gas', monthly: 150 },
  { what: 'Amazon', monthly: 100 },
  { what: 'Streaming', monthly: 40 },
  { what: 'Travel', monthly: 150 },
  { what: 'Everything else', monthly: 800 },
]

// A spending line from everyday words: a category when one matches
// ("groceries"), otherwise a merchant ("Amazon").
export function spendLineFor(
  catalog: Catalog,
  what: string,
  monthly: number,
): SpendLine {
  const category = findCategory(catalog, what)
  return { merchant: category === null ? what : null, category, monthly }
}

export function typicalSpendLines(catalog: Catalog): ResolvedLine[] {
  return resolveSpendLines(
    catalog,
    TYPICAL_MONTHLY_SPEND.map((t) => spendLineFor(catalog, t.what, t.monthly)),
  )
}

export const TYPICAL_SPEND_NOTE = `No spending was given, so this uses rough typical monthly amounts for a U.S. household: ${TYPICAL_MONTHLY_SPEND.map((t) => `${t.what} $${String(t.monthly)}`).join(', ')}. Give your own amounts for a closer answer.`
