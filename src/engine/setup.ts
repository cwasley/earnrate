import type { Catalog } from '../data/load.ts'
import type { Card } from '../schema/card.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { pickedCategories } from './evaluate.ts'
import { daysBetween } from './periods.ts'
import { rotationGap } from './rotation.ts'

export type CardChoiceInfo = {
  id: string
  pick: number // how many options the cardholder picks
  period: Card['choices'][number]['period']
  options: string[]
  default: string[] | null
}

export type CardInfo = {
  id: string
  name: string
  issuer: string
  network: Card['network']
  currency: string
  annualFee: number | null
  business: boolean
  onlyAt: string[] | null
  held: boolean
  choices: CardChoiceInfo[]
  memberships: string[] // memberships some of its rules need
  activation: string[] // rules that need activating, current or starting soon
  needsAnniversary: boolean
}

export type CardSearch = {
  cards: CardInfo[]
  exact: boolean // false: nothing matched every word, these are the closest
}

export type SetupNote = {
  kind: 'pick' | 'membership' | 'activation' | 'anniversary' | 'rotation'
  text: string
}

// Rules that start within this many days are worth activating now.
const ACTIVATION_LOOKAHEAD_DAYS = 45

const ISSUER_NICKNAMES: Record<string, string> = {
  amex: 'american express',
  'bank-of-america': 'bofa boa bankofamerica',
  'capital-one': 'capitalone',
  citi: 'citibank',
  usbank: 'us bank',
  'wells-fargo': 'wf wellsfargo',
  'td-bank': 'td',
  column: 'bilt',
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0] ?? 0
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] ?? 0
      row[j] = Math.min(
        above + 1,
        (row[j - 1] ?? 0) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  return row[b.length] ?? 0
}

function matcher(card: Card) {
  const haystack = [
    ...words(card.id),
    ...words(card.name),
    ...words(card.issuer),
    ...words(ISSUER_NICKNAMES[card.issuer] ?? ''),
  ]
  const compact = haystack.join('')
  return (token: string) =>
    haystack.some((w) => w.startsWith(token)) ||
    (token.length >= 4 && compact.includes(token)) ||
    (token.length >= 5 &&
      haystack.some(
        (w) => editDistance(w, token) <= (token.length >= 8 ? 2 : 1),
      ))
}

function needsAnniversary(card: Card): boolean {
  return (
    card.caps.some((c) => c.period === 'cardmember_year') ||
    card.rules.some(
      (r) => typeof r.cap === 'object' && r.cap.period === 'cardmember_year',
    )
  )
}

function activationRules(card: Card, today: string): string[] {
  return card.rules
    .filter(
      (r) =>
        r.requires?.activation === true &&
        (r.valid_to === undefined || r.valid_to >= today) &&
        (r.valid_from === undefined ||
          daysBetween(today, r.valid_from) <= ACTIVATION_LOOKAHEAD_DAYS),
    )
    .map((r) => r.id)
}

export function membershipsUsed(card: Card): string[] {
  return [
    ...new Set(
      card.rules.flatMap((r) =>
        r.requires?.membership === undefined ? [] : [r.requires.membership],
      ),
    ),
  ]
}

export function knownMemberships(catalog: Catalog): string[] {
  return [...new Set(catalog.cards.flatMap(membershipsUsed))].sort()
}

export function cardInfo(
  card: Card,
  wallet: Wallet | null,
  today: string,
): CardInfo {
  return {
    id: card.id,
    name: card.name,
    issuer: card.issuer,
    network: card.network,
    currency: card.currency,
    annualFee: card.annual_fee ?? null,
    business: card.business,
    onlyAt: card.only_at ?? null,
    held: wallet?.cards.some((c) => c.id === card.id) ?? false,
    choices: card.choices.map((c) => ({
      id: c.id,
      pick: c.pick,
      period: c.period,
      options: Object.keys(c.options),
      default: c.default ?? null,
    })),
    memberships: membershipsUsed(card),
    activation: activationRules(card, today),
    needsAnniversary: needsAnniversary(card),
  }
}

// Every word of the query has to match a word of the card's id, name or
// issuer (as a prefix, or with a typo or two in a long word). With no full
// match, the cards matching the most words come back instead.
export function searchCards(
  catalog: Catalog,
  query: string,
  wallet: Wallet | null,
  today: string,
): CardSearch {
  const tokens = words(query)
  const scored = catalog.cards.map((card) => {
    const matches = matcher(card)
    return { card, score: tokens.filter((t) => matches(t)).length }
  })
  const byShortestId = (a: { card: Card }, b: { card: Card }) =>
    words(a.card.id).length - words(b.card.id).length ||
    a.card.id.localeCompare(b.card.id)
  const full = scored.filter((s) => s.score === tokens.length)
  const best = Math.max(0, ...scored.map((s) => s.score))
  const exact = full.length > 0
  const chosen = exact
    ? full.sort(byShortestId)
    : best === 0
      ? []
      : scored
          .filter((s) => s.score === best)
          .sort(byShortestId)
          .slice(0, 5)
  return {
    cards: chosen.map((s) => cardInfo(s.card, wallet, today)),
    exact,
  }
}

const list = (ids: string[]) => ids.join(', ')

// What a card in the wallet still needs before its answers are right.
export function setupNotes(
  catalog: Catalog,
  wallet: Wallet,
  held: WalletCard,
  today: string,
): SetupNote[] {
  const card = catalog.cards.find((c) => c.id === held.id)
  if (!card) return []
  const notes: SetupNote[] = []
  const name = held.checkout_label ?? card.name

  const { picked, staleChoice } = pickedCategories(card, held, today)
  for (const choice of card.choices) {
    const current =
      held.chosen?.picks[choice.id] !== undefined &&
      (staleChoice === null || choice.period === 'until_changed')
    if (current) continue
    const options = list(Object.keys(choice.options))
    notes.push({
      kind: 'pick',
      text:
        choice.default && picked.has(choice.id)
          ? `${name}'s ${choice.id} pick is assumed to be ${list(choice.default)}, the default. Set it if a different one was picked (${String(choice.pick)} of: ${options}).`
          : `${name} needs its ${choice.id} pick for this period (${String(choice.pick)} of: ${options}). Until then those categories earn the base rate.`,
    })
  }

  const missing = membershipsUsed(card).filter(
    (m) => !wallet.memberships.includes(m),
  )
  if (missing.length > 0) {
    notes.push({
      kind: 'membership',
      text: `Some of ${name}'s rates need a membership: ${list(missing)}. Add any that apply to the wallet's memberships.`,
    })
  }

  const toActivate = activationRules(card, today).filter(
    (id) => !held.activated.includes(id),
  )
  if (toActivate.length > 0) {
    notes.push({
      kind: 'activation',
      text: `${name} has rates that apply only once activated with the issuer: ${list(toActivate)}. Mark the ones already activated.`,
    })
  }

  if (needsAnniversary(card) && held.anniversary === undefined) {
    notes.push({
      kind: 'anniversary',
      text: `${name} has a cap that resets on the card's anniversary. Add the anniversary (MM-DD) so it can be tracked.`,
    })
  }

  const gap = rotationGap(card, today)
  if (gap !== null) {
    notes.push({
      kind: 'rotation',
      text: `${name}'s rotating categories for ${gap} aren't in earnrate's data yet. An earnrate update adds them once the issuer announces them.`,
    })
  }
  return notes
}
