import { periodKey } from '../engine/periods.ts'
import {
  knownMemberships,
  searchCards,
  setupNotes,
  type SetupNote,
} from '../engine/setup.ts'
import type { Card } from '../schema/card.ts'
import {
  WalletCardSchema,
  WalletSchema,
  type Wallet,
  type WalletCard,
} from '../schema/wallet.ts'
import type { Catalog } from './load.ts'
import {
  addCardText,
  commitWalletText,
  readWalletText,
  removeCardText,
  setMembershipsText,
  updateCardText,
  type CardFields,
} from './wallet-edit.ts'

export type CardInput = {
  id: string
  checkoutLabel?: string
  picks?: Record<string, string[]> // choice id → option ids
  anniversary?: string // MM-DD
  activated?: string[] // replaces the list
}

export type SetupResult =
  | {
      ok: true
      wallet: Wallet
      created: boolean // the wallet file didn't exist before
      notes: SetupNote[] // what the changed card still needs
    }
  | { ok: false; error: string }

const failed = (error: string) => ({ ok: false as const, error })
const list = (ids: string[]) => ids.join(', ')

function findCatalogCard(catalog: Catalog, id: string, today: string) {
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

// The period key picks are filed under: the card's choice period, or for
// picks that carry over, the current year (it's never compared).
function choicePeriod(card: Card, today: string): string | null {
  const periods = [
    ...new Set(
      card.choices.map((c) => c.period).filter((p) => p !== 'until_changed'),
    ),
  ]
  if (periods.length > 1) return null
  return periodKey(periods[0] ?? 'calendar_year', today, null)
}

function fieldsFor(
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
    const period = choicePeriod(card, today)
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

const applyFields = (held: WalletCard, f: CardFields): WalletCard =>
  WalletCardSchema.parse({
    ...held,
    ...(f.checkout_label === undefined
      ? {}
      : { checkout_label: f.checkout_label }),
    ...(f.anniversary === undefined ? {} : { anniversary: f.anniversary }),
    ...(f.chosen === undefined ? {} : { chosen: f.chosen }),
    ...(f.activated === undefined ? {} : { activated: f.activated }),
  })

async function attempt(task: () => Promise<SetupResult>): Promise<SetupResult> {
  try {
    return await task()
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e))
  }
}

const noWallet = (file: string) =>
  `No wallet at ${file} yet. Add a card first to create it.`

export function addCard(
  file: string,
  catalog: Catalog,
  input: CardInput,
  today: string,
): Promise<SetupResult> {
  return attempt(async () => {
    const card = findCatalogCard(catalog, input.id, today)
    if (typeof card === 'string') return failed(card)
    const { text, wallet } = await readWalletText(file)
    if (wallet?.cards.some((c) => c.id === card.id)) {
      return failed(`${card.id} is already in the wallet. Update it instead.`)
    }
    const fields = fieldsFor(card, null, input, today)
    if (typeof fields === 'string') return failed(fields)

    const held = applyFields(WalletCardSchema.parse({ id: card.id }), fields)
    const expected = wallet
      ? { ...wallet, cards: [...wallet.cards, held] }
      : WalletSchema.parse({ cards: [held] })
    await commitWalletText(
      file,
      addCardText(text, { id: card.id, ...fields }),
      expected,
    )
    return {
      ok: true,
      wallet: expected,
      created: text === null,
      notes: setupNotes(catalog, expected, held, today),
    }
  })
}

export function updateCard(
  file: string,
  catalog: Catalog,
  input: CardInput,
  today: string,
): Promise<SetupResult> {
  return attempt(async () => {
    const { text, wallet } = await readWalletText(file)
    if (text === null || wallet === null) return failed(noWallet(file))
    const held = wallet.cards.find((c) => c.id === input.id)
    const card = catalog.cards.find((c) => c.id === input.id)
    if (!held || !card) {
      return failed(
        `${input.id} isn't in the wallet. Cards: ${list(wallet.cards.map((c) => c.id))}.`,
      )
    }
    const fields = fieldsFor(card, held, input, today)
    if (typeof fields === 'string') return failed(fields)
    if (Object.keys(fields).length === 0) return failed('Nothing to change.')

    const updated = applyFields(held, fields)
    const expected = {
      ...wallet,
      cards: wallet.cards.map((c) => (c.id === held.id ? updated : c)),
    }
    await commitWalletText(
      file,
      updateCardText(text, held.id, fields),
      expected,
    )
    return {
      ok: true,
      wallet: expected,
      created: false,
      notes: setupNotes(catalog, expected, updated, today),
    }
  })
}

export function removeCard(
  file: string,
  _catalog: Catalog,
  id: string,
): Promise<SetupResult> {
  return attempt(async () => {
    const { text, wallet } = await readWalletText(file)
    if (text === null || wallet === null) return failed(noWallet(file))
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
    const expected = {
      ...wallet,
      cards: wallet.cards.filter((c) => c.id !== id),
    }
    await commitWalletText(file, removeCardText(text, id), expected)
    return { ok: true, wallet: expected, created: false, notes: [] }
  })
}

export function setMemberships(
  file: string,
  catalog: Catalog,
  memberships: string[],
): Promise<SetupResult> {
  return attempt(async () => {
    const known = knownMemberships(catalog)
    const unknown = memberships.filter((m) => !known.includes(m))
    if (unknown.length > 0) {
      return failed(
        `No card rule uses ${unknown.map((m) => `'${m}'`).join(', ')}. Memberships earnrate knows: ${list(known)}.`,
      )
    }
    const { text, wallet } = await readWalletText(file)
    if (text === null || wallet === null) return failed(noWallet(file))
    const unique = [...new Set(memberships)]
    const expected = { ...wallet, memberships: unique }
    await commitWalletText(file, setMembershipsText(text, unique), expected)
    return { ok: true, wallet: expected, created: false, notes: [] }
  })
}
