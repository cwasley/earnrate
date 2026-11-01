import type { Card } from '../schema/card.ts'
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

// Node-free: earnrate.dev runs these on the wallet it keeps in the browser.

export type CardInput = {
  id: string
  checkoutLabel?: string | null // null goes back to the card's name
  picks?: Record<string, string[]> // choice id → option ids
  anniversary?: string // MM-DD
  activated?: string[] // replaces the list
  // Cap key → dollars already spent on it this period, e.g. on a card added
  // partway through a quarter.
  capSpent?: Record<string, number>
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
  chosen?: { period: string; picks: Record<string, string[]> }
  activated?: string[]
  cap_usage?: Record<string, { period: string; spent: number }>
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
const list = (ids: string[]) => ids.join(', ')

function findCatalogCard(
  catalog: Catalog,
  id: string,
  today: string,
): Card | string {
  const card = catalog.cards.find((c) => c.id === id)
  if (card) return card
  const near = searchCards(catalog, id, null, today).cards.map((c) => c.id)
  return near.length > 0
    ? `No card '${id}' in earnrate. Closest: ${list(near)}.`
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
    // earnrate never stores card numbers; a last four is fine.
    if (/\d{8,}/.test(input.checkoutLabel.replace(/[\s-]/g, '')))
      problems.push(
        'The checkout label looks like it has a card number in it. earnrate never stores card numbers; use a name like "Amex Gold".',
      )
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
  if (input.activated !== undefined) {
    const needing = card.rules
      .filter((r) => r.requires?.activation)
      .map((r) => r.id)
    for (const id of input.activated) {
      if (!needing.includes(id)) {
        problems.push(
          needing.length > 0
            ? `'${id}' isn't a ${card.id} rule that needs activating. Those are: ${list(needing)}.`
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
            ? `${card.id} has no '${choiceId}' pick. Its picks are: ${list(card.choices.map((c) => c.id))}.`
            : `${card.id} has no categories to pick.`,
        )
        continue
      }
      const options = Object.keys(choice.options)
      for (const p of picks) {
        if (!options.includes(p)) {
          problems.push(
            `'${p}' isn't a ${choiceId} option for ${card.id}. Options: ${list(options)}.`,
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
            ? `${card.id} has no cap '${key}'. Its caps are: ${list(keys)}.`
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
  if (input.bonus === null) fields.bonus = null
  else if (input.bonus !== undefined) {
    const b = input.bonus
    const isDate = (d: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(d) &&
      new Date(`${d}T00:00:00Z`).toISOString().startsWith(d)
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
  return problems.length > 0 ? problems.join('\n') : fields
}

const newHolding = (id: string): WalletCard => ({
  id,
  cap_usage: {},
  activated: [],
})

const withFields = (
  { bonus, checkout_label, ...held }: WalletCard,
  f: CardFields,
): WalletCard => ({
  ...held,
  ...(bonus && f.bonus === undefined ? { bonus } : {}),
  ...(checkout_label !== undefined && f.checkout_label === undefined
    ? { checkout_label }
    : {}),
  ...(f.checkout_label ? { checkout_label: f.checkout_label } : {}),
  ...(f.anniversary === undefined ? {} : { anniversary: f.anniversary }),
  ...(f.chosen === undefined ? {} : { chosen: f.chosen }),
  ...(f.activated === undefined ? {} : { activated: f.activated }),
  ...(f.cap_usage === undefined ? {} : { cap_usage: f.cap_usage }),
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
      `${input.id} isn't in the wallet. Cards: ${list(wallet.cards.map((c) => c.id))}.`,
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
      `${id} isn't in the wallet. Cards: ${list(wallet.cards.map((c) => c.id))}.`,
    )
  }
  // Removing the last card leaves an empty wallet, which each store keeps
  // in its own way (or refuses, for a wallet file).
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
      `No card uses ${unknown.map((m) => `'${m}'`).join(', ')}. Memberships earnrate knows: ${list(known)}.`,
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
      `Unknown currency ${unknown.map((id) => `'${id}'`).join(', ')}. Currencies: ${list(catalog.currencies.map((c) => c.id))}.`,
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
