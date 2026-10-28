import type { Catalog } from '../data/load.ts'
import { resolveMerchant, resolveMerchantById } from '../merchants/resolve.ts'
import type { Card } from '../schema/card.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import {
  evaluateCard,
  purchaseContext,
  type CardEvaluation,
} from './evaluate.ts'
import { bonusStatus, type BonusStatus } from './bonus.ts'
import { daysBetween } from './periods.ts'
import type {
  Confidence,
  ExcludedCard,
  MerchantResolution,
  Purchase,
  RankedCard,
  Recommendation,
} from './types.ts'
import { cardValuation, type Valuation } from './valuation.ts'

const EPSILON = 1e-9
export const STALE_AFTER_DAYS = 180
const NEAR_CAP_SHARE = 0.2

const NETWORK_NAMES: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
}

const PERIOD_WORDS: Record<string, string> = {
  month: 'monthly',
  quarter: 'quarterly',
  calendar_year: 'calendar-year',
  cardmember_year: 'cardmember-year',
}

type Entry = {
  card: Card
  held: WalletCard
  valuation: Valuation
  evaluation: CardEvaluation
  effectiveReturnPct: number
  upside: number // return at the top of the currency's value range
}

const displayName = (e: Entry) => e.held.checkout_label ?? e.card.name

const num = (n: number) => String(Number(n.toFixed(2)))
// Whole dollars stay whole ($2,800); anything else shows cents ($0.40).
const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`
const dollars = (n: number) =>
  `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`

function currencyName(catalog: Catalog, id: string): string {
  return catalog.currencies.find((c) => c.id === id)?.name ?? id
}

function currencyLabel(catalog: Catalog, id: string): string {
  const name = currencyName(catalog, id)
  return /^[A-Z]{2,4}$/.test(id) ? `${name} (${id})` : name
}

// "Worth X or more" must hold at X itself, so round up; "less than X" rounds down.
const roundUp = (n: number) => String(Math.ceil(n * 100 - EPSILON) / 100)
const roundDown = (n: number) => String(Math.floor(n * 100 + EPSILON) / 100)

function categoryName(catalog: Catalog, id: string): string {
  return catalog.categories.find((c) => c.id === id)?.name ?? id
}

// Mid-sentence form: "Supermarkets" becomes "supermarkets", but "TV and
// internet service" and "EV charging" keep their acronyms.
function categoryPhrase(catalog: Catalog, id: string): string {
  const name = categoryName(catalog, id)
  return /^[A-Z]{2}/.test(name)
    ? name
    : name.charAt(0).toLowerCase() + name.slice(1)
}

function earnText(catalog: Catalog, rate: number, currency: string): string {
  return currency === 'cash'
    ? `${num(rate)}% cash back`
    : `${num(rate)}x ${currencyName(catalog, currency)}`
}

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

function rankEntries(
  catalog: Catalog,
  wallet: Wallet,
  purchase: Purchase,
  merchant: MerchantResolution,
  category: string,
): { entries: Entry[]; excluded: ExcludedCard[] } {
  const ctx = purchaseContext(catalog, wallet, merchant, category, purchase)
  const entries: Entry[] = []
  const excluded: ExcludedCard[] = []

  for (const held of wallet.cards) {
    const card = catalog.cards.find((c) => c.id === held.id)
    if (!card) continue
    if (card.only_at) {
      if (
        merchant.merchantId === null ||
        !card.only_at.includes(merchant.merchantId)
      )
        continue
    } else if (
      card.network !== 'store' &&
      merchant.accepts &&
      !merchant.accepts.includes(card.network)
    ) {
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
    const rate = evaluation.best.rate
    entries.push({
      card,
      held,
      valuation,
      evaluation,
      effectiveReturnPct: rate * valuation.centsPerUnit,
      upside: rate * (valuation.range?.[1] ?? valuation.centsPerUnit),
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

  if (best.rule) {
    const note = best.rule.note ? ` ${best.rule.note}` : ''
    lines.push(
      `${earnText(catalog, best.nominalRate, currency)} from its "${best.rule.id}" rule.${note}`,
    )
  } else {
    lines.push(
      `${earnText(catalog, card.base_rate, currency)}, its base rate. No bonus category applies here.`,
    )
  }

  const cap = best.cap
  if (cap && amount !== null && amount > cap.remaining) {
    const over = amount - cap.remaining
    lines.push(
      `${dollars(cap.remaining)} earns ${earnText(catalog, best.nominalRate, currency)} before the cap, then ${dollars(over)} earns ${earnText(catalog, cap.cap.then_rate, currency)}: ${num(best.rate)} per dollar overall.`,
    )
  }

  if (valuation.pooledFrom !== null) {
    const partners = card.pools_into?.when_wallet_has ?? []
    const heldPartners = wallet.cards
      .filter((h) => partners.includes(h.id))
      .map(
        (h) =>
          h.checkout_label ??
          catalog.cards.find((c) => c.id === h.id)?.name ??
          h.id,
      )
    lines.push(
      `Pools into ${currencyName(catalog, currency)} because you hold ${heldPartners.join(' and ')}.`,
    )
  }

  if (currency !== 'cash') {
    lines.push(
      `Valued at ${num(valuation.centsPerUnit)}¢ per point: ${num(entry.effectiveReturnPct)}% back.`,
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
  const capLabel = (e: typeof best) =>
    e.cap
      ? `${dollars(e.cap.cap.amount)} ${PERIOD_WORDS[e.cap.cap.period] ?? ''} cap`
      : ''

  if (best.cap && best.rule) {
    const { remaining, cap, period } = best.cap
    if (period === null) {
      warnings.push(
        `Add this card's anniversary (MM-DD) to your wallet so its ${capLabel(best)} can be tracked.`,
      )
    } else if (purchase.amount !== null && purchase.amount > remaining) {
      warnings.push(
        `This purchase crosses the ${capLabel(best)} on "${best.rule.id}": only ${dollars(remaining)} is left for ${period}.`,
      )
    } else if (remaining < cap.amount * NEAR_CAP_SHARE) {
      warnings.push(
        `Only ${dollars(remaining)} left of the ${capLabel(best)} on "${best.rule.id}" for ${period}.`,
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
      `The ${capLabel(nominal)} on "${nominal.rule.id}" is used up for ${nominal.cap.period ?? 'this period'}, so it earns ${earnText(catalog, nominal.cap.cap.then_rate, valuation.currency)} until it resets.`,
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
  for (const rule of evaluation.needsActivation) {
    warnings.push(
      `Activate "${rule.id}" with the issuer to earn ${earnText(catalog, rule.rate, valuation.currency)} here.`,
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
    effectiveReturnPct: entry.effectiveReturnPct,
    earned:
      purchase.amount === null
        ? null
        : Math.round(purchase.amount * entry.effectiveReturnPct) / 100,
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
  const names = tied.map(displayName).join(' and ')
  const verb = tied.length === 1 ? 'earns' : 'earn'
  const why =
    winner.upside - first.upside > EPSILON
      ? 'because its points can be worth more'
      : winner.evaluation.best.cap === null &&
          tied.some((e) => e.evaluation.best.cap !== null)
        ? 'because its rate has no cap'
        : 'by a fixed order; either works'
  return `${names} also ${verb} ${num(winner.effectiveReturnPct)}% here. ${displayName(winner)} wins the tie ${why}.`
}

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
    const wRate = winner.evaluation.best.rate
    const oRate = other.evaluation.best.rate

    if (w.range && wRate > 0) {
      const threshold = other.effectiveReturnPct / wRate
      if (threshold < w.centsPerUnit && threshold >= w.range[0]) {
        consider(
          (w.centsPerUnit - threshold) / w.centsPerUnit,
          `${displayName(other)} beats ${displayName(winner)} here if ${currencyLabel(catalog, w.currency)} points are worth less than ${roundDown(threshold)}¢ (you value them at ${num(w.centsPerUnit)}¢).`,
        )
      }
    }
    if (o.range && oRate > 0) {
      const threshold = winner.effectiveReturnPct / oRate
      if (threshold > o.centsPerUnit && threshold <= o.range[1]) {
        consider(
          (threshold - o.centsPerUnit) / o.centsPerUnit,
          `${displayName(other)} beats ${displayName(winner)} here if ${currencyLabel(catalog, o.currency)} points are worth ${roundUp(threshold)}¢ or more (you value them at ${num(o.centsPerUnit)}¢).`,
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
  } else if (merchant.category === 'other') {
    assumptions.push(
      `Assumes ${merchant.resolvedName} falls outside the usual bonus categories.`,
    )
  } else {
    const category = catalog.categories.find((c) => c.id === merchant.category)
    const mcc =
      merchant.likelyMcc ??
      (category?.mccs.length === 1 ? category.mccs[0] : undefined)
    const code = mcc === undefined ? '' : ` (MCC ${String(mcc)})`
    assumptions.push(
      `Assumes ${merchant.resolvedName} codes as ${categoryPhrase(catalog, merchant.category)}${code}.`,
    )
  }
  if (merchant.inference) {
    assumptions.push(`Claude's reasoning: ${merchant.inference.rationale}`)
  }
  if (purchase.channel === null && merchant.channel === 'in_store') {
    assumptions.push(
      `Assumes an in-store purchase. ${merchant.resolvedName} takes cards differently online.`,
    )
  }
  if (purchase.channel === null && merchant.channel === 'online') {
    assumptions.push(
      'Assumes an online purchase, since you gave a web address.',
    )
  }
  const pointValues = new Map<string, number>()
  for (const e of entries) {
    if (e.valuation.currency !== 'cash')
      pointValues.set(e.valuation.currency, e.valuation.centsPerUnit)
  }
  if (pointValues.size > 0) {
    const list = [...pointValues].map(
      ([id, cents]) => `${currencyLabel(catalog, id)} at ${num(cents)}¢`,
    )
    assumptions.push(`Values points at: ${list.join(', ')}.`)
  }
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
): Recommendation {
  const { entries, excluded } = rankEntries(
    catalog,
    wallet,
    purchase,
    merchant,
    merchant.category,
  )
  const ranked = entries.map((e) => toRanked(catalog, wallet, e, purchase))
  const winner = entries[0]
  const warnings: string[] = []
  const notes: string[] = []

  if (merchant.source === 'none') {
    warnings.push(
      `Couldn't identify "${merchant.input}", so only base rates apply. A more specific name may find a bonus category.`,
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
      const alt = rankEntries(catalog, wallet, purchase, merchant, category)
        .entries[0]
      if (alt && winner && alt.card.id !== winner.card.id) {
        warnings.push(
          `If it codes as ${categoryPhrase(catalog, category)}, ${displayName(alt)} wins (${num(alt.effectiveReturnPct)}%).`,
        )
      }
    }
  }

  if (!winner) {
    warnings.push(`None of your cards work at ${merchant.resolvedName}.`)
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

  const tie = tieNote(entries)
  if (tie) notes.push(tie)

  for (const id of merchant.bookedVia) {
    const via = resolveMerchantById(catalog, id, purchase.channel)
    if (!via || !winner) continue
    const alt = rankEntries(catalog, wallet, purchase, via, via.category)
      .entries[0]
    if (alt && alt.effectiveReturnPct > winner.effectiveReturnPct + EPSILON) {
      notes.push(
        `If you book it as ${via.resolvedName}, ${displayName(alt)} earns ${num(alt.effectiveReturnPct)}%.`,
      )
    }
  }

  const bonus = bonusPick(catalog, wallet, entries, purchase.date)
  const chosen = bonus?.entry ?? winner
  const top = ranked.find((r) => r.cardId === chosen?.card.id)
  const best = ranked[0]
  let bonusResult: Recommendation['bonus'] = null
  if (bonus && top && best) {
    const { status } = bonus
    const remaining = status.remaining ?? 0
    const deadline = status.deadline ?? purchase.date
    const daysLeft = status.daysLeft ?? 0
    const costHere =
      top.cardId === best.cardId || top.earned === null || best.earned === null
        ? null
        : Math.round((best.earned - top.earned) * 100) / 100
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
        ? ` (about ${money(Math.round(remaining / (daysLeft / 7)))} a week)`
        : ''
    const worth =
      status.value === null
        ? ''
        : `, worth about ${money(Math.round(status.value))}`
    notes.unshift(
      `You're working on ${displayName(bonus.entry)}'s welcome bonus: ${money(remaining)} more to spend by ${deadline}${pace}${worth}.${
        top.cardId === best.cardId
          ? ''
          : costHere === null
            ? ` It earns ${num(top.effectiveReturnPct)}% here against ${num(best.effectiveReturnPct)}% on ${displayName(entries[0] ?? bonus.entry)}, which the bonus outweighs.`
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
    sensitivity: bonusResult ? null : sensitivity(catalog, entries),
    bonus: bonusResult,
  }
}

// The open welcome bonus that most needs this purchase: the one with the most
// spend still needed per day left.
function bonusPick(
  catalog: Catalog,
  wallet: Wallet,
  entries: Entry[],
  date: string,
): { entry: Entry; status: BonusStatus } | null {
  let pick: { entry: Entry; status: BonusStatus; pace: number } | null = null
  for (const entry of entries) {
    const status = bonusStatus(catalog, wallet, entry.held, date)
    if (status?.state !== 'open' || date < status.opened) continue
    const pace = (status.remaining ?? 0) / Math.max(1, status.daysLeft ?? 1)
    if (!pick || pace > pick.pace) pick = { entry, status, pace }
  }
  return pick
}
