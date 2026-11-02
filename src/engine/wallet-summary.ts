import { findMerchant } from '../merchants/resolve.ts'
import type { Card, Cap, Rule } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { bonusStatus, type BonusStatus } from './bonus.ts'
import {
  activationGroup,
  capUsed,
  isActivated,
  pickedCategories,
} from './evaluate.ts'
import { daysBetween, inEffect, periodEnd } from './periods.ts'
import { STALE_AFTER_DAYS } from './recommend.ts'
import { rotationGap } from './rotation.ts'
import { activationRules } from './setup.ts'
import {
  categoryPhrase,
  choiceName,
  currencyLabel,
  earnText,
  listed,
  shortDate,
  words,
} from './text.ts'
import { cardValuation, currencyValuation } from './valuation.ts'

export type CapSummary = {
  key: string // what cap_usage and record_purchase call it
  label: string // what it covers, in words
  rules: string[] // the rules that spend against it
  amount: number
  period: Cap['period']
  currentPeriod: string | null // null for a cardmember-year cap without an anniversary
  spent: number
  remaining: number | null
}

export type CardSummary = {
  cardId: string
  cardName: string
  checkoutLabel: string | null
  issuer: string
  network: Card['network']
  onlyAt: string[] | null // merchant ids, for a store card
  bonus: BonusStatus | null
  currency: string // after pooling
  currencyName: string
  centsPerUnit: number
  lastVerified: string
  verifiedBy: string
  dataIsStale: boolean
  rotationGap: string | null // a rotating card's current period, when its categories aren't in the data
  caps: CapSummary[]
  chosen: {
    period: string
    current: boolean
    until: string | null // the period's last day, YYYY-MM-DD
    picks: Record<string, string[]>
    pickNames: Record<string, string[]> // the same picks, in words
  } | null
  rates: string[] // the card's best rates right now, in words
  activated: string[]
  toActivate: string[] // bonuses current or starting soon, not yet activated, in words
  anniversary: string | null
}

export type WalletSummary = {
  memberships: string[]
  // Point values the user set, in place of earnrate's defaults.
  // Point values the wallet sets: a number, or a way of redeeming (like
  // SoFi points into a SoFi account), which `redemption` names.
  pointValues: {
    currency: string
    name: string
    centsPerUnit: number
    redemption: string | null
  }[]
  started: string | null // ISO time, for a hosted wallet
  cards: CardSummary[]
}

// Travel-site bookings ("Flight through Amex Travel") read mid-sentence in
// lower case and plural; brand names ("Airbnb through Amex Travel") keep theirs.
const BOOKING = /^(Attraction|Car rental|Cruise|Flight|Hotel|Vacation rental)\b/

function merchantName(catalog: Catalog, id: string): string {
  const merchant = findMerchant(catalog, id)
  const name = merchant?.name ?? words(id)
  return merchant?.kind === 'booking'
    ? name.replace(BOOKING, (kind) => `${kind.toLowerCase()}s`)
    : name
}

export function optionName(
  catalog: Catalog,
  card: Card,
  choiceId: string,
  option: string,
): string {
  const o = card.choices.find((c) => c.id === choiceId)?.options[option]
  if (!o) return words(option)
  const parts = [
    ...o.categories.map((c) => categoryPhrase(catalog, c)),
    ...o.merchants.map((m) => merchantName(catalog, m)),
  ]
  if (o.online) parts.push('online shopping')
  return parts.length > 0 ? listed(parts) : words(option)
}

// What a rule covers, as a list of phrases.
function ruleParts(catalog: Catalog, rule: Rule): string[] {
  if (rule.match.choice !== undefined)
    return [`your ${choiceName(rule.match.choice)} picks`]
  const parts = [
    ...(rule.match.categories ?? []).map((c) => categoryPhrase(catalog, c)),
    ...(rule.match.merchants ?? []).map((m) => merchantName(catalog, m)),
  ]
  return parts.length > 0 ? parts : [words(rule.id)]
}

function ruleWhat(catalog: Catalog, rule: Rule): string {
  return listed(ruleParts(catalog, rule))
}

const matchKeys = (rule: Rule) =>
  rule.match.choice !== undefined
    ? []
    : [
        ...(rule.match.categories ?? []).map((c) => `category:${c}`),
        ...(rule.match.merchants ?? []).map((m) => `merchant:${m}`),
      ]

// Every bonus rate the cardholder gets now, best first, so none reads as the
// base rate. Rates behind a membership the wallet lacks are left out, and so
// is a lower tier that an uncapped, always-on higher rate fully covers (Prime
// Visa's 3% without Prime, once Prime is held). Rules at the same rate share
// a line.
function headlineRates(
  catalog: Catalog,
  wallet: Wallet,
  card: Card,
  held: WalletCard,
  currency: string,
  today: string,
): string[] {
  const shown = card.rules
    .filter(
      (r) =>
        inEffect(r, today) &&
        r.rate > card.base_rate &&
        (r.requires?.membership === undefined ||
          wallet.memberships.includes(r.requires.membership)),
    )
    .sort((a, b) => b.rate - a.rate)
  const lines = new Map<string, string[]>()
  for (const r of shown) {
    const keys = matchKeys(r)
    const higher = shown
      .filter(
        (h) =>
          h.rate > r.rate &&
          h.cap === undefined &&
          (!h.requires?.activation || isActivated(card, held, h.id)),
      )
      .flatMap(matchKeys)
    if (keys.length > 0 && keys.every((k) => higher.includes(k))) continue
    const pending = r.requires?.activation && !isActivated(card, held, r.id)
    const head = `${earnText(catalog, r.rate, currency)} on`
    const key = pending ? `${head}|activate` : head
    const whats = lines.get(key) ?? []
    for (const part of ruleParts(catalog, r))
      if (!whats.includes(part)) whats.push(part)
    lines.set(key, whats)
  }
  return [
    ...[...lines].map(
      ([key, whats]) =>
        `${key.replace('|activate', '')} ${listed(whats)}${key.endsWith('|activate') ? ' (once activated)' : ''}`,
    ),
    `${earnText(catalog, card.base_rate, currency)} on everything else`,
  ]
}

function toActivate(
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  today: string,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of activationRules(card, today)) {
    if (seen.has(id) || isActivated(card, held, id)) continue
    const group = activationGroup(card, id)
    for (const g of group) seen.add(g)
    const rules = card.rules.filter((r) => group.includes(r.id))
    const first = rules[0]
    const when =
      first?.valid_from !== undefined && first.valid_to !== undefined
        ? ` (${shortDate(first.valid_from)} to ${shortDate(first.valid_to)})`
        : ''
    out.push(`${rules.map((r) => ruleWhat(catalog, r)).join(', ')}${when}`)
  }
  return out
}

function capSummaries(
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  today: string,
): CapSummary[] {
  const caps = new Map<string, { cap: Cap; rules: string[] }>()
  for (const shared of card.caps)
    caps.set(shared.id, { cap: shared, rules: [] })
  for (const rule of card.rules) {
    if (rule.cap === undefined) continue
    if (typeof rule.cap === 'string') {
      caps.get(rule.cap)?.rules.push(rule.id)
    } else {
      caps.set(rule.id, { cap: rule.cap, rules: [rule.id] })
    }
  }
  return [...caps].map(([key, { cap, rules }]) => {
    const { period: currentPeriod, spent } = capUsed(cap, key, held, today)
    const covered = card.rules.filter((r) => rules.includes(r.id))
    const shared = card.caps.find((c) => c.id === key)
    const label = shared?.rotating
      ? 'the rotating bonus categories'
      : [...new Set(covered.map((r) => ruleWhat(catalog, r)))].join(', ') ||
        words(key)
    return {
      key,
      label,
      rules,
      amount: cap.amount,
      period: cap.period,
      currentPeriod,
      spent,
      remaining:
        currentPeriod === null ? null : Math.max(0, cap.amount - spent),
    }
  })
}

// "into a SoFi account", for a wallet that values points by a redemption.
function redemptionOf(
  catalog: Catalog,
  currency: string,
  v: Wallet['valuations'][string] | undefined,
): string | null {
  if (typeof v !== 'object' || v.redemption === undefined) return null
  const names = catalog.currencies.find(
    (c) => c.id === currency,
  )?.redemption_names
  return names?.[v.redemption] ?? `as ${words(v.redemption)}`
}

export function walletSummary(
  catalog: Catalog,
  wallet: Wallet,
  today: string,
): WalletSummary {
  const cards: CardSummary[] = []
  for (const held of wallet.cards) {
    const card = catalog.cards.find((c) => c.id === held.id)
    if (!card) continue
    const valuation = cardValuation(catalog, wallet, card)
    cards.push({
      cardId: card.id,
      cardName: card.name,
      checkoutLabel: held.checkout_label ?? null,
      issuer: card.issuer,
      network: card.network,
      onlyAt: card.only_at ?? null,
      bonus: bonusStatus(catalog, wallet, held, today),
      currency: valuation.currency,
      currencyName:
        valuation.currency === 'cash'
          ? 'cash back'
          : currencyLabel(catalog, valuation.currency),
      centsPerUnit: valuation.centsPerUnit,
      lastVerified: card.last_verified,
      verifiedBy: card.verified_by,
      dataIsStale: daysBetween(card.last_verified, today) > STALE_AFTER_DAYS,
      rotationGap: rotationGap(card, today),
      caps: capSummaries(catalog, card, held, today),
      chosen: held.chosen
        ? {
            period: held.chosen.period,
            current: pickedCategories(card, held, today).staleChoice === null,
            // Picks that carry over have no end date.
            until: card.choices.every((c) => c.period === 'until_changed')
              ? null
              : periodEnd(held.chosen.period),
            picks: held.chosen.picks,
            pickNames: Object.fromEntries(
              Object.entries(held.chosen.picks).map(([choice, options]) => [
                choiceName(choice),
                options.map((o) => optionName(catalog, card, choice, o)),
              ]),
            ),
          }
        : null,
      rates: headlineRates(
        catalog,
        wallet,
        card,
        held,
        valuation.currency,
        today,
      ),
      activated: held.activated,
      toActivate: toActivate(catalog, card, held, today),
      anniversary: held.anniversary ?? null,
    })
  }
  const pointValues = Object.keys(wallet.valuations)
    .filter((id) => catalog.currencies.some((c) => c.id === id))
    .map((id) => ({
      currency: id,
      name: currencyLabel(catalog, id),
      centsPerUnit: currencyValuation(catalog, wallet, id).centsPerUnit,
      redemption: redemptionOf(catalog, id, wallet.valuations[id]),
    }))
  return { memberships: wallet.memberships, pointValues, started: null, cards }
}
