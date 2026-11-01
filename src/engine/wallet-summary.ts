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
import { daysBetween } from './periods.ts'
import { STALE_AFTER_DAYS } from './recommend.ts'
import { rotationGap } from './rotation.ts'
import { activationRules } from './setup.ts'
import { categoryPhrase, earnText, words } from './text.ts'
import { cardValuation } from './valuation.ts'

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
  cards: CardSummary[]
}

const NUMBERS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
}

// "five-percent" reads "5%"; other ids read as words.
export function choiceName(id: string): string {
  return words(
    id.replace(
      /\b(one|two|three|four|five|six)-percent\b/g,
      (_, n: string) => `${NUMBERS[n] ?? n}%`,
    ),
  )
}

const listed = (parts: string[]) =>
  parts.length <= 2
    ? parts.join(' and ')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`

function merchantName(catalog: Catalog, id: string): string {
  const all = [...catalog.merchants.overrides, ...catalog.merchants.seed]
  return all.find((m) => m.id === id)?.name ?? words(id)
}

function optionName(
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

function ruleWhat(catalog: Catalog, rule: Rule): string {
  if (rule.match.choice !== undefined)
    return `your ${choiceName(rule.match.choice)} picks`
  const parts = [
    ...(rule.match.categories ?? []).map((c) => categoryPhrase(catalog, c)),
    ...(rule.match.merchants ?? []).map((m) => merchantName(catalog, m)),
  ]
  return parts.length > 0 ? listed(parts) : words(rule.id)
}

function periodEnd(period: string): string | null {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period)
  if (quarter) {
    const end = ['03-31', '06-30', '09-30', '12-31'][Number(quarter[2]) - 1]
    return `${quarter[1] ?? ''}-${end ?? ''}`
  }
  const month = /^(\d{4})-(\d{2})$/.exec(period)
  if (month) {
    const last = new Date(Date.UTC(Number(month[1]), Number(month[2]), 0))
    return last.toISOString().slice(0, 10)
  }
  return /^\d{4}$/.test(period) ? `${period}-12-31` : null
}

const applies = (rule: Rule, today: string) =>
  (rule.valid_from === undefined || rule.valid_from <= today) &&
  (rule.valid_to === undefined || rule.valid_to >= today)

// Every bonus rate the cardholder gets now, best first, so none reads as the
// base rate. Rates behind a membership the wallet lacks are left out.
function headlineRates(
  catalog: Catalog,
  wallet: Wallet,
  card: Card,
  held: WalletCard,
  currency: string,
  today: string,
): string[] {
  const lines = card.rules
    .filter(
      (r) =>
        applies(r, today) &&
        r.rate > card.base_rate &&
        (r.requires?.membership === undefined ||
          wallet.memberships.includes(r.requires.membership)),
    )
    .sort((a, b) => b.rate - a.rate)
    .map(
      (r) =>
        `${earnText(catalog, r.rate, currency)} on ${ruleWhat(catalog, r)}${r.requires?.activation && !isActivated(card, held, r.id) ? ' (once activated)' : ''}`,
    )
  return [
    ...new Set(lines),
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
        ? ` (${first.valid_from} to ${first.valid_to})`
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
  return { memberships: wallet.memberships, cards }
}
