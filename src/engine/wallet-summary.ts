import type { Card, Cap, Credit, Rule } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { bonusStatus, type BonusStatus } from './bonus.ts'
import {
  activationGroup,
  capUsed,
  isActivated,
  pickedCategories,
} from './evaluate.ts'
import { introUntil, introWindows, openedOn } from './intro.ts'
import { effectiveMemberships, membershipName } from './memberships.ts'
import { milestoneSummaries, type MilestoneSummary } from './milestones.ts'
import { creditStates, nightStates, usedCreditsYear } from './credits.ts'
import {
  creditWhere,
  optionName,
  ruleParts,
  rulePreposition,
} from './rule-text.ts'
import { choicePeriod, daysBetween, inEffect, periodEnd } from './periods.ts'
import { STALE_AFTER_DAYS } from './recommend.ts'
import { rotationGap } from './rotation.ts'
import { activationRules } from './setup.ts'
import {
  CAP_PERIODS,
  capitalize,
  creditBack,
  creditTerms,
  creditsCountedText,
  creditLeft,
  ENROLL_FIRST,
  choiceName,
  currencyLabel,
  CREDIT_SKIPPED,
  earnText,
  freeNightText,
  freeNightValueText,
  listed,
  PAYMENT_PHRASES,
  shortCardName,
  shortDate,
  wholeDollars,
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
  until: string | null // the period's last day, YYYY-MM-DD
  spent: number
  remaining: number | null
}

export type CreditSummary = {
  id: string // what enrolled and credit_usage call it
  name: string // what it's for: "Lululemon"
  amount: number // dollars each period
  period: Credit['period']
  enroll: boolean // the cardholder must enroll first
  enrolled: boolean // enrolled, or no enrollment needed
  skipped: boolean // the cardholder doesn't use it: counted nowhere
  confirmed: boolean // said in use, so it counts against the annual fee
  currentPeriod: string | null // null for a cardmember year without an anniversary
  until: string | null // the period's last day, YYYY-MM-DD
  used: number
  left: number | null
  tracked: boolean // the wallet has recorded use of it
  text: string // "$75 back each quarter at Lululemon: $35 left this quarter."
}

export type FreeNightSummary = {
  id: string // what enrolled and skipped_credits call it
  name: string
  points: number // the most a night can cost, in the card's currency
  value: number // dollars at the wallet's point value: "up to"
  confirmed: boolean // said in use: counts against the annual fee
  skipped: boolean // the user doesn't use it: not counted anywhere
  text: string
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
  milestones: MilestoneSummary[] // spend milestones and progress toward them
  credits: CreditSummary[] // merchant statement credits and what's left
  freeNights: FreeNightSummary[] // one a year each, after the anniversary
  // The credits and free nights the cardholder uses, a year: what counts
  // against the annual fee, and that in words.
  usedCredits: number
  usedCreditsText: string | null
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
  opened: string | null // YYYY-MM-DD
  // For a card with intro rates: in effect today (through `until`), over, or
  // unknown without an opening date.
  intro: {
    state: 'active' | 'ended' | 'no-date'
    until: string | null
    days: number
  } | null
}

export type WalletSummary = {
  memberships: string[]
  membershipNames: string[]
  // Issuers left out of next-card answers, by id and name.
  skippedIssuers: { id: string; name: string }[]
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

const matchKeys = (rule: Rule) =>
  rule.match.choice !== undefined
    ? []
    : [
        ...(rule.match.categories ?? []).map((c) => `category:${c}`),
        ...(rule.match.merchants ?? []).map((m) => `merchant:${m}`),
      ]

// "first $1,500 a quarter, combined": how much of a rate's spending earns it.
function capLimit(card: Card, shown: Rule[], rule: Rule): string {
  if (rule.cap === undefined) return ''
  const cap =
    typeof rule.cap === 'string'
      ? card.caps.find((c) => c.id === rule.cap)
      : rule.cap
  if (!cap) return ''
  const shared =
    typeof rule.cap === 'string' &&
    shown.filter((r) => r.cap === rule.cap).length > 1
  return `first ${wholeDollars(cap.amount)} ${CAP_PERIODS[cap.period]}${shared ? ', combined' : ''}`
}

// Best first. Leaves out rates behind a membership the wallet lacks and a
// lower tier an uncapped, always-on higher rate fully covers (Prime Visa's 3%
// without Prime, once Prime is held). Rules at the same rate share a line.
export function headlineRates(
  catalog: Catalog,
  wallet: Wallet,
  card: Card,
  held: WalletCard,
  currency: string,
  today: string,
): string[] {
  const has = effectiveMemberships(
    catalog,
    wallet.memberships,
    wallet.cards.map((c) => c.id),
  )
  const shown = card.rules
    .filter(
      (r) =>
        inEffect(r, today) &&
        r.rate > card.base_rate &&
        (r.requires?.membership === undefined ||
          has.includes(r.requires.membership)),
    )
    .sort((a, b) => b.rate - a.rate)
  const lines = new Map<string, Rule[]>()
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
    // A membership tier's higher rate on the same purchases replaces the
    // card's own (BofA Rewards tiers), cap or not.
    const replaced = shown.some(
      (h) =>
        h !== r &&
        h.rate > r.rate &&
        h.requires?.membership !== undefined &&
        r.requires?.membership === undefined &&
        JSON.stringify(h.match) === JSON.stringify(r.match) &&
        JSON.stringify(h.exclude) === JSON.stringify(r.exclude),
    )
    if (replaced) continue
    const pending = r.requires?.activation && !isActivated(card, held, r.id)
    const payment = r.requires?.payment
    const key = [
      earnText(catalog, r.rate, currency),
      capLimit(card, shown, r),
      pending ? ', once activated' : '',
      payment === undefined ? '' : ` ${PAYMENT_PHRASES[payment]}`,
    ].join('|')
    lines.set(key, [...(lines.get(key) ?? []), r])
  }
  return [
    ...[...lines].map(([key, rules]) => {
      const [head = '', limit = '', activate = '', paid = ''] = key.split('|')
      const after = `${limit}${activate}`
      return `${head} ${wherePhrase(catalog, card, rules)}${paid}${after === '' ? '' : ` (${after.replace(/^, /, '')})`}`
    }),
    ...(shown.some(
      (r) =>
        r.match.any &&
        r.geography !== 'foreign_only' &&
        r.requires?.payment === undefined &&
        r.min_amount === undefined &&
        r.rate > card.base_rate,
    )
      ? []
      : [`${earnText(catalog, card.base_rate, currency)} on everything else`]),
  ]
}

export type ActivationDue = {
  what: string // the bonus categories, in words: "grocery stores and restaurants"
  // With each part's own preposition: "at restaurants, and on home utilities"
  where: string
  from: string | null
  to: string | null
  activateBy: string | null
}

// Bonuses current or starting soon that the card hasn't activated, one per
// activation group (one activation covers a quarter's categories).
// "at gas stations and restaurants, and on transit": each rule's parts after
// its own preposition, the "at" ones first.
export function wherePhrase(
  catalog: Catalog,
  card: Card,
  rules: Rule[],
): string {
  const parts = { at: [] as string[], on: [] as string[] }
  for (const r of rules) {
    const list = parts[rulePreposition(catalog, [r])]
    for (const part of ruleParts(catalog, r, card))
      if (!list.includes(part)) list.push(part)
  }
  const { at, on } = parts
  return [
    ...(at.length > 0 ? [`at ${listed(at)}`] : []),
    ...(on.length > 0 ? [`on ${listed(on)}`] : []),
  ].join(at.length > 1 ? ', and ' : ' and ')
}

export function activationsDue(
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  today: string,
): ActivationDue[] {
  const seen = new Set<string>()
  const out: ActivationDue[] = []
  for (const id of activationRules(card, today)) {
    if (seen.has(id) || isActivated(card, held, id)) continue
    const group = activationGroup(card, id)
    for (const g of group) seen.add(g)
    const rules = card.rules.filter((r) => group.includes(r.id))
    const first = rules[0]
    out.push({
      what: listed([
        ...new Set(rules.flatMap((r) => ruleParts(catalog, r, card))),
      ]),
      where: wherePhrase(catalog, card, rules),
      from: first?.valid_from ?? null,
      to: first?.valid_to ?? null,
      activateBy: first?.activate_by ?? null,
    })
  }
  return out
}

function toActivate(
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  today: string,
): string[] {
  return activationsDue(catalog, card, held, today).map((a) => {
    const deadline =
      a.activateBy === null ? '' : `activate by ${shortDate(a.activateBy)}`
    const dates =
      a.from !== null && a.to !== null
        ? `${shortDate(a.from)} to ${shortDate(a.to)}`
        : ''
    const when = [dates, deadline].filter((x) => x !== '').join(', ')
    return `${a.what}${when === '' ? '' : ` (${when})`}`
  })
}

// Picks that carry over have no end date.
function picksUntil(card: Card, key: string): string | null {
  if (card.choices.every((c) => c.period === 'until_changed')) return null
  const period = choicePeriod(card)
  return period === null ? null : periodEnd(period, key, null)
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
      : listed([
          ...new Set(covered.flatMap((r) => ruleParts(catalog, r, card))),
        ]) || words(key)
    return {
      key,
      label,
      rules,
      amount: cap.amount,
      period: cap.period,
      currentPeriod,
      until:
        currentPeriod === null
          ? null
          : periodEnd(cap.period, currentPeriod, held.anniversary ?? null),
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
      milestones: milestoneSummaries(card, held, today),
      credits: creditSummaries(catalog, card, held, today),
      freeNights: nightSummaries(catalog, wallet, card, held),
      ...usedCredits(catalog, wallet, card, held, today),
      chosen: held.chosen
        ? {
            period: held.chosen.period,
            current: pickedCategories(card, held, today).staleChoice === null,
            // Picks that carry over have no end date.
            until: picksUntil(card, held.chosen.period),
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
      opened: openedOn(held),
      intro: introSummary(card, held, today),
    })
  }
  return {
    memberships: wallet.memberships,
    membershipNames: wallet.memberships.map((m) => membershipName(catalog, m)),
    skippedIssuers: (wallet.skipped_issuers ?? []).map((id) => ({
      id,
      name: catalog.issuers.find((i) => i.id === id)?.name ?? id,
    })),
    pointValues: pointValues(catalog, wallet),
    started: null,
    cards,
  }
}

function usedCredits(
  catalog: Catalog,
  wallet: Wallet,
  card: Card,
  held: WalletCard,
  today: string,
): Pick<CardSummary, 'usedCredits' | 'usedCreditsText'> {
  const used = usedCreditsYear(catalog, card, held, today, wallet.valuations)
  return {
    usedCredits: used.yearly,
    usedCreditsText:
      used.creditIds.length === 0
        ? null
        : creditsCountedText(
            shortCardName(card.name),
            card.annual_fee ?? 0,
            used,
          ),
  }
}

function nightSummaries(
  catalog: Catalog,
  wallet: Wallet,
  card: Card,
  held: WalletCard,
): FreeNightSummary[] {
  const { centsPerUnit } = currencyValuation(catalog, wallet, card.currency)
  return nightStates(catalog, wallet.valuations, card, held).map((n) => {
    const status = n.skipped
      ? CREDIT_SKIPPED
      : n.confirmed
        ? 'you use it, so it counts against the annual fee'
        : 'not counted against the annual fee until you say you use it'
    return {
      id: n.night.id,
      name: n.name,
      points: n.points,
      value: n.value,
      confirmed: n.confirmed,
      skipped: n.skipped,
      text: `${capitalize(freeNightText(n.points, currencyLabel(catalog, card.currency)))} (${freeNightValueText(n.value, centsPerUnit)}): ${status}.`,
    }
  })
}

function creditSummaries(
  catalog: Catalog,
  card: Card,
  held: WalletCard,
  today: string,
): CreditSummary[] {
  return creditStates(catalog, card, held, today).map((s) => {
    const status = s.skipped
      ? CREDIT_SKIPPED
      : !s.enrolled
        ? `${ENROLL_FIRST}, then mark it enrolled`
        : s.left === null
          ? "give the card's anniversary to track it"
          : `${creditLeft(s.left, s.period)}${s.until === null ? '' : `, through ${shortDate(s.until)}`}`
    return {
      id: s.credit.id,
      name: s.name,
      amount: s.amount,
      period: s.period,
      enroll: s.credit.enroll === true,
      enrolled: s.enrolled,
      skipped: s.skipped,
      confirmed: s.confirmed,
      currentPeriod: s.key,
      until: s.until,
      used: s.used,
      left: s.left,
      tracked: held.credit_usage?.[s.credit.id] !== undefined,
      text: `${creditBack(s)} ${creditWhere(catalog, s.credit)}${creditTerms(s.credit)}: ${status}.`,
    }
  })
}

function introSummary(
  card: Card,
  held: WalletCard,
  today: string,
): CardSummary['intro'] {
  const [first] = card.intro_rates
  if (!first) return null
  const opened = openedOn(held)
  if (opened === null)
    return { state: 'no-date', until: null, days: first.days }
  const [active] = introWindows(card, held, today)
  if (active)
    return { state: 'active', until: active.until, days: active.intro.days }
  return { state: 'ended', until: introUntil(first, opened), days: first.days }
}

function pointValues(
  catalog: Catalog,
  wallet: Wallet,
): WalletSummary['pointValues'] {
  return Object.keys(wallet.valuations)
    .filter((id) => catalog.currencies.some((c) => c.id === id))
    .map((id) => ({
      currency: id,
      name: currencyLabel(catalog, id),
      centsPerUnit: currencyValuation(catalog, wallet, id).centsPerUnit,
      redemption: redemptionOf(catalog, id, wallet.valuations[id]),
    }))
}

// The memberships and point values a wallet holds besides its cards, in
// words: what replacing or deleting it would lose.
export function savedSettingsText(catalog: Catalog, wallet: Wallet): string[] {
  return [
    ...wallet.memberships.map((m) => membershipName(catalog, m)),
    ...pointValues(catalog, wallet).map((v) =>
      v.redemption === null
        ? `${v.name} at ${String(v.centsPerUnit)}¢`
        : `${v.name} redeemed ${v.redemption}`,
    ),
  ]
}
