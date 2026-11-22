// A saved card's settings and its row in My wallet, in the words
// earnrate.dev and the iPhone app both show. Node-free.
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { bonusStatus } from './bonus.ts'
import type { CreditChoice, CreditState, NightState } from './credits.ts'
import { activationGroup } from './evaluate.ts'
import { milestoneSummaries } from './milestones.ts'
import { offerTerms } from './offers.ts'
import { inEffect } from './periods.ts'
import type { MonthAsk } from './repeat-bonus.ts'
import { ruleWhat } from './rule-text.ts'
import type { CardChoiceInfo } from './setup.ts'
import {
  capitalize,
  choiceName,
  creditBack,
  creditTerms,
  currencyLabel,
  currencyName,
  freeNightText,
  freeNightValueText,
  LISTED_CREDIT_USED,
  listed,
  shortDate,
  wholeDollars,
  words,
} from './text.ts'

// "Grocery stores and American Red Cross, Oct 1 to Dec 31": an activation
// in the engine's words, with its dates. One activation can turn on several
// rules (a Freedom Flex quarter), so the label names every rule in its group.
export function activationLabel(
  catalog: Catalog,
  card: Card,
  ruleId: string,
): string {
  const rule = card.rules.find((r) => r.id === ruleId)
  if (!rule) return words(ruleId)
  const what = capitalize(
    listed(
      activationGroup(card, ruleId).flatMap((id) => {
        const r = card.rules.find((x) => x.id === id)
        return r ? [ruleWhat(catalog, r, card)] : []
      }),
    ),
  )
  return rule.valid_from !== undefined && rule.valid_to !== undefined
    ? `${what}, ${shortDate(rule.valid_from).replace(/, \d{4}$/, '')} to ${shortDate(rule.valid_to)}`
    : what
}

// When an activation the issuer hasn't opened yet opens: "Dec 15".
export const opensOn = (date: string) => shortDate(date).replace(/, \d{4}$/, '')

// "Bonus categories: the 2 you expect to spend the most in, this quarter".
// A choice already named for its category ("top category") isn't followed
// by "category" again.
export function pickLegend(choice: CardChoiceInfo): string {
  const one = choice.pick === 1
  const name = choiceName(choice.id)
  return `${capitalize(
    / categor(y|ies)$/.test(name)
      ? name
      : `${name} ${one ? 'category' : 'categories'}`,
  )}${
    choice.automatic
      ? `: the ${one ? 'one' : String(choice.pick)} you expect to spend the most in`
      : ''
  }${choice.period === 'quarter' ? ', this quarter' : ''}`
}

export const pickedCount = (picked: number, pick: number) =>
  `${String(picked)} of ${String(pick)} picked`

export function anniversaryLabel(needsAnniversary: boolean, fee: boolean) {
  return needsAnniversary && fee
    ? 'Account anniversary, when its fee posts and its yearly cap resets'
    : needsAnniversary
      ? 'Account anniversary, when its yearly cap resets'
      : 'When its annual fee posts, so earnrate can check it still pays for itself first'
}

export function offerLine(catalog: Catalog, card: Card, today: string): string {
  const o = card.welcome_offer
  if (!o || !inEffect(o, today)) return ''
  return `Published offer: ${offerTerms(o, currencyName(catalog, card.currency))}.`
}

// "Welcome bonus: $1,200 of $4,000 · 41 days left"
export function bonusLine(
  catalog: Catalog,
  wallet: Wallet,
  held: WalletCard,
  today: string,
): string | null {
  const status = bonusStatus(catalog, wallet, held, today)
  if (!status) return null
  if (status.state === 'met') return 'Welcome bonus: met'
  if (status.state === 'expired') return 'Welcome bonus: deadline passed'
  if (status.spend === null) return 'Welcome bonus: tracking'
  const days =
    status.daysLeft === null ? '' : ` · ${String(status.daysLeft)} days left`
  return `Welcome bonus: ${wholeDollars(status.spent)} of ${wholeDollars(status.spend)}${days}`
}

// The next spend milestone still ahead this period, or the last one reached.
export function milestoneLine(
  card: Card,
  held: WalletCard,
  today: string,
): string | null {
  const tracked = milestoneSummaries(card, held, today).filter((m) => m.tracked)
  const next = tracked.find((m) => m.spent < m.spend) ?? tracked.at(-1)
  if (!next) return null
  return next.spent >= next.spend
    ? `Spend bonus: ${wholeDollars(next.spend)} reached`
    : `Spend bonus: ${wholeDollars(next.spent)} of ${wholeDollars(next.spend)}`
}

export const RENEWAL_ASK = 'Add its renewal date'

// A credit under Credit details: "$10 back each month at Dunkin'; this one
// runs through Nov 30."
export function creditDetailText(c: CreditState): string {
  return `${capitalize(creditBack(c))}${creditTerms(
    c.credit.min_amount === undefined
      ? {}
      : { min_amount: c.credit.min_amount },
  )}${c.until === null ? '' : `; this one runs through ${shortDate(c.until)}`}.${
    c.credit.valid_to === undefined
      ? ''
      : ` It ends after ${shortDate(c.credit.valid_to)}.`
  }${c.credit.note ? ` ${c.credit.note}` : ''}${
    c.credit.listed ? ` ${LISTED_CREDIT_USED}.` : ''
  }`
}

// What a free night counts at, under Credit details: "An anniversary free
// night each year, up to 40,000 IHG One Rewards points: up to $200 at 0.5¢ a
// point."
export function nightDetailText(
  catalog: Catalog,
  card: Card,
  n: NightState,
  centsPerUnit: number,
): string {
  return `${capitalize(
    freeNightText(n.points, currencyLabel(catalog, card.currency)),
  )}${
    n.value === null
      ? ". It counts against the annual fee once you say what it's worth to you."
      : `: ${freeNightValueText(n.value, centsPerUnit)}.`
  }`
}

// A credit tile's worth: "$120/yr", or "up to $250" for a free night.
export const creditWorth = (c: CreditChoice) =>
  c.yearly === null
    ? null
    : c.night
      ? `up to ${wholeDollars(c.yearly)}`
      : `${wholeDollars(c.yearly)}/yr`

export const PAST_CARDS_LEAD =
  "Issuers limit who can earn a card's welcome bonus again. Add cards you've closed, and next-card answers say when you can."

export const TRANSFER_POINTS_ASK = 'I transfer points to airlines and hotels'
export const POINT_VALUE_RANGE = 'From 0.1¢ to 5¢ a point.'
export const cents = (n: number) => `${String(n)}¢`

// The months Cards you've had asks for, by the field they fill.
export const PAST_MONTH_LABELS: Record<MonthAsk['field'], string> = {
  bonus_received: 'Bonus posted',
  opened: 'Opened',
  closed: 'Closed',
}

// "Amex Gold: bonus posted", beside a note that asks for that month.
export const monthAskLabel = (name: string, field: MonthAsk['field']) =>
  `${name}: ${PAST_MONTH_LABELS[field].toLowerCase()}`
