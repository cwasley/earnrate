import {
  categoryResolution,
  findCategory,
  resolvePlace,
} from '../merchants/resolve.ts'
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { allCreditsYear, usedCreditsYear, type CreditsYear } from './credits.ts'
import { evaluateCard, purchaseContext, usableAt } from './evaluate.ts'
import {
  idealHolding,
  matchesFilters,
  type CardFilters,
  type Picks,
} from './explore.ts'
import {
  membershipCosts,
  missingMembership,
  paidMemberships,
  type MembershipCost,
} from './memberships.ts'
import { choicePeriod, periodKey } from './periods.ts'
import { applyBooking, capBooking } from './record.ts'
import { liveMilestones, milestoneStarts, milestoneWhat } from './milestones.ts'
import { heldRotationGap } from './rotation.ts'
import {
  categoryNote,
  categoryUnranked,
  creditsCountedText,
  leftOutText,
  money,
  namedStore,
  paymentNote,
  roundCents,
  shortCardName,
  wholeDollars,
  possessive,
} from './text.ts'
import type { MerchantResolution } from './types.ts'
import { cardValuation } from './valuation.ts'
import { EPSILON, HALF_CENT } from './compare.ts'

const MONTHS = 12
const SHORTLIST = 8 // best single cards considered for pairs
const PER_LINE = 2 // plus the best cards for each spending line

export type SpendLine = {
  merchant: string | null
  category: string | null // used when merchant is null
  monthly: number // dollars
  label?: string // in place of the category's name: "Other travel"
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
  // Memberships these cards need that the person doesn't already pay for,
  // counted like annual fees. Rankings never have any: a card that needs
  // one is simulated for a member. A card simulated on its own can.
  memberships: MembershipCost[]
  membershipFees: number
  // Statement credits a cardholder uses on cards they already hold, at
  // face value each period, and free nights they use at their "up to"
  // value: counted against the fees, so in `net`.
  heldCredits: number
  net: number // rewards plus heldCredits, minus annual fees and membership fees
  // Statement credits and free nights on the cards not held, a year. Left
  // out of `net`: they're worth it only to someone who'd spend there anyway.
  otherCredits: number
  netIfCreditsUsed: number // net plus otherCredits
  credits: SimulatedCredits[] // each card with credits
  lines: LineResult[]
  // Spend milestones the year's spending on a card reaches; their points
  // are in `rewards`.
  milestones: SimulatedMilestone[]
  notes: string[]
}

export type SimulatedCredits = CreditsYear & {
  held: boolean // counted in net: the person holds the card and uses these
}

export type SimulatedMilestone = {
  cardId: string
  milestoneId: string
  points: number | null
  value: number // dollars, at the point values given
}

export type SimulateOptions = {
  filters: CardFilters
  memberships: string[]
  valuations: Wallet['valuations']
  start: string // YYYY-MM-DD; the year simulated starts in this month
  held?: string[] // cards the person already has
}

export function resolveSpendLines(
  catalog: Catalog,
  lines: SpendLine[],
): ResolvedLine[] {
  return lines
    .filter((l) => l.monthly > 0)
    .map((l) => {
      const merchant =
        l.merchant !== null
          ? resolvePlace(catalog, l.merchant, null)
          : categoryResolution(catalog, l.category ?? 'other', null)
      return {
        label: l.label ?? merchant.resolvedName,
        monthly: l.monthly,
        merchant,
      }
    })
}

// Spending a card can be assumed to pay: an unranked category's (rent) is
// left out of the year, and its note says why.
export function countedLines(
  catalog: Catalog,
  lines: ResolvedLine[],
): ResolvedLine[] {
  return lines.filter((l) => !categoryUnranked(catalog, l.merchant.category))
}

// With only such spending there's no year to simulate: why, or null.
export function nothingCounted(
  catalog: Catalog,
  lines: ResolvedLine[],
): string | null {
  if (lines.length === 0 || countedLines(catalog, lines).length > 0) return null
  const why = lines.flatMap((l) => [
    leftOutText(l.label),
    categoryNote(catalog, l.merchant.category) ?? [],
  ])
  return [...new Set(why.flat()), 'Add other spending to compare cards.'].join(
    ' ',
  )
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
      period:
        periodKey(choicePeriod(card) ?? 'calendar_year', date, null) ?? '',
    },
  }
}

// Spends `lines` every month for a year. Each dollar goes to the card that
// earns the most on it right then, so spend moves to another card once a
// cap runs out.
export function simulateWallet(
  catalog: Catalog,
  wallet: Wallet,
  given: ResolvedLine[],
  start: string,
  // Cards the person already has: their first year is behind them and any
  // membership they need is paid for.
  held: string[] = [],
): Simulation {
  const lines = countedLines(catalog, given)
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

  // Each line's purchase, apart from its date. Bookings change only cap
  // usage, which the context doesn't read.
  const contexts = lines.map((line) =>
    purchaseContext(catalog, wallet, line.merchant, line.merchant.category, {
      amount: null,
      date: start,
      country: 'US',
    }),
  )
  for (const date of monthDates(start)) {
    lines.forEach((line, i) => {
      const result = results[i]
      const base = contexts[i]
      if (!result || !base) return
      let left = line.monthly
      result.spend += left
      const ctx = { ...base, date }
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
          { ...ctx, amount },
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
      spend: roundCents(r.spend),
      earned: roundCents(r.earned),
      returnPct: r.spend > 0 ? (r.earned / r.spend) * 100 : 0,
      cards: [...r.byCard].sort((a, b) => b[1] - a[1]).map(([id]) => id),
    }
  })
  // A year of these amounts is taken as every year's: a calendar-year or
  // cardmember-year total is the same twelve months' spending.
  const milestones: SimulatedMilestone[] = []
  const milestoneNotes: string[] = []
  const lastMonth = monthDates(start).at(-1) ?? start
  for (const { card, cents } of cards) {
    const spent = results.reduce(
      (sum, r) => sum + (r.byCard.get(card.id) ?? 0),
      0,
    )
    // One that starts during the year counts, as it will the year after.
    for (const m of liveMilestones(card, lastMonth)) {
      if (spent + EPSILON < m.spend) continue
      const value = roundCents(((m.points ?? 0) * cents) / 100)
      milestones.push({
        cardId: card.id,
        milestoneId: m.id,
        points: m.points ?? null,
        value,
      })
      milestoneNotes.push(
        `${shortCardName(card.name)}: ${wholeDollars(spent)} a year on it reaches ${milestoneWhat(m)}${milestoneStarts(m, start)}${m.points === undefined ? '' : ` (about ${money(value)}, counted in its rewards)`}, assuming the same spending each year.`,
      )
    }
  }
  // From the unrounded lines: adding lines rounded to the cent drifts a
  // flat 2% on $1,000 a month to $240.01.
  const rewards = roundCents(
    results.reduce((sum, r) => sum + r.earned, 0) +
      milestones.reduce((sum, m) => sum + m.value, 0),
  )
  const annualFees = cards.reduce((sum, c) => sum + (c.card.annual_fee ?? 0), 0)
  const credits: SimulatedCredits[] = cards.flatMap(({ card }) => {
    const holding = held.includes(card.id)
    const raw = wallet.cards.find((h) => h.id === card.id)
    const year =
      holding && raw
        ? usedCreditsYear(catalog, card, raw, start, wallet.valuations)
        : allCreditsYear(catalog, card, start, wallet.valuations)
    return year.creditIds.length === 0 ? [] : [{ ...year, held: holding }]
  })
  const creditSum = (heldOnes: boolean) =>
    roundCents(
      credits
        .filter((c) => c.held === heldOnes)
        .reduce((sum, c) => sum + c.yearly, 0),
    )
  const heldCredits = creditSum(true)
  const otherCredits = creditSum(false)
  const paid = paidMemberships(catalog, {
    memberships: wallet.memberships,
    heldCards: held,
    merchantIds: lines.map((l) => l.merchant.merchantId),
  })
  const memberships = membershipCosts(
    catalog,
    cards.map((c) => c.card),
    paid,
  )
  const membershipFees = memberships.reduce((sum, m) => sum + m.annualFee, 0)
  const notes: string[] = [
    ...new Set(
      given.flatMap((l) => {
        const note = categoryNote(catalog, l.merchant.category)
        if (note === null) return []
        return lines.includes(l) ? [note] : [leftOutText(l.label), note]
      }),
    ),
    ...milestoneNotes,
  ]
  for (const c of credits.filter((c) => c.held)) {
    const card = cards.find((x) => x.card.id === c.cardId)?.card
    if (card)
      notes.push(
        creditsCountedText(shortCardName(card.name), card.annual_fee ?? 0, c),
      )
  }
  const paying = paymentNote(
    cards.map(({ card }) => ({ name: shortCardName(card.name), card })),
  )
  if (paying !== null) notes.push(paying)
  const dates = monthDates(start)
  for (const { card } of cards) {
    const gaps = [
      ...new Set(
        dates
          .map((d) => heldRotationGap(card, d, held))
          .filter((g) => g !== null),
      ),
    ]
    if (gaps.length > 0)
      notes.push(
        `${possessive(shortCardName(card.name))} rotating categories for ${gaps.join(', ')} aren't in earnrate's data yet, so those quarters count at its everyday rates.`,
      )
    if (card.annual_fee === undefined)
      notes.push(
        `${possessive(shortCardName(card.name))} annual fee isn't on file, so none is subtracted.`,
      )
    else if (
      !held.includes(card.id) &&
      card.first_year_fee !== undefined &&
      card.first_year_fee !== card.annual_fee
    )
      notes.push(
        `${possessive(shortCardName(card.name))} fee is ${money(card.first_year_fee)} the first year; the yearly figure uses the ${money(card.annual_fee)} that follows.`,
      )
  }
  return {
    cards: wallet.cards.map((h) => ({
      cardId: h.id,
      picks: h.chosen?.picks ?? {},
    })),
    spend: roundCents(results.reduce((sum, r) => sum + r.spend, 0)),
    rewards,
    annualFees,
    memberships,
    membershipFees,
    heldCredits,
    net: roundCents(rewards + heldCredits - annualFees - membershipFees),
    otherCredits,
    netIfCreditsUsed: roundCents(
      rewards + heldCredits + otherCredits - annualFees - membershipFees,
    ),
    credits,
    lines: lineResults,
    milestones,
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
      options.held,
    )
    if (!best || sim.net > best.net + EPSILON) best = sim
  }
  if (!best) throw new Error(`no simulation for ${card.id}`)
  return best
}

const costs = (s: Simulation) => s.annualFees + s.membershipFees

export const byNet = (a: Simulation, b: Simulation) =>
  b.net - a.net || costs(a) - costs(b)

// Each card on its own with its best picks, best net first.
export function simulateSingles(
  catalog: Catalog,
  cards: Card[],
  lines: ResolvedLine[],
  options: SimulateOptions,
): Simulation[] {
  return cards
    .map((card) => bestSimulation(catalog, [], card, lines, options))
    .sort(byNet)
}

export type PairSimulation = Simulation & {
  // Cards that could replace the second card for the same result.
  alternatives: string[]
}

export type CatalogSimulation = {
  singles: Simulation[] // one card each, best net first
  pairs: PairSimulation[] // the best two-card wallets, best net first
  // Cards that need a membership the person hasn't given, each alone and
  // simulated for a member: out of singles and pairs.
  membersOnly: MembersOnly<Simulation>[]
}

export type MembersOnly<T> = T & { membership: string }

// What the person has: memberships given, the ones their cards need, and the
// ones their spending shows.
function membersOf(
  catalog: Catalog,
  memberships: string[],
  held: string[],
  lines: ResolvedLine[],
): Set<string> {
  return paidMemberships(catalog, {
    memberships,
    heldCards: held,
    merchantIds: lines.map((l) => l.merchant.merchantId),
  })
}

// Pairs that tie and share their first card differ only in an
// interchangeable second card (several flat 2% cards), so they fold into one.
function foldTies(pairs: Simulation[]): PairSimulation[] {
  const folded: PairSimulation[] = []
  for (const pair of pairs) {
    const [a, b] = pair.cards
    const twin = folded.find(
      (f) =>
        Math.abs(f.net - pair.net) < HALF_CENT &&
        costs(f) === costs(pair) &&
        f.cards.some((c) => c.cardId === a?.cardId || c.cardId === b?.cardId),
    )
    if (!twin) {
      folded.push({ ...pair, alternatives: [] })
      continue
    }
    const shared = new Set(twin.cards.map((c) => c.cardId))
    const other = [a, b].find((c) => c && !shared.has(c.cardId))
    if (other && !twin.alternatives.includes(other.cardId))
      twin.alternatives.push(other.cardId)
  }
  return folded
}

export function simulateCatalog(
  catalog: Catalog,
  lines: ResolvedLine[],
  options: SimulateOptions,
): CatalogSimulation {
  const has = membersOf(catalog, options.memberships, options.held ?? [], lines)
  const matching = catalog.cards.filter((c) =>
    matchesFilters(c, options.filters),
  )
  const eligible = matching.filter((c) => missingMembership(c, has) === null)
  const membersOnly = matching
    .flatMap((card) => {
      const membership = missingMembership(card, has)
      if (membership === null) return []
      const sim = bestSimulation(catalog, [], card, lines, {
        ...options,
        memberships: [...options.memberships, membership],
      })
      return [{ ...sim, membership }]
    })
    .sort(byNet)
  const singles = eligible
    .map((card) => bestSimulation(catalog, [], card, lines, options))
    .sort(byNet)

  const shortlist = new Set(
    singles.slice(0, SHORTLIST).map((s) => s.cards[0]?.cardId),
  )
  countedLines(catalog, lines).forEach((line) => {
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
  return { singles, pairs: foldTies(pairs).slice(0, 10), membersOnly }
}

export type Addition = {
  cardId: string
  picks: Picks
  extraRewards: number // dollars a year over the current wallet
  annualFee: number
  gain: number // extra rewards minus the annual fee
  credits: number // its statement credits, a year at face value; not in gain
  gainIfCreditsUsed: number // gain plus credits
  simulation: Simulation
}

export type WalletWhatIf = {
  current: Simulation
  additions: Addition[] // best gain first
  // Cards that need a membership the wallet doesn't have, each simulated
  // for a member: out of additions.
  membersOnly: MembersOnly<Addition>[]
}

export const gainOrder = (a: Addition, b: Addition) =>
  b.gain - a.gain || a.annualFee - b.annualFee

// The person's own wallet, set up as it would run all year: their picks carry
// over, rotating categories get activated, caps start fresh. A card earnrate
// no longer lists is left out, since it can't be simulated.
export function projectedWallet(
  wallet: Wallet,
  catalog: Catalog,
  start: string,
): Wallet {
  return {
    ...wallet,
    cards: wallet.cards.flatMap((held) => {
      const card = catalog.cards.find((c) => c.id === held.id)
      if (!card) return []
      const ideal = idealHolding(card, start, held.chosen?.picks ?? {})
      return {
        ...ideal,
        ...(held.checkout_label !== undefined
          ? { checkout_label: held.checkout_label }
          : {}),
        ...(held.anniversary !== undefined
          ? { anniversary: held.anniversary }
          : {}),
        ...(held.enrolled !== undefined ? { enrolled: held.enrolled } : {}),
        ...(held.skipped_credits !== undefined
          ? { skipped_credits: held.skipped_credits }
          : {}),
        ...(held.night_values !== undefined
          ? { night_values: held.night_values }
          : {}),
        // Usage confirms a credit that needs no enrolling is in use.
        ...(held.credit_usage !== undefined
          ? { credit_usage: held.credit_usage }
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
  // Only these cards are tried, beyond the filters.
  consider: (card: Card) => boolean = () => true,
): WalletWhatIf {
  const projected = projectedWallet(wallet, catalog, options.start)
  const heldIds = wallet.cards.map((c) => c.id)
  const current = simulateWallet(
    catalog,
    projected,
    lines,
    options.start,
    heldIds,
  )
  const held = new Set(heldIds)
  const has = membersOf(catalog, wallet.memberships, heldIds, lines)
  const additions: Addition[] = []
  const membersOnly: MembersOnly<Addition>[] = []
  for (const card of catalog.cards) {
    if (
      held.has(card.id) ||
      !matchesFilters(card, options.filters) ||
      !consider(card) ||
      (wallet.skipped_issuers ?? []).includes(card.issuer)
    )
      continue
    const membership = missingMembership(card, has)
    const simulation = bestSimulation(catalog, projected.cards, card, lines, {
      ...options,
      memberships:
        membership === null
          ? wallet.memberships
          : [...wallet.memberships, membership],
      valuations: wallet.valuations,
      held: heldIds,
    })
    const extraRewards = roundCents(simulation.rewards - current.rewards)
    const annualFee = card.annual_fee ?? 0
    const gain = roundCents(extraRewards - annualFee)
    const credits = allCreditsYear(
      catalog,
      card,
      options.start,
      wallet.valuations,
    ).yearly
    const addition: Addition = {
      cardId: card.id,
      picks: simulation.cards.at(-1)?.picks ?? {},
      extraRewards,
      annualFee,
      gain,
      credits,
      gainIfCreditsUsed: roundCents(gain + credits),
      simulation,
    }
    if (membership === null) additions.push(addition)
    else membersOnly.push({ ...addition, membership })
  }
  additions.sort(gainOrder)
  membersOnly.sort(gainOrder)
  return { current, additions, membersOnly }
}

// Rough monthly amounts for a U.S. household: the starting point when someone
// hasn't said what they spend. Answers built on them say so.
export const TYPICAL_MONTHLY_SPEND: { what: string; monthly: number }[] = [
  { what: 'Groceries', monthly: 500 },
  { what: 'Dining', monthly: 250 },
  { what: 'Gas', monthly: 150 },
  { what: 'Amazon', monthly: 100 },
  // Streaming bonuses follow each issuer's list of services, so the amount
  // is spent at one on every list, as the cheat sheet's streaming row is.
  { what: 'Streaming (Netflix)', monthly: 40 },
  { what: 'Flights', monthly: 60 },
  { what: 'Hotels', monthly: 60 },
  { what: 'Other travel', monthly: 30 },
  { what: 'Everything else', monthly: 800 },
]

// A spending line from everyday words: a category when one matches
// ("groceries", "other travel"), otherwise a merchant ("Amazon").
export function spendLineFor(
  catalog: Catalog,
  what: string,
  monthly: number,
): SpendLine {
  const direct = findCategory(catalog, what)
  if (direct !== null) return { merchant: null, category: direct, monthly }
  // "Streaming (Netflix)": spent at that store, read as the kind before it.
  const store = namedStore(what)
  const kind =
    store === null
      ? null
      : findCategory(catalog, what.slice(0, what.lastIndexOf('(')))
  const kindName = catalog.categories.find((c) => c.id === kind)?.name
  if (store !== null && kindName !== undefined)
    return { merchant: store, category: null, monthly, label: kindName }
  // "Other travel" beside "Flights" and "Hotels": the rest of the category.
  const rest = /^other\s+(.+)$/i.exec(what.trim())?.[1]
  const category = rest === undefined ? null : findCategory(catalog, rest)
  if (category === null) return { merchant: what, category: null, monthly }
  const name = catalog.categories.find((c) => c.id === category)?.name ?? ''
  return {
    merchant: null,
    category,
    monthly,
    label: `Other ${name.charAt(0).toLowerCase()}${name.slice(1)}`,
  }
}

export const typicalSpend = (catalog: Catalog): SpendLine[] =>
  TYPICAL_MONTHLY_SPEND.map((t) => spendLineFor(catalog, t.what, t.monthly))

export function typicalSpendLines(catalog: Catalog): ResolvedLine[] {
  return resolveSpendLines(catalog, typicalSpend(catalog))
}

export const TYPICAL_SPEND_NOTE = `No spending was given, so this uses rough typical monthly amounts for a U.S. household: ${TYPICAL_MONTHLY_SPEND.map((t) => `${t.what} ${money(t.monthly)}`).join(', ')}. Give your own amounts for a closer answer.`
