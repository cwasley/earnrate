import {
  findMerchant,
  merchantFamily,
  resolveMerchant,
  resolveMerchantById,
} from '../merchants/resolve.ts'
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { bonusStatus, type BonusStatus } from './bonus.ts'
import {
  amountUpgrade,
  evaluateCard,
  paymentUpgrade,
  purchaseContext,
  usableAt,
  type CardEvaluation,
} from './evaluate.ts'
import { introWindows, openedOn, withIntro } from './intro.ts'
import { membershipName } from './memberships.ts'
import {
  milestonePoints,
  milestonesReached,
  reachedText,
  type MilestoneHit,
} from './milestones.ts'
import { daysBetween } from './periods.ts'
import { creditAt, creditDollars, type CreditState } from './credits.ts'
import { ruleWhat } from './rule-text.ts'
import { rotationGap } from './rotation.ts'
import { EPSILON, isClose } from './compare.ts'
import {
  amountUnknownText,
  CAP_ADJECTIVES,
  categoryPhrase,
  codesAs,
  creditAnswerText,
  creditOverBonusText,
  currencyLabel,
  currencyName,
  earnText,
  heldName,
  introRateText,
  introUnknownText,
  listed,
  money,
  NETWORK_NAMES,
  num,
  paidText,
  paymentUnknownText,
  pct,
  pointValuesText,
  possessive,
  roundCents,
  shortDate,
  wholeDollars,
} from './text.ts'
import type {
  Confidence,
  ExcludedCard,
  MerchantResolution,
  Purchase,
  RankedCard,
  Recommendation,
} from './types.ts'
import { cardValuation, type Valuation } from './valuation.ts'

export const STALE_AFTER_DAYS = 180

// The engine only tells the U.S. from everywhere else.
export const FOREIGN_ASSUMPTION =
  'Treats this as a purchase outside the U.S.: each card is ranked after its foreign transaction fee.'

export const isForeign = (purchase: Pick<Purchase, 'country'>) =>
  purchase.country !== 'US'

// A fee that isn't on file counts as the usual 3%, so a card can't win
// abroad on a guess that it charges none.
const ASSUMED_FOREIGN_FEE = 3

export const foreignFeeFor = (
  card: Pick<Card, 'foreign_transaction_fee'>,
  purchase: Pick<Purchase, 'country'>,
) =>
  isForeign(purchase)
    ? (card.foreign_transaction_fee ?? ASSUMED_FOREIGN_FEE)
    : 0

// Any purchase outside the U.S., when no country is named: ZZ is a code ISO
// leaves unassigned, and nothing prints it.
export const ABROAD = 'ZZ'

// The warning when no card works; the CLI shows it as the answer instead.
export const noCardText = (merchant: string) =>
  `None of your cards work at ${merchant}.`
const NEAR_CAP_SHARE = 0.2

type Entry = {
  card: Card
  held: WalletCard
  valuation: Valuation
  evaluation: CardEvaluation
  // Spend milestones this purchase reaches, whose points count toward it.
  milestones: MilestoneHit[]
  perDollar: number // currency units per dollar, milestone points included
  // The card's own rate on this purchase, net of `fee`: what's shown as "% back".
  // A milestone's points count toward the ranking but are shown on their own.
  rateReturnPct: number
  fee: number // foreign transaction fee percent on this purchase, else 0
  // The card's merchant credit here, and what it adds to this purchase's
  // return: its dollars as a percent of the amount (0 without one).
  credit: CreditState | null
  creditDollars: number | null
  creditPct: number
  effectiveReturnPct: number // net of `fee`, with `creditPct`
  upside: number // return at the top of the currency's value range
  // With no opening date on file: what an intro rate would make this
  // purchase earn on a new account.
  ifNew: { rate: number; returnPct: number; days: number } | null
  // With the purchase's payment unknown: a way of paying that a rule on the
  // card asks for, and what this purchase would earn paid that way.
  ifPaid: {
    payment: NonNullable<Purchase['payment']>
    rate: number
    returnPct: number
  } | null
  // With no amount: the smallest one a rule on the card asks for, and what
  // the purchase would earn at that size.
  ifLarger: { amount: number; rate: number; returnPct: number } | null
}

const displayName = (e: Entry) => e.held.checkout_label ?? e.card.name

// "Worth X or more" must hold at X itself, so round up; "less than X" rounds down.
const roundUp = (n: number) => String(Math.ceil(n * 100 - EPSILON) / 100)
// At exactly the break-even value the two cards tie, so only an exact
// threshold reads "more than".
const worthAbove = (n: number) =>
  Math.abs(n * 100 - Math.round(n * 100)) < EPSILON
    ? `more than ${num(n)}¢`
    : `${roundUp(n)}¢ or more`
const roundDown = (n: number) => String(Math.floor(n * 100 + EPSILON) / 100)

function compareEntries(a: Entry, b: Entry): number {
  const byReturn = b.effectiveReturnPct - a.effectiveReturnPct
  if (Math.abs(byReturn) > EPSILON) return byReturn
  const byUpside = b.upside - a.upside
  if (Math.abs(byUpside) > EPSILON) return byUpside
  const aCapped = a.evaluation.best.cap !== null
  const bCapped = b.evaluation.best.cap !== null
  if (aCapped !== bCapped) return aCapped ? 1 : -1
  return a.card.id.localeCompare(b.card.id)
}

export type RecommendOptions = {
  // Simulations and the cheat sheet rank by rates alone.
  credits?: boolean
}

function rankEntries(
  catalog: Catalog,
  wallet: Wallet,
  purchase: Purchase,
  merchant: MerchantResolution,
  category: string,
  options: RecommendOptions = {},
): { entries: Entry[]; excluded: ExcludedCard[] } {
  const ctx = purchaseContext(catalog, wallet, merchant, category, purchase)
  const entries: Entry[] = []
  const excluded: ExcludedCard[] = []

  for (const held of wallet.cards) {
    const card = catalog.cards.find((c) => c.id === held.id)
    if (!card) continue
    if (!usableAt(card, merchant)) {
      // A store card elsewhere isn't worth mentioning; a network the merchant
      // doesn't take is.
      if (card.only_at || card.network === 'store' || !merchant.accepts)
        continue
      const takes = merchant.accepts
        .map((n) => NETWORK_NAMES[n] ?? n)
        .join(' or ')
      const where =
        merchant.channel === 'in_store'
          ? ' in-store'
          : merchant.channel === 'online'
            ? ' online'
            : ''
      excluded.push({
        cardId: card.id,
        cardName: card.name,
        checkoutLabel: held.checkout_label ?? null,
        network: card.network,
        reason: `${merchant.resolvedName} takes only ${takes}${where}.`,
      })
      continue
    }
    const valuation = cardValuation(catalog, wallet, card)
    const evaluation = evaluateCard(card, held, ctx)
    const milestones = milestonesReached(
      card,
      held,
      purchase.date,
      purchase.amount,
    )
    const bonusPoints = milestonePoints(milestones)
    const perDollar =
      evaluation.best.rate +
      (bonusPoints > 0 && purchase.amount ? bonusPoints / purchase.amount : 0)
    const fee = foreignFeeFor(card, purchase)
    const fresh =
      card.intro_rates.length > 0 && openedOn(held) === null
        ? evaluateCard(card, { ...held, opened: purchase.date }, ctx).best
        : null
    const ifNew =
      fresh && fresh.rate > evaluation.best.rate + EPSILON
        ? {
            rate: fresh.nominalRate,
            returnPct:
              (perDollar - evaluation.best.rate + fresh.rate) *
                valuation.centsPerUnit -
              fee,
            days: (fresh.intro[0]?.intro ?? card.intro_rates[0])?.days ?? 365,
          }
        : null
    const paid = paymentUpgrade(card, held, ctx, evaluation.best.rate)
    const larger = amountUpgrade(card, held, ctx, evaluation.best.rate)
    const credit =
      options.credits === false
        ? null
        : creditAt(
            catalog,
            card,
            held,
            { ...merchant, category },
            purchase.date,
          )
    const back = credit ? creditDollars(credit, purchase.amount) : null
    const creditPct =
      back !== null && back > 0 && purchase.amount
        ? (back / purchase.amount) * 100
        : 0
    entries.push({
      card,
      held,
      valuation,
      evaluation,
      milestones,
      perDollar,
      fee,
      credit,
      creditDollars: back,
      creditPct,
      effectiveReturnPct: perDollar * valuation.centsPerUnit - fee + creditPct,
      rateReturnPct: evaluation.best.rate * valuation.centsPerUnit - fee,
      upside:
        perDollar * (valuation.range?.[1] ?? valuation.centsPerUnit) -
        fee +
        creditPct,
      ifNew: ifNew && { ...ifNew, returnPct: ifNew.returnPct + creditPct },
      ifPaid: paid
        ? {
            payment: paid.payment,
            rate: paid.nominalRate,
            returnPct:
              (perDollar - evaluation.best.rate + paid.rate) *
                valuation.centsPerUnit -
              fee +
              creditPct,
          }
        : null,
      ifLarger: larger
        ? {
            amount: larger.amount,
            rate: larger.nominalRate,
            returnPct:
              (perDollar - evaluation.best.rate + larger.rate) *
                valuation.centsPerUnit -
              fee,
          }
        : null,
    })
  }

  entries.sort(compareEntries)
  return { entries, excluded }
}

function reasoningFor(
  catalog: Catalog,
  wallet: Wallet,
  entry: Entry,
  amount: number | null,
): string[] {
  const { card, valuation, evaluation } = entry
  const { best } = evaluation
  const lines: string[] = []
  const currency = valuation.currency

  // The standard rate first; a first-year rate on top of it is its own line.
  // The intro's terms stay in search_cards, not in every answer.
  const [intro] = best.intro
  const standard = earnText(
    catalog,
    intro ? best.standardRate : best.nominalRate,
    currency,
  )
  if (best.rule) {
    const note = best.rule.note ? ` ${best.rule.note}` : ''
    lines.push(
      `${standard} on ${ruleWhat(catalog, best.rule, card)}${best.rule.requires?.membership === undefined ? '' : `, with ${membershipName(catalog, best.rule.requires.membership)}`}.${note}`,
    )
  } else {
    lines.push(`${standard}, its base rate. No bonus category applies here.`)
  }
  if (intro)
    lines.push(
      introRateText(
        earnText(catalog, best.nominalRate, currency),
        standard,
        intro.intro.days,
        intro.until,
      ),
    )

  const cap = best.cap
  if (cap && amount !== null && amount > cap.remaining) {
    const over = amount - cap.remaining
    lines.push(
      `${money(cap.remaining)} earns ${earnText(catalog, best.nominalRate, currency)} before the cap, then ${money(over)} earns ${earnText(catalog, best.afterCap ?? cap.cap.then_rate, currency)}: ${num(best.rate)} per dollar overall.`,
    )
  }

  for (const hit of entry.milestones)
    lines.push(reachedText(card, hit, valuation.centsPerUnit))
  if (entry.credit)
    lines.push(creditAnswerText(entry.credit, entry.creditDollars))

  if (valuation.pooledFrom !== null) {
    const partners = card.pools_into?.when_wallet_has ?? []
    const heldPartners = wallet.cards
      .filter((h) => partners.includes(h.id))
      .map((h) => heldName(catalog, h))
    lines.push(
      `Pools into ${currencyName(catalog, currency)} because you hold ${listed(heldPartners)}.`,
    )
  }

  if (currency !== 'cash') {
    lines.push(
      `Valued at ${num(valuation.centsPerUnit)}¢ per point: ${pct(entry.evaluation.best.rate * valuation.centsPerUnit)} back.`,
    )
  }
  return lines
}

function warningsFor(
  catalog: Catalog,
  entry: Entry,
  purchase: Purchase,
): string[] {
  const { card, valuation, evaluation } = entry
  const { best, nominal } = evaluation
  const warnings: string[] = []
  if (isForeign(purchase) && card.foreign_transaction_fee === null)
    warnings.push(
      `Its foreign transaction fee isn't on file, so earnrate assumes the usual ${pct(entry.fee)} and it nets ${pct(entry.rateReturnPct)}. Check the issuer's terms before using it abroad.`,
    )
  else if (entry.fee > 0)
    warnings.push(
      `Charges a ${pct(entry.fee)} foreign transaction fee here, so it nets ${pct(entry.rateReturnPct)}.`,
    )
  const capLabel = (e: typeof best) =>
    e.cap
      ? `${money(e.cap.cap.amount)} ${CAP_ADJECTIVES[e.cap.cap.period]} cap`
      : ''

  if (best.cap && best.rule) {
    const { remaining, cap, period } = best.cap
    if (period === null) {
      warnings.push(
        `Add this card's anniversary (MM-DD) to your wallet so its ${capLabel(best)} can be tracked.`,
      )
    } else if (purchase.amount !== null && purchase.amount > remaining) {
      warnings.push(
        `This purchase crosses the ${capLabel(best)} on ${ruleWhat(catalog, best.rule, card)}: only ${money(remaining)} is left for ${period}.`,
      )
    } else if (remaining < cap.amount * NEAR_CAP_SHARE) {
      warnings.push(
        `Only ${money(remaining)} left of the ${capLabel(best)} on ${ruleWhat(catalog, best.rule, card)} for ${period}.`,
      )
    }
  }
  if (
    nominal.rule &&
    nominal.cap &&
    nominal !== best &&
    nominal.cap.remaining === 0
  ) {
    warnings.push(
      `The ${capLabel(nominal)} on ${ruleWhat(catalog, nominal.rule, card)} is used up for ${nominal.cap.period ?? 'this period'}, so it earns ${earnText(catalog, nominal.afterCap ?? nominal.cap.cap.then_rate, valuation.currency)} until it resets.`,
    )
  }
  if (best.rule?.unverified !== undefined) {
    warnings.push(
      `This rate isn't confirmed against the issuer's terms yet: ${best.rule.unverified}`,
    )
  }
  const age = daysBetween(card.last_verified, purchase.date)
  if (age > STALE_AFTER_DAYS) {
    warnings.push(
      `Card data last verified ${card.last_verified} (${String(age)} days ago). Check the issuer's terms before relying on it.`,
    )
  }
  if (evaluation.staleChoice !== null) {
    warnings.push(
      `Your chosen categories are set for ${evaluation.staleChoice}, not the current period, so chosen-category bonuses don't apply until you update them.`,
    )
  }
  const windows = introWindows(card, entry.held, purchase.date)
  for (const rule of evaluation.needsActivation) {
    const rate = earnText(
      catalog,
      withIntro(rule.rate, rule.id, windows),
      valuation.currency,
    )
    if (rule.activate_by !== undefined && rule.activate_by < purchase.date) {
      warnings.push(
        `The bonus here (${rate}) needed activating by ${shortDate(rule.activate_by)}.`,
      )
      continue
    }
    warnings.push(
      `Activate this bonus with the issuer (it's free)${rule.activate_by === undefined ? '' : ` by ${shortDate(rule.activate_by)}`} to earn ${rate} here${rule.valid_to === undefined ? '' : ` through ${shortDate(rule.valid_to)}`}.`,
    )
  }
  return warnings
}

function toRanked(
  catalog: Catalog,
  wallet: Wallet,
  entry: Entry,
  purchase: Purchase,
): RankedCard {
  const { card, held, valuation, evaluation } = entry
  return {
    cardId: card.id,
    cardName: card.name,
    checkoutLabel: held.checkout_label ?? null,
    matchedRule: evaluation.best.rule?.id ?? null,
    rate: evaluation.best.rate,
    currency: valuation.currency,
    centsPerUnit: valuation.centsPerUnit,
    effectiveReturnPct: entry.rateReturnPct,
    foreignFee: entry.fee > 0 ? entry.fee : null,
    earned:
      purchase.amount === null
        ? null
        : Math.round(purchase.amount * entry.rateReturnPct) / 100,
    milestoneBonus:
      entry.milestones.length === 0
        ? null
        : {
            points: milestonePoints(entry.milestones),
            dollars: roundCents(
              (milestonePoints(entry.milestones) *
                entry.valuation.centsPerUnit) /
                100,
            ),
          },
    credit: entry.credit && {
      id: entry.credit.credit.id,
      name: entry.credit.name,
      amount: entry.credit.amount,
      period: entry.credit.period,
      enrolled: entry.credit.enrolled,
      left: entry.credit.left,
      until: entry.credit.until,
      dollars: entry.creditDollars,
    },
    capped: evaluation.best.cap !== null,
    reasoning: reasoningFor(catalog, wallet, entry, purchase.amount),
    warnings: warningsFor(catalog, entry, purchase),
  }
}

function tieNote(entries: Entry[]): string | null {
  const [winner, ...rest] = entries
  if (!winner) return null
  const tied = rest.filter(
    (e) =>
      Math.abs(e.effectiveReturnPct - winner.effectiveReturnPct) <= EPSILON,
  )
  const first = tied[0]
  if (!first) return null
  const names = listed(tied.map(displayName))
  const verb = tied.length === 1 ? 'earns' : 'earn'
  const why =
    winner.upside - first.upside > EPSILON
      ? 'because its points can be worth more'
      : winner.evaluation.best.cap === null &&
          tied.some((e) => e.evaluation.best.cap !== null)
        ? 'because its rate has no cap'
        : 'by a fixed order; either works'
  return `${names} also ${verb} ${pct(winner.rateReturnPct)} here. ${displayName(winner)} wins the tie ${why}.`
}

// "Chase Ultimate Rewards points", but not "IHG One Rewards points points".
const pointsName = (label: string) =>
  /\b(points|miles)$/i.test(label) ? label : `${label} points`

// Finds the closest point inside a currency's value range where the winner
// stops winning, varying one currency at a time. Returns are linear in the
// cents-per-point value, so each pair of cards flips at most once.
function sensitivity(catalog: Catalog, entries: Entry[]): string | null {
  const [winner, ...rest] = entries
  if (!winner) return null
  let closest: { shift: number; text: string } | null = null

  const consider = (shift: number, text: string) => {
    if (!closest || shift < closest.shift) closest = { shift, text }
  }

  for (const other of rest) {
    const w = winner.valuation
    const o = other.valuation
    if (w.currency === o.currency) continue
    const wRate = winner.perDollar
    const oRate = other.perDollar

    // Net return is rate × value − fee + credit, so each flip point adds the
    // fee back and takes the credit off.
    if (w.range && wRate > 0) {
      const threshold =
        (other.effectiveReturnPct + winner.fee - winner.creditPct) / wRate
      if (threshold < w.centsPerUnit && threshold >= w.range[0]) {
        consider(
          (w.centsPerUnit - threshold) / w.centsPerUnit,
          `${displayName(other)} beats ${displayName(winner)} here if ${pointsName(currencyLabel(catalog, w.currency))} are worth less than ${roundDown(threshold)}¢ (you value them at ${num(w.centsPerUnit)}¢).`,
        )
      }
    }
    if (o.range && oRate > 0) {
      const threshold =
        (winner.effectiveReturnPct + other.fee - other.creditPct) / oRate
      if (threshold > o.centsPerUnit && threshold <= o.range[1]) {
        consider(
          (threshold - o.centsPerUnit) / o.centsPerUnit,
          `${displayName(other)} beats ${displayName(winner)} here if ${pointsName(currencyLabel(catalog, o.currency))} are worth ${worthAbove(threshold)} (you value them at ${num(o.centsPerUnit)}¢).`,
        )
      }
    }
  }
  return (closest as { text: string } | null)?.text ?? null
}

function assumptionsFor(
  catalog: Catalog,
  merchant: MerchantResolution,
  purchase: Purchase,
  entries: Entry[],
): string[] {
  const assumptions: string[] = []
  if (merchant.source === 'none') {
    assumptions.push(
      `Treats "${merchant.input}" as an everyday purchase with no bonus category.`,
    )
  } else if (merchant.source === 'category') {
    assumptions.push(
      `Ranks purchases that code as ${categoryPhrase(catalog, merchant.category)}.`,
    )
  } else if (merchant.category === 'other') {
    // A card whose rule names this store by name (Audible on Amex's
    // streaming list) earns its bonus there anyway.
    const naming = entries.flatMap((e) => {
      const rule = e.evaluation.best.rule
      return rule &&
        merchantFamily(catalog, merchant.merchantId).some((id) =>
          (rule.match.merchants ?? []).includes(id),
        )
        ? [`${displayName(e)} (${ruleWhat(catalog, rule, e.card)})`]
        : []
    })
    assumptions.push(
      naming.length === 0
        ? `Assumes ${merchant.resolvedName} falls outside the usual bonus categories.`
        : `Assumes ${merchant.resolvedName} falls outside the usual bonus categories, except on cards that name it: ${listed(naming)}.`,
    )
  } else {
    assumptions.push(codesAs(catalog, merchant))
  }
  if (merchant.inference) {
    assumptions.push(`Claude's reasoning: ${merchant.inference.rationale}`)
  }
  if (purchase.channel === null && merchant.channel === 'in_store') {
    assumptions.push(
      `Assumes an in-store purchase. ${merchant.resolvedName} takes cards differently online.`,
    )
  }
  if (merchant.channel === null && purchase.payment === 'paypal') {
    assumptions.push(
      'Assumes an online purchase, since PayPal checkout is online.',
    )
  }
  if (purchase.channel === null && merchant.channel === 'online') {
    assumptions.push(
      'Assumes an online purchase, since you gave a web address.',
    )
  }
  const values = pointValuesText(
    catalog,
    entries.map((e) => e.valuation),
  )
  if (values !== null) assumptions.push(values)
  if (isForeign(purchase)) assumptions.push(FOREIGN_ASSUMPTION)
  if (purchase.payment) assumptions.push(paidText(purchase.payment))
  const winner = entries[0]
  for (const e of entries) {
    if (!e.ifPaid || !winner) continue
    if (
      e !== winner &&
      e.ifPaid.returnPct <= winner.effectiveReturnPct + EPSILON
    )
      continue
    const currency = e.valuation.currency
    assumptions.push(
      paymentUnknownText(
        displayName(e),
        e.ifPaid.payment,
        earnText(catalog, e.ifPaid.rate, currency),
        earnText(catalog, e.evaluation.best.nominalRate, currency),
      ),
    )
  }
  for (const e of entries) {
    if (!e.ifLarger || !winner) continue
    if (
      e !== winner &&
      e.ifLarger.returnPct <= winner.effectiveReturnPct + EPSILON
    )
      continue
    const currency = e.valuation.currency
    assumptions.push(
      amountUnknownText(
        displayName(e),
        e.ifLarger.amount,
        earnText(catalog, e.ifLarger.rate, currency),
        earnText(catalog, e.evaluation.best.nominalRate, currency),
      ),
    )
  }
  for (const e of entries) {
    if (!e.ifNew || !winner) continue
    if (
      e !== winner &&
      e.ifNew.returnPct <= winner.effectiveReturnPct + EPSILON
    )
      continue
    const currency = e.valuation.currency
    assumptions.push(
      introUnknownText(
        displayName(e),
        earnText(catalog, e.ifNew.rate, currency),
        earnText(catalog, e.evaluation.best.nominalRate, currency),
        e.ifNew.days,
      ),
    )
  }
  for (const e of entries)
    for (const hit of e.milestones)
      assumptions.push(
        `Counts the ${money(hit.before)} tracked on ${displayName(e)} in ${hit.period} toward its ${wholeDollars(hit.spend)} spend bonus; spending earnrate wasn't told about isn't counted.`,
      )
  return assumptions
}

export function recommend(
  catalog: Catalog,
  wallet: Wallet,
  purchase: Purchase,
  merchant: MerchantResolution = resolveMerchant(
    catalog,
    purchase.merchant,
    purchase.channel,
  ),
  options: RecommendOptions = {},
): Recommendation {
  const { entries, excluded } = rankEntries(
    catalog,
    wallet,
    purchase,
    merchant,
    merchant.category,
    options,
  )
  const ranked = entries.map((e) => toRanked(catalog, wallet, e, purchase))
  const winner = entries[0]
  const warnings: string[] = []
  const notes: string[] = []
  const charging = entries.filter(
    (e) => e.fee > 0 && e.card.foreign_transaction_fee !== null,
  )
  const assumed = entries.filter(
    (e) => e.fee > 0 && e.card.foreign_transaction_fee === null,
  )
  if (charging.length > 0 && entries.length > 1)
    notes.push(
      `${listed(charging.map((e) => `${displayName(e)} (${pct(e.fee)})`))} ${charging.length === 1 ? 'charges a foreign transaction fee' : 'charge foreign transaction fees'} here, already subtracted in the ranking.`,
    )
  if (assumed.length > 0 && entries.length > 1)
    notes.push(
      `${listed(assumed.map(displayName))} ${assumed.length === 1 ? 'has' : 'have'} no foreign transaction fee on file, so the usual ${pct(ASSUMED_FOREIGN_FEE)} is subtracted.`,
    )

  if (merchant.source === 'none') {
    warnings.push(
      `Couldn't identify "${merchant.input}", so only base rates apply. If you know what kind of business it is, give its category (like dining or grocery) to find bonus rates.`,
    )
  }
  if (merchant.source === 'caller') {
    warnings.push(
      `"${merchant.input}" isn't in earnrate's merchant list, so it uses the category given with the request. Check how it codes on your statement.`,
    )
  }
  if (merchant.inference) {
    const saved = merchant.inference.cached
      ? `, saved ${merchant.inference.classifiedOn}`
      : ''
    warnings.push(
      `"${merchant.input}" isn't in earnrate's merchant list, so its category is Claude's guess (${merchant.inference.model}${saved}). Check how it codes on your statement.`,
    )
  }

  if (merchant.ambiguity) {
    const alternatives = merchant.ambiguity.mayCodeAs.map((c) =>
      categoryPhrase(catalog, c),
    )
    warnings.push(
      `${merchant.resolvedName} may code as ${alternatives.join(' or ')} instead: ${merchant.ambiguity.note}`,
    )
    for (const category of merchant.ambiguity.mayCodeAs) {
      const alts = rankEntries(
        catalog,
        wallet,
        purchase,
        merchant,
        category,
        options,
      ).entries
      const alt = alts[0]
      if (!alt || !winner) continue
      const as = `If it codes as ${categoryPhrase(catalog, category)}`
      // The same pick there may share the top with another card.
      const twin = alts.find(
        (e) =>
          e.card.id !== winner.card.id &&
          alt.effectiveReturnPct - e.effectiveReturnPct <= EPSILON,
      )
      if (alt.card.id !== winner.card.id)
        warnings.push(
          `${as}, ${displayName(alt)} wins (${pct(alt.rateReturnPct)}).`,
        )
      else if (twin)
        warnings.push(
          `${as}, ${displayName(twin)} earns as much (${pct(twin.rateReturnPct)}).`,
        )
    }
  }

  if (!winner) {
    warnings.push(noCardText(merchant.resolvedName))
    // Only where the merchant's data says what its website takes: without
    // that, every network is assumed, and a gas pump has no website.
    const record =
      merchant.merchantId === null
        ? undefined
        : findMerchant(catalog, merchant.merchantId)
    const online =
      merchant.channel === 'in_store' &&
      merchant.merchantId !== null &&
      record?.online?.accepts !== undefined
        ? resolveMerchantById(catalog, merchant.merchantId, 'online')
        : null
    const alt = online
      ? rankEntries(
          catalog,
          wallet,
          { ...purchase, channel: 'online' },
          online,
          online.category,
          options,
        ).entries[0]
      : undefined
    if (alt)
      warnings.push(
        `Ordering online instead? ${displayName(alt)} works there (${pct(alt.rateReturnPct)}).`,
      )
  } else if (
    merchant.accepts === null &&
    (winner.card.network === 'amex' || winner.card.network === 'discover')
  ) {
    const backup = entries.find((e) => e.card.network !== winner.card.network)
    const fallback = backup
      ? ` If it's declined, ${displayName(backup)} is your best card on another network.`
      : ''
    warnings.push(
      `Not every business takes ${NETWORK_NAMES[winner.card.network] ?? winner.card.network}.${fallback}`,
    )
  }

  for (const held of wallet.cards) {
    const card = catalog.cards.find((c) => c.id === held.id)
    const gap = card ? rotationGap(card, purchase.date) : null
    if (card && gap !== null) {
      const name = held.checkout_label ?? card.name
      warnings.push(
        `${possessive(name)} rotating categories for ${gap} aren't in earnrate's data yet, so it's ranked without them. If this purchase is in that period's categories, ${name} may earn more. An earnrate update adds them once the issuer announces them.`,
      )
    }
  }

  for (const id of merchant.bookedVia) {
    const via = resolveMerchantById(catalog, id, purchase.channel)
    if (!via || !winner) continue
    const alt = rankEntries(
      catalog,
      wallet,
      purchase,
      via,
      via.category,
      options,
    ).entries[0]
    if (alt && alt.effectiveReturnPct > winner.effectiveReturnPct + EPSILON) {
      notes.push(
        `If you book it as ${via.resolvedName}, ${displayName(alt)} earns ${pct(alt.rateReturnPct)}.`,
      )
    }
  }

  const open = bonusPick(catalog, wallet, entries, purchase.date)
  // Behind pace, the bonus card takes the pick; on pace, only where it earns
  // as much as the best card (it costs nothing there). Within a point, it's
  // mentioned; otherwise the bonus isn't this purchase's business.
  const gap =
    open && winner
      ? winner.effectiveReturnPct - open.entry.effectiveReturnPct
      : Infinity
  // Already the best card, it's the pick anyway: a tie needs no note.
  const isBest = open !== null && open.entry === winner
  const ties = !isBest && gap <= EPSILON
  // Unused credit ends with its period; the bonus's spending can move to
  // other purchases. Any card ranked above the bonus card counts: a spend
  // bonus can put another card first.
  const creditEntry =
    open?.behind && !isBest && !ties
      ? entries
          .slice(0, entries.indexOf(open.entry))
          .find(
            (e) =>
              e.credit !== null &&
              (e.creditDollars ?? e.credit.left ?? e.credit.amount) > 0,
          )
      : undefined
  const bonus = open && !creditEntry && (open.behind || ties) ? open : null
  if (open && creditEntry?.credit)
    notes.push(
      creditOverBonusText(
        displayName(creditEntry),
        creditEntry.credit,
        displayName(open.entry),
        open.status.remaining ?? 0,
        open.status.deadline ?? purchase.date,
      ),
    )
  const best = winner?.effectiveReturnPct ?? 0
  const toGo = open
    ? `${money(open.status.remaining ?? 0)} more by ${open.status.deadline ?? ''}`
    : ''
  if (open && isBest && !bonus)
    notes.push(
      `${displayName(open.entry)} is the best card here anyway, and this counts toward its welcome bonus (${toGo}).`,
    )
  else if (
    open &&
    !bonus &&
    !creditEntry &&
    isClose(open.entry.effectiveReturnPct, best)
  )
    notes.push(
      `${displayName(open.entry)} earns ${pct(open.entry.rateReturnPct)} here, ${num(gap)} ${gap === 1 ? 'point' : 'points'} less than ${pct(best)}, and would help its welcome bonus (${toGo}). You're on pace, so this uses the higher rate.`,
    )
  const chosen = bonus?.entry ?? creditEntry ?? winner
  // A tie among the top cards doesn't matter when a welcome bonus decides.
  const tie = bonus || creditEntry ? null : tieNote(entries)
  if (tie) notes.push(tie)
  const top = ranked.find((r) => r.cardId === chosen?.card.id)
  const first = ranked[0]
  let bonusResult: Recommendation['bonus'] = null
  if (bonus && top && first) {
    const { status } = bonus
    const remaining = status.remaining ?? 0
    const deadline = status.deadline ?? purchase.date
    const daysLeft = status.daysLeft ?? 0
    const costHere =
      ties || top.earned === null || first.earned === null
        ? null
        : // A spend bonus isn't lost here, only moved to a later purchase.
          roundCents(
            first.earned +
              (first.credit?.dollars ?? 0) -
              (top.earned + (top.credit?.dollars ?? 0)),
          )
    bonusResult = {
      cardId: top.cardId,
      checkoutLabel: top.checkoutLabel,
      remaining,
      deadline,
      daysLeft,
      value: status.value,
      costHere,
    }
    const pace =
      daysLeft >= 7
        ? ` (about ${wholeDollars(remaining / (daysLeft / 7))} a week)`
        : ''
    const worth =
      status.value === null ? '' : `, worth about ${wholeDollars(status.value)}`
    notes.unshift(
      ties
        ? `${displayName(bonus.entry)} earns as much here as any of your cards, so it's the pick: it helps its welcome bonus, ${money(remaining)} more to spend by ${deadline}${worth}.`
        : `You're behind pace on ${possessive(displayName(bonus.entry))} welcome bonus: ${money(remaining)} more to spend by ${deadline}${pace}${worth}.${
            isBest
              ? ''
              : costHere === null
                ? ` It earns ${pct(top.effectiveReturnPct)} here against ${pct(first.effectiveReturnPct)} on ${displayName(entries[0] ?? bonus.entry)}, which the bonus outweighs.`
                : ` Using it here earns ${money(costHere)} less than ${displayName(entries[0] ?? bonus.entry)}, which the bonus outweighs.`
          }`,
    )
  }

  let confidence: Confidence = merchant.confidence
  if (confidence === 'high' && chosen && top) {
    const unverified = chosen.evaluation.best.rule?.unverified !== undefined
    const stale =
      daysBetween(chosen.card.last_verified, purchase.date) > STALE_AFTER_DAYS
    if (unverified || stale) confidence = 'medium'
  }

  return {
    decision:
      chosen && top
        ? {
            cardId: top.cardId,
            checkoutLabel: top.checkoutLabel,
            effectiveReturnPct: top.effectiveReturnPct,
            confidence,
          }
        : null,
    merchant,
    ranked,
    excluded,
    assumptions: assumptionsFor(catalog, merchant, purchase, entries),
    warnings,
    notes,
    sensitivity:
      bonusResult || (creditEntry && creditEntry !== winner)
        ? null
        : sensitivity(catalog, entries),
    bonus: bonusResult,
  }
}

// Behind a steady pace by more than a week's share of the spending, or by
// anything in the last two weeks. A smaller shortfall closes with ordinary
// spending, so it doesn't justify a card that earns less.
function behindPace(status: BonusStatus, date: string): boolean {
  if (status.spend === null || status.deadline === null) return false
  const window = Math.max(1, daysBetween(status.opened, status.deadline))
  const elapsed = Math.min(window, daysBetween(status.opened, date))
  const short = (status.spend * elapsed) / window - status.spent
  if (short <= 0) return false
  return (
    short > (status.spend * 7) / window ||
    daysBetween(date, status.deadline) <= 14
  )
}

// The open welcome bonus that most needs this purchase: the one with the most
// spend still needed per day left. Only a bonus behind pace takes the pick
// (`behind`); one on pace is only mentioned.
function bonusPick(
  catalog: Catalog,
  wallet: Wallet,
  entries: Entry[],
  date: string,
): { entry: Entry; status: BonusStatus; behind: boolean } | null {
  let pick: {
    entry: Entry
    status: BonusStatus
    behind: boolean
    pace: number
  } | null = null
  for (const entry of entries) {
    const status = bonusStatus(catalog, wallet, entry.held, date)
    if (status?.state !== 'open' || date < status.opened) continue
    const behind = behindPace(status, date)
    const pace = (status.remaining ?? 0) / Math.max(1, status.daysLeft ?? 1)
    if (
      !pick ||
      (behind && !pick.behind) ||
      (behind === pick.behind && pace > pick.pace)
    )
      pick = { entry, status, behind, pace }
  }
  return pick
}
