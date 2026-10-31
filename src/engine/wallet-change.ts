import type { Catalog } from '../data/load.ts'
import type { CardFields } from '../data/wallet-edit.ts'
import type { Card } from '../schema/card.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { periodKey } from './periods.ts'
import {
  knownMemberships,
  searchCards,
  setupNotes,
  type SetupNote,
} from './setup.ts'

// Wallet changes as pure functions, shared by the wallet file edits (CLI and
// MCP) and the browser, which keeps its wallet in storage.

export type CardInput = {
  id: string
  checkoutLabel?: string
  picks?: Record<string, string[]> // choice id → option ids
  anniversary?: string // MM-DD
  activated?: string[] // replaces the list
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

export function findCatalogCard(
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

export function isAnniversary(text: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(text)
  if (!m) return false
  const date = new Date(`2024-${text}T00:00:00Z`) // a leap year allows 02-29
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(5, 10) === text
  )
}

// The period key picks are filed under: the card's choice period, or for
// picks that carry over, the current year (it's never compared).
function pickPeriod(card: Card, today: string): string | null {
  const periods = [
    ...new Set(
      card.choices.map((c) => c.period).filter((p) => p !== 'until_changed'),
    ),
  ]
  if (periods.length > 1) return null
  return periodKey(periods[0] ?? 'calendar_year', today, null)
}

export function cardFields(
  card: Card,
  held: WalletCard | null,
  input: CardInput,
  today: string,
): CardFields | string {
  const problems: string[] = []
  const fields: CardFields = {}
  if (input.checkoutLabel !== undefined) {
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
    const period = pickPeriod(card, today)
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
  return problems.length > 0 ? problems.join('\n') : fields
}

export const newHolding = (id: string): WalletCard => ({
  id,
  cap_usage: {},
  activated: [],
})

export const withFields = (held: WalletCard, f: CardFields): WalletCard => ({
  ...held,
  ...(f.checkout_label === undefined
    ? {}
    : { checkout_label: f.checkout_label }),
  ...(f.anniversary === undefined ? {} : { anniversary: f.anniversary }),
  ...(f.chosen === undefined ? {} : { chosen: f.chosen }),
  ...(f.activated === undefined ? {} : { activated: f.activated }),
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
    : { valuations: {}, memberships: [], cards: [held] }
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
  if (wallet.cards.length === 1) {
    return failed(
      `${id} is the last card in the wallet, and a wallet needs one. Add the new card first, then remove this one.`,
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
      `No card rule uses ${unknown.map((m) => `'${m}'`).join(', ')}. Memberships earnrate knows: ${list(known)}.`,
    )
  }
  return {
    ok: true,
    wallet: { ...wallet, memberships: [...new Set(memberships)] },
    fields: {},
    notes: [],
  }
}
