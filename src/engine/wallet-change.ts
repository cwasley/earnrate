import type { Card } from '../schema/card.ts'
import { CARD_NUMBER_LABEL, labelHasCardNumber } from '../schema/card-number.ts'
import type { Catalog } from '../schema/catalog.ts'
import {
  WALLET_VERSION,
  type Wallet,
  type WalletCard,
} from '../schema/wallet.ts'
import { addMonths } from './bonus.ts'
import { capByKey } from './evaluate.ts'
import { choicePeriod, periodKey } from './periods.ts'
import {
  knownMemberships,
  searchCards,
  setupNotes,
  type SetupNote,
} from './setup.ts'
import { CREDIT_PERIODS, idList, money } from './text.ts'

// Node-free: earnrate.dev runs these on the wallet it keeps in the browser.

export type CardInput = {
  id: string
  checkoutLabel?: string | null // null goes back to the card's name
  picks?: Record<string, string[]> // choice id → option ids
  anniversary?: string // MM-DD
  // YYYY-MM-DD the account opened, for intro rates; null removes it.
  opened?: string | null
  activated?: string[] // replaces the list
  // Cap key → dollars already spent on it this period, e.g. on a card added
  // partway through a quarter.
  capSpent?: Record<string, number>
  // Spend milestone id → dollars already spent on the card this period.
  milestoneSpent?: Record<string, number>
  // Statement credit ids the cardholder has enrolled in, or, for ones that
  // need no enrolling, says they use; replaces the list.
  enrolled?: string[]
  // Credit id → dollars of that credit already received this period.
  creditUsed?: Record<string, number>
  // Statement credit ids the cardholder doesn't use; replaces the list.
  skippedCredits?: string[]
  // A welcome bonus in progress; null stops tracking it. Spend and deadline
  // default to the card's published offer.
  bonus?: {
    opened: string // YYYY-MM-DD the account opened
    spent?: number // dollars toward it so far
    spend?: number // dollars needed, when the offer differs
    by?: string // YYYY-MM-DD deadline, when the offer differs
  } | null
}

type BonusFields = {
  opened: string
  spent: number
  spend?: number
  by?: string
  points?: number
  dollars?: number
}

export type CardFields = {
  checkout_label?: string | null // null removes it
  anniversary?: string
  opened?: string | null // null removes it
  chosen?: { period: string; picks: Record<string, string[]> }
  activated?: string[]
  cap_usage?: Record<string, { period: string; spent: number }>
  milestone_usage?: Record<string, { period: string; spent: number }>
  enrolled?: string[]
  credit_usage?: Record<string, { period: string; used: number }>
  skipped_credits?: string[]
  bonus?: BonusFields | null // null removes it
}

export type WalletChange =
  | {
      ok: true
      wallet: Wallet
      fields: CardFields // what changed on the card, for file edits
      notes: SetupNote[] // what the changed card still needs
    }
  | { ok: false; error: string }

const failed = (error: string) => ({ ok: false as const, error })

function findCatalogCard(
  catalog: Catalog,
  id: string,
  today: string,
): Card | string {
  const card = catalog.cards.find((c) => c.id === id)
  if (card) return card
  const near = searchCards(catalog, id, null, today).cards.map((c) => c.id)
  return near.length > 0
    ? `No card '${id}' in earnrate. Closest: ${idList(near)}.`
    : `No card '${id}' in earnrate. Search the catalog to find its id.`
}

function isAnniversary(text: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(text)
  if (!m) return false
  const date = new Date(`2024-${text}T00:00:00Z`) // a leap year allows 02-29
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(5, 10) === text
  )
}

const isDate = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  new Date(`${d}T00:00:00Z`).toISOString().startsWith(d)

function pickKey(card: Card, today: string): string | null {
  const period = choicePeriod(card)
  return period === null ? null : periodKey(period, today, null)
}

export function cardFields(
  card: Card,
  held: WalletCard | null,
  input: CardInput,
  today: string,
): CardFields | string {
  const problems: string[] = []
  const fields: CardFields = {}
  if (input.checkoutLabel === null) fields.checkout_label = null
  else if (input.checkoutLabel !== undefined) {
    if (input.checkoutLabel.trim() === '')
      problems.push('The checkout label is empty.')
    if (labelHasCardNumber(input.checkoutLabel))
      problems.push(CARD_NUMBER_LABEL)
    fields.checkout_label = input.checkoutLabel.trim()
  }
  if (input.anniversary !== undefined) {
    if (!isAnniversary(input.anniversary)) {
      problems.push(
        `"${input.anniversary}" isn't an anniversary. Use MM-DD, like 03-15.`,
      )
    }
    fields.anniversary = input.anniversary
  }
  if (input.opened === null) fields.opened = null
  else if (input.opened !== undefined) {
    if (!isDate(input.opened))
      problems.push(`"${input.opened}" isn't a date. Use YYYY-MM-DD.`)
    else if (input.opened > today)
      problems.push("The account's opening date is in the future.")
    fields.opened = input.opened
  }
  if (input.activated !== undefined) {
    const needing = card.rules
      .filter((r) => r.requires?.activation)
      .map((r) => r.id)
    for (const id of input.activated) {
      if (!needing.includes(id)) {
        problems.push(
          needing.length > 0
            ? `'${id}' isn't a ${card.id} rule that needs activating. Those are: ${idList(needing)}.`
            : `${card.id} has no rules that need activating.`,
        )
      }
    }
    fields.activated = [...new Set(input.activated)]
  }
  if (input.picks !== undefined) {
    for (const [choiceId, picks] of Object.entries(input.picks)) {
      const choice = card.choices.find((c) => c.id === choiceId)
      if (!choice) {
        problems.push(
          card.choices.length > 0
            ? `${card.id} has no '${choiceId}' pick. Its picks are: ${idList(card.choices.map((c) => c.id))}.`
            : `${card.id} has no categories to pick.`,
        )
        continue
      }
      const options = Object.keys(choice.options)
      for (const p of picks) {
        if (!options.includes(p)) {
          problems.push(
            `'${p}' isn't a ${choiceId} option for ${card.id}. Options: ${idList(options)}.`,
          )
        }
      }
      if (picks.length === 0 || picks.length > choice.pick) {
        problems.push(
          `${choiceId} takes ${choice.pick === 1 ? '1 pick' : `1 to ${String(choice.pick)} picks`}, not ${String(picks.length)}.`,
        )
      }
    }
    const period = pickKey(card, today)
    if (period === null) {
      problems.push(
        `${card.id} has picks on different schedules; edit the wallet by hand.`,
      )
    } else {
      const kept = held?.chosen?.period === period ? held.chosen.picks : {}
      fields.chosen = {
        period,
        picks: { ...kept, ...input.picks },
      }
    }
  }
  if (input.capSpent !== undefined) {
    const usage = { ...held?.cap_usage }
    const anniversary = fields.anniversary ?? held?.anniversary ?? null
    for (const [key, spent] of Object.entries(input.capSpent)) {
      const cap = capByKey(card, key)
      if (!cap) {
        const keys = [
          ...card.caps.map((c) => c.id),
          ...card.rules
            .filter((r) => typeof r.cap === 'object')
            .map((r) => r.id),
        ]
        problems.push(
          keys.length > 0
            ? `${card.id} has no cap '${key}'. Its caps are: ${idList(keys)}.`
            : `${card.id} has no spending caps.`,
        )
        continue
      }
      if (!(spent >= 0)) problems.push('Spending on a cap must be $0 or more.')
      const period = periodKey(cap.period, today, anniversary)
      if (period === null) {
        problems.push(
          `The '${key}' cap resets on the card's anniversary; give the anniversary (MM-DD) too.`,
        )
        continue
      }
      usage[key] = { period, spent }
    }
    fields.cap_usage = usage
  }
  if (input.milestoneSpent !== undefined) {
    const usage = { ...held?.milestone_usage }
    const anniversary = fields.anniversary ?? held?.anniversary ?? null
    for (const [id, spent] of Object.entries(input.milestoneSpent)) {
      const milestone = card.milestones.find((m) => m.id === id)
      if (!milestone) {
        problems.push(
          card.milestones.length > 0
            ? `${card.id} has no spend bonus '${id}'. Its milestones are: ${idList(card.milestones.map((m) => m.id))}.`
            : `${card.id} has no spend bonuses.`,
        )
        continue
      }
      if (!(spent >= 0))
        problems.push('Spending toward a spend bonus must be $0 or more.')
      const period = periodKey(milestone.period, today, anniversary)
      if (period === null) {
        problems.push(
          `The '${id}' spend bonus resets on the card's anniversary; give the anniversary (MM-DD) too.`,
        )
        continue
      }
      usage[id] = { period, spent }
    }
    fields.milestone_usage = usage
  }
  if (input.enrolled !== undefined) {
    const ids = card.credits.map((c) => c.id)
    for (const id of input.enrolled) {
      if (!ids.includes(id))
        problems.push(
          ids.length > 0
            ? `${card.id} has no credit '${id}'. Its credits are: ${idList(ids)}.`
            : `${card.id} has no statement credits.`,
        )
    }
    fields.enrolled = [...new Set(input.enrolled)]
  }
  if (input.skippedCredits !== undefined) {
    const ids = card.credits.map((c) => c.id)
    for (const id of input.skippedCredits) {
      if (!ids.includes(id))
        problems.push(
          ids.length > 0
            ? `${card.id} has no credit '${id}'. Its credits are: ${idList(ids)}.`
            : `${card.id} has no statement credits.`,
        )
    }
    fields.skipped_credits = [...new Set(input.skippedCredits)]
  }
  if (input.creditUsed !== undefined) {
    const usage = { ...held?.credit_usage }
    const anniversary = fields.anniversary ?? held?.anniversary ?? null
    for (const [id, used] of Object.entries(input.creditUsed)) {
      const credit = card.credits.find((c) => c.id === id)
      if (!credit) {
        problems.push(
          card.credits.length > 0
            ? `${card.id} has no credit '${id}'. Its credits are: ${idList(card.credits.map((c) => c.id))}.`
            : `${card.id} has no statement credits.`,
        )
        continue
      }
      if (!(used >= 0 && used <= credit.amount))
        problems.push(
          `The '${id}' credit is ${money(credit.amount)} ${CREDIT_PERIODS[credit.period]}, so what's used must be $0 to ${money(credit.amount)}.`,
        )
      const period = periodKey(credit.period, today, anniversary)
      if (period === null) {
        problems.push(
          `The '${id}' credit resets on the card's anniversary; give the anniversary (MM-DD) too.`,
        )
        continue
      }
      usage[id] = { period, used }
    }
    fields.credit_usage = usage
  }
  if (input.bonus === null) fields.bonus = null
  else if (input.bonus !== undefined) {
    const b = input.bonus
    if (!isDate(b.opened))
      problems.push(`"${b.opened}" isn't a date. Use YYYY-MM-DD.`)
    else if (b.opened > today)
      problems.push("The account's opening date is in the future.")
    if (b.spent !== undefined && !(b.spent >= 0))
      problems.push('Spending toward the bonus must be $0 or more.')
    if (b.spend !== undefined && !(b.spend > 0))
      problems.push('The spending needed must be more than $0.')
    if (b.by !== undefined && (!isDate(b.by) || b.by < b.opened))
      problems.push(`"${b.by}" isn't a deadline after the opening date.`)
    if (!card.welcome_offer && (b.spend === undefined || b.by === undefined))
      problems.push(
        `earnrate has no published welcome offer for ${card.id}, so give the spending needed and the deadline.`,
      )
    // The terms are saved with the bonus, so a later change to the published
    // offer, or a wallet exported and imported again, keeps the user's own.
    const offer = card.welcome_offer
    const before = held?.bonus?.opened === b.opened ? held.bonus : undefined
    const spend = b.spend ?? before?.spend ?? offer?.spend
    const by =
      b.by ??
      before?.by ??
      (offer && isDate(b.opened)
        ? addMonths(b.opened, offer.months)
        : undefined)
    const points =
      before?.points ?? (before?.dollars ? undefined : offer?.points)
    const dollars =
      before?.dollars ?? (points !== undefined ? undefined : offer?.dollars)
    fields.bonus = {
      opened: b.opened,
      spent: b.spent ?? held?.bonus?.spent ?? 0,
      ...(spend === undefined ? {} : { spend }),
      ...(by === undefined ? {} : { by }),
      ...(points === undefined ? {} : { points }),
      ...(dollars === undefined ? {} : { dollars }),
    }
  }
  const opened =
    fields.opened === undefined ? (held?.opened ?? null) : fields.opened
  const bonusOpened =
    fields.bonus === undefined
      ? (held?.bonus?.opened ?? null)
      : fields.bonus?.opened
  if (opened !== null && bonusOpened != null && opened !== bonusOpened)
    problems.push(
      `The card's opening date (${opened}) and its welcome bonus's (${bonusOpened}) differ; give the same date for both.`,
    )
  return problems.length > 0 ? problems.join('\n') : fields
}

const newHolding = (id: string): WalletCard => ({
  id,
  cap_usage: {},
  activated: [],
})

const withFields = (
  { bonus, checkout_label, opened, ...held }: WalletCard,
  f: CardFields,
): WalletCard => ({
  ...held,
  ...(opened !== undefined && f.opened === undefined ? { opened } : {}),
  ...(f.opened ? { opened: f.opened } : {}),
  ...(bonus && f.bonus === undefined ? { bonus } : {}),
  ...(checkout_label !== undefined && f.checkout_label === undefined
    ? { checkout_label }
    : {}),
  ...(f.checkout_label ? { checkout_label: f.checkout_label } : {}),
  ...(f.anniversary === undefined ? {} : { anniversary: f.anniversary }),
  ...(f.chosen === undefined ? {} : { chosen: f.chosen }),
  ...(f.activated === undefined ? {} : { activated: f.activated }),
  ...(f.cap_usage === undefined ? {} : { cap_usage: f.cap_usage }),
  ...(f.milestone_usage === undefined
    ? {}
    : { milestone_usage: f.milestone_usage }),
  ...(f.enrolled === undefined ? {} : { enrolled: f.enrolled }),
  ...(f.credit_usage === undefined ? {} : { credit_usage: f.credit_usage }),
  ...(f.skipped_credits === undefined
    ? {}
    : { skipped_credits: f.skipped_credits }),
  ...(f.bonus ? { bonus: f.bonus } : {}),
})

// `wallet` is null when there isn't one yet; adding a card starts it.
export function addToWallet(
  catalog: Catalog,
  wallet: Wallet | null,
  input: CardInput,
  today: string,
): WalletChange {
  const card = findCatalogCard(catalog, input.id, today)
  if (typeof card === 'string') return failed(card)
  if (wallet?.cards.some((c) => c.id === card.id)) {
    return failed(`${card.id} is already in the wallet. Update it instead.`)
  }
  const fields = cardFields(card, null, input, today)
  if (typeof fields === 'string') return failed(fields)
  const held = withFields(newHolding(card.id), fields)
  const next: Wallet = wallet
    ? { ...wallet, cards: [...wallet.cards, held] }
    : {
        version: WALLET_VERSION,
        valuations: {},
        memberships: [],
        cards: [held],
      }
  return {
    ok: true,
    wallet: next,
    fields,
    notes: setupNotes(catalog, next, held, today),
  }
}

export function updateInWallet(
  catalog: Catalog,
  wallet: Wallet,
  input: CardInput,
  today: string,
): WalletChange {
  const held = wallet.cards.find((c) => c.id === input.id)
  const card = catalog.cards.find((c) => c.id === input.id)
  if (!held || !card) {
    return failed(
      `${input.id} isn't in the wallet. Cards: ${idList(wallet.cards.map((c) => c.id))}.`,
    )
  }
  const fields = cardFields(card, held, input, today)
  if (typeof fields === 'string') return failed(fields)
  if (Object.keys(fields).length === 0) return failed('Nothing to change.')
  const updated = withFields(held, fields)
  const next = {
    ...wallet,
    cards: wallet.cards.map((c) => (c.id === held.id ? updated : c)),
  }
  return {
    ok: true,
    wallet: next,
    fields,
    notes: setupNotes(catalog, next, updated, today),
  }
}

export function removeFromWallet(wallet: Wallet, id: string): WalletChange {
  if (!wallet.cards.some((c) => c.id === id)) {
    return failed(
      `${id} isn't in the wallet. Cards: ${idList(wallet.cards.map((c) => c.id))}.`,
    )
  }
  return {
    ok: true,
    wallet: { ...wallet, cards: wallet.cards.filter((c) => c.id !== id) },
    fields: {},
    notes: [],
  }
}

export function withMemberships(
  catalog: Catalog,
  wallet: Wallet,
  memberships: string[],
): WalletChange {
  const known = knownMemberships(catalog)
  const unknown = memberships.filter((m) => !known.includes(m))
  if (unknown.length > 0) {
    return failed(
      `No card uses ${unknown.map((m) => `'${m}'`).join(', ')}. Memberships earnrate knows: ${idList(known)}.`,
    )
  }
  return {
    ok: true,
    wallet: { ...wallet, memberships: [...new Set(memberships)] },
    fields: {},
    notes: [],
  }
}

// Point values in cents per point, by currency id; null goes back to
// earnrate's default for that currency.
export function withValuations(
  catalog: Catalog,
  wallet: Wallet,
  changes: Record<string, number | null>,
): WalletChange {
  const unknown = Object.keys(changes).filter(
    (id) => !catalog.currencies.some((c) => c.id === id),
  )
  if (unknown.length > 0)
    return failed(
      `Unknown currency ${unknown.map((id) => `'${id}'`).join(', ')}. Currencies: ${idList(catalog.currencies.map((c) => c.id))}.`,
    )
  const odd = Object.entries(changes).filter(
    ([, cents]) => cents !== null && !(cents > 0 && cents <= MAX_CENTS),
  )
  if (odd.length > 0)
    return failed(
      `A point is worth more than 0¢ and at most ${String(MAX_CENTS)}¢; check ${odd.map(([id]) => id).join(', ')}.`,
    )
  const valuations = Object.fromEntries([
    ...Object.entries(wallet.valuations).filter(([id]) => !(id in changes)),
    ...Object.entries(changes).filter(([, cents]) => cents !== null),
  ]) as Wallet['valuations']
  return { ok: true, wallet: { ...wallet, valuations }, fields: {}, notes: [] }
}

// Higher than any program's points are worth, even transferred.
const MAX_CENTS = 5

// Point values keyed the way people say them ("ur", "Ultimate Rewards",
// "Chase points"), turned into currency ids. A key that could mean more
// than one currency is refused rather than guessed.
export function currencyChanges(
  catalog: Catalog,
  changes: Record<string, number | null>,
):
  | { ok: true; changes: Record<string, number | null> }
  | { ok: false; error: string } {
  const out: Record<string, number | null> = {}
  for (const [key, cents] of Object.entries(changes)) {
    const matches = currenciesFor(catalog, key)
    const only = matches[0]
    if (matches.length > 1)
      return failed(
        `'${key}' could be ${matches.map((c) => `${c.id} (${c.name})`).join(' or ')}; give the currency id.`,
      )
    if (only === undefined)
      return failed(
        `Unknown currency '${key}'. Currencies: ${catalog.currencies.map((c) => `${c.id} (${c.name})`).join(', ')}.`,
      )
    if (only.id in out)
      return failed(`More than one value was given for ${only.name}.`)
    out[only.id] = cents
  }
  return { ok: true, changes: out }
}

const IGNORED_WORDS = new Set(['points', 'point', 'pts', 'miles', 'mile'])

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '' && !IGNORED_WORDS.has(w))

const sameWords = (a: string[], b: string[]) =>
  a.length === b.length && a.every((w, i) => w === b[i])

function currenciesFor(catalog: Catalog, key: string) {
  const exact = catalog.currencies.find((c) => c.id === key)
  if (exact) return [exact]
  const k = words(key)
  if (k.length === 0) return []
  const byId = catalog.currencies.filter((c) => sameWords(words(c.id), k))
  if (byId.length > 0) return byId
  const byName = catalog.currencies.filter((c) => sameWords(words(c.name), k))
  if (byName.length > 0) return byName
  return catalog.currencies.filter((c) => {
    const name = words(c.name)
    return name.some((_, i) => sameWords(name.slice(i, i + k.length), k))
  })
}
