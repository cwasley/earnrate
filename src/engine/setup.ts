import type { Card, Credit, Milestone } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { isActivated, pickedCategories } from './evaluate.ts'
import {
  effectiveMemberships,
  membership,
  membershipName,
  sameGroup,
} from './memberships.ts'
import { milestoneStarts, milestoneWhat } from './milestones.ts'
import { daysBetween } from './periods.ts'
import { rotationGap, rotationGapText } from './rotation.ts'
import { currencyValuation } from './valuation.ts'
import { creditName, creditWhere, introWhat } from './rule-text.ts'
import { nightStates } from './credits.ts'
import {
  choicePhrase,
  creditBack,
  creditTerms,
  currencyLabel,
  ENROLL_FIRST,
  LISTED_CREDIT,
  freeNightText,
  idList,
  NIGHT_NO_CAP,
  NIGHT_UNVALUED_SHORT,
  nightWorthText,
  listed,
  possessive,
} from './text.ts'

export type CardChoiceInfo = {
  id: string
  pick: number // how many options the cardholder picks
  period: Card['choices'][number]['period']
  automatic: boolean // the issuer applies it to the most-spent options
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
  firstYearFee: number | null // when it differs from annualFee
  foreignTransactionFee: number | null // percent; 0 when none, null when unknown
  business: boolean
  onlyAt: string[] | null
  ratesNote: string | null // how its rates are counted, when it needs saying
  held: boolean
  choices: CardChoiceInfo[]
  memberships: string[] // memberships some of its rules need
  // A paid membership the card itself needs (Costco Anywhere).
  requiresMembership: { id: string; name: string; annualFee: number } | null
  activation: string[] // rules that need activating, current or starting soon
  activationOpens: Record<string, string> // of those, ones the issuer opens later
  needsAnniversary: boolean
  // Spend milestones: "$15,000 calendar-year spend for 10,000 bonus points".
  milestones: {
    id: string
    spend: number
    period: Milestone['period']
    points: number | null
    rewards: string[]
    text: string
  }[]
  // Rates for a stretch after opening, which need the opening date.
  introRates: { id: string; days: number; text: string }[]
  // Statement credits: "$75 back each quarter at Lululemon".
  credits: {
    id: string
    name: string
    amount: number
    period: Credit['period']
    enroll: boolean
    listed: boolean // never counted toward a purchase
    text: string
  }[]
  // One a year each, after the account anniversary: "an anniversary free
  // night each year, up to 50,000 IHG One Rewards points (up to $250 at
  // 0.5¢ a point)". Marked used or not like a credit, by id.
  freeNights: {
    id: string
    points: number | null // in the card's currency; null without a cap
    value: number | null // dollars at the wallet's point value, "up to"
    ownValue: number | null // what the user says it's worth, on a card they hold
    text: string
  }[]
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

const searchWords = (s: string) =>
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

function matcher(catalog: Catalog, card: Card) {
  const haystack = [
    ...searchWords(card.id),
    ...searchWords(card.name),
    ...searchWords(card.issuer),
    ...(
      catalog.issuers.find((i) => i.id === card.issuer)?.search ?? []
    ).flatMap(searchWords),
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

export function needsAnniversary(card: Card): boolean {
  return (
    card.caps.some((c) => c.period === 'cardmember_year') ||
    card.rules.some(
      (r) => typeof r.cap === 'object' && r.cap.period === 'cardmember_year',
    ) ||
    card.milestones.some((m) => m.period === 'cardmember_year')
  )
}

export function activationRules(card: Card, today: string): string[] {
  return card.rules
    .filter(
      (r) =>
        r.requires?.activation === true &&
        (r.valid_to === undefined || r.valid_to >= today) &&
        (r.activate_by === undefined || r.activate_by >= today) &&
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

// Memberships that matter to a card: ones its rates need, and one the card
// itself needs (a Costco membership for Costco Anywhere).
export function membershipsFor(card: Card): string[] {
  return [
    ...membershipsUsed(card),
    ...(card.requires_membership ? [card.requires_membership] : []),
  ]
}

export function knownMemberships(catalog: Catalog): string[] {
  return catalog.memberships.map((m) => m.id).sort()
}

export function cardInfo(
  catalog: Catalog,
  card: Card,
  wallet: Wallet | null,
  today: string,
): CardInfo {
  const heldCard = wallet?.cards.find((c) => c.id === card.id) ?? null
  return {
    id: card.id,
    name: card.name,
    issuer: card.issuer,
    network: card.network,
    currency: card.currency,
    annualFee: card.annual_fee ?? null,
    firstYearFee:
      card.first_year_fee !== undefined &&
      card.first_year_fee !== card.annual_fee
        ? card.first_year_fee
        : null,
    foreignTransactionFee: card.foreign_transaction_fee,
    business: card.business,
    onlyAt: card.only_at ?? null,
    ratesNote: card.rates_note ?? null,
    held: wallet?.cards.some((c) => c.id === card.id) ?? false,
    choices: card.choices.map((c) => ({
      id: c.id,
      pick: c.pick,
      period: c.period,
      automatic: c.automatic === true,
      options: Object.keys(c.options),
      default: c.default ?? null,
    })),
    memberships: membershipsUsed(card),
    requiresMembership:
      card.requires_membership === undefined
        ? null
        : {
            id: card.requires_membership,
            name: membershipName(catalog, card.requires_membership),
            annualFee:
              membership(catalog, card.requires_membership)?.annual_fee ?? 0,
          },
    activation: activationRules(card, today),
    activationOpens: Object.fromEntries(
      card.rules.flatMap((r) =>
        r.activate_from !== undefined &&
        r.activate_from > today &&
        activationRules(card, today).includes(r.id)
          ? [[r.id, r.activate_from]]
          : [],
      ),
    ),
    needsAnniversary: needsAnniversary(card),
    milestones: card.milestones.map((m) => ({
      id: m.id,
      spend: m.spend,
      period: m.period,
      points: m.points ?? null,
      rewards: m.rewards ?? [],
      text: `${milestoneWhat(m).replace(/^the /, '')}${milestoneStarts(m, today)}`,
    })),
    introRates: card.intro_rates.map((i) => ({
      id: i.id,
      days: i.days,
      text: introWhat(catalog, card, i),
    })),
    credits: card.credits.map((c) => {
      const name = creditName(catalog, c)
      return {
        id: c.id,
        name,
        amount: c.amount,
        period: c.period,
        enroll: c.enroll === true,
        listed: c.listed !== undefined,
        text: `${creditBack(c)} ${creditWhere(catalog, c)}${creditTerms(c)}${c.enroll ? `, ${ENROLL_FIRST}` : ''}${c.listed ? `; ${LISTED_CREDIT}` : ''}`,
      }
    }),
    freeNights: nightStates(
      catalog,
      wallet?.valuations ?? {},
      card,
      heldCard,
    ).map((n) => {
      const { centsPerUnit } = currencyValuation(
        catalog,
        { valuations: wallet?.valuations ?? {} },
        card.currency,
      )
      return {
        id: n.night.id,
        points: n.points,
        value: n.value,
        ownValue: n.own,
        text: `${freeNightText(n.points, currencyLabel(catalog, card.currency))} (${nightWorthText(n, centsPerUnit) ?? (heldCard ? NIGHT_UNVALUED_SHORT : NIGHT_NO_CAP)})`,
      }
    }),
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
  // An exact id or name is that card alone, even when its words also
  // match its sibling cards ("IHG One Rewards" is in all four IHG names).
  const named = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  const asked = named(query)
  const one = catalog.cards.filter(
    (c) =>
      named(c.id) === asked ||
      named(c.name) === asked ||
      named(c.name).replace(/ (credit )?card$/, '') === asked ||
      (c.short_name !== undefined && named(c.short_name) === asked),
  )
  if (one.length === 1)
    return {
      cards: one.map((c) => cardInfo(catalog, c, wallet, today)),
      exact: true,
    }
  // A "+" searching drops ("cash+") narrows to the names that have it.
  const literal = query.trim().toLowerCase()
  if (literal.includes('+') && literal.replace(/[^a-z0-9]/g, '') !== '') {
    const named = catalog.cards.filter((c) =>
      [c.name, c.short_name ?? ''].some((n) =>
        n.toLowerCase().includes(literal),
      ),
    )
    if (named.length > 0)
      return {
        cards: named.map((c) => cardInfo(catalog, c, wallet, today)),
        exact: true,
      }
  }
  const tokens = searchWords(query)
  const scored = catalog.cards.map((card) => {
    const matches = matcher(catalog, card)
    return { card, score: tokens.filter((t) => matches(t)).length }
  })
  const byShortestId = (a: { card: Card }, b: { card: Card }) =>
    searchWords(a.card.id).length - searchWords(b.card.id).length ||
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
    cards: chosen.map((s) => cardInfo(catalog, s.card, wallet, today)),
    exact,
  }
}

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
    const options = idList(Object.keys(choice.options))
    notes.push({
      kind: 'pick',
      text:
        choice.default && picked.has(choice.id)
          ? `${possessive(name)} ${choice.id} pick is assumed to be ${idList(choice.default)}, the default. Set it if ${choice.automatic ? 'you expect a different one to have the most spending' : 'a different one was picked'} (${String(choice.pick)} of: ${options}).`
          : choice.automatic
            ? `${name} applies its bonus to ${choicePhrase(choice)}; set its ${choice.id} pick to the one you expect (${String(choice.pick)} of: ${options}). Until then those categories earn the base rate.`
            : `${name} needs its ${choice.id} pick for this period (${String(choice.pick)} of: ${options}). Until then those categories earn the base rate.`,
    })
  }

  // With one tier of a group saved, the others aren't missing.
  const has = effectiveMemberships(
    catalog,
    wallet.memberships,
    wallet.cards.map((c) => c.id),
  )
  const missing = membershipsUsed(card).filter(
    (m) => !has.some((held) => held === m || sameGroup(catalog, held, m)),
  )
  if (missing.length > 0) {
    notes.push({
      kind: 'membership',
      text: `Some of ${possessive(name)} rates need ${listed(
        missing.map((m) => `${membershipName(catalog, m)} (${m})`),
        'or',
      )}; they're counted without it.`,
    })
  }

  const toActivate = activationRules(card, today).filter(
    (id) => !isActivated(card, held, id),
  )
  if (toActivate.length > 0) {
    notes.push({
      kind: 'activation',
      text: `${name} has rates that apply only once activated with the issuer: ${idList(toActivate)}. Mark the ones already activated.`,
    })
  }

  if (needsAnniversary(card) && held.anniversary === undefined) {
    notes.push({
      kind: 'anniversary',
      text: `${name} has a ${card.milestones.some((m) => m.period === 'cardmember_year') ? 'spend bonus' : 'cap'} that resets on the card's anniversary. Add the anniversary (MM-DD) so it can be tracked.`,
    })
  }

  const gap = rotationGap(card, today)
  if (gap !== null) {
    notes.push({
      kind: 'rotation',
      text: rotationGapText(name, gap),
    })
  }
  return notes
}
