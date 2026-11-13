// Wallet sync with Claude: every change on My wallet is an operation in the
// hosted wallet API's format (the MCP tool's name and input). Not synced,
// it's applied here with the shared wallet-change rules; synced, it's sent
// to /api/wallet on this site's own origin, which holds the sign-in in a
// cookie this script can't read. Nothing else is ever sent.
import { tracksUse } from '../../src/engine/credits.ts'
import { capByKey } from '../../src/engine/evaluate.ts'
import { choicePeriod, periodKey } from '../../src/engine/periods.ts'
import type { SetupNote } from '../../src/engine/setup.ts'
import { listedFew } from '../../src/engine/text.ts'
import { EMPTY_WALLET } from '../../src/engine/transient.ts'
import {
  addToWallet,
  removeFromWallet,
  updateInWallet,
  withMemberships,
  withSkippedIssuers,
  withValuations,
  type CardInput,
  type WalletChange,
} from '../../src/engine/wallet-change.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Wallet, WalletCard } from '../../src/schema/wallet.ts'
import { SYNC_HEADER } from '../api.ts'
import { normalizeWallet } from './saved-wallet.ts'

// add_card and update_card's input: CardInput with the card as `cardId`.
export type CardChangeInput = Omit<CardInput, 'id'> & { cardId: string }

// The changes this page makes, applied here or by the hosted server.
export type LocalOp =
  | { tool: 'add_card'; input: CardChangeInput }
  | { tool: 'update_card'; input: CardChangeInput }
  | { tool: 'remove_card'; input: { cardId: string } }
  | {
      tool: 'set_memberships'
      input: { memberships?: string[]; skippedIssuers?: string[] }
    }
  | {
      tool: 'set_point_values'
      input: { values: Record<string, number | null> }
    }

// Replacing the whole wallet goes only through import_wallet, with its
// confirmation; locally an import just replaces the browser's copy.
export type WalletOp =
  LocalOp | { tool: 'import_wallet'; input: { yaml: string; replace: true } }

// What a change did, for My wallet's message line: what the changed card
// still needs, or the refusal in the rules' own words.
export type Outcome =
  { ok: true; notes: SetupNote[] } | { ok: false; error: string }

export const cardChangeOf = ({ id, ...rest }: CardInput): CardChangeInput => ({
  cardId: id,
  ...rest,
})

const cardInputOf = ({ cardId, ...rest }: CardChangeInput): CardInput => ({
  id: cardId,
  ...rest,
})

export const addOp = (cardId: string): LocalOp => ({
  tool: 'add_card',
  input: { cardId },
})
export const updateOp = (input: CardInput): LocalOp => ({
  tool: 'update_card',
  input: cardChangeOf(input),
})
export const removeOp = (cardId: string): LocalOp => ({
  tool: 'remove_card',
  input: { cardId },
})
export const membershipsOp = (memberships: string[]): LocalOp => ({
  tool: 'set_memberships',
  input: { memberships },
})
export const skippedIssuersOp = (skippedIssuers: string[]): LocalOp => ({
  tool: 'set_memberships',
  input: { skippedIssuers },
})
export const pointValueOp = (
  currency: string,
  cents: number | null,
): LocalOp => ({
  tool: 'set_point_values',
  input: { values: { [currency]: cents } },
})
export const importOp = (yaml: string): WalletOp => ({
  tool: 'import_wallet',
  input: { yaml, replace: true },
})

const failed = (error: string): WalletChange => ({ ok: false, error })

// What an operation does to this browser's wallet, by the same rules the
// hosted server uses.
export function applyLocally(
  catalog: Catalog,
  wallet: Wallet | null,
  op: LocalOp,
  today: string,
): WalletChange {
  switch (op.tool) {
    case 'add_card':
      return addToWallet(catalog, wallet, cardInputOf(op.input), today)
    case 'update_card':
      return wallet
        ? updateInWallet(catalog, wallet, cardInputOf(op.input), today)
        : failed('Add a card first.')
    case 'remove_card':
      return wallet
        ? removeFromWallet(wallet, op.input.cardId)
        : failed('Add a card first.')
    case 'set_memberships': {
      const { memberships, skippedIssuers } = op.input
      const withSkip =
        skippedIssuers === undefined
          ? null
          : withSkippedIssuers(catalog, wallet ?? EMPTY_WALLET, skippedIssuers)
      if (withSkip && !withSkip.ok) return withSkip
      const base = withSkip ? withSkip.wallet : (wallet ?? EMPTY_WALLET)
      return memberships === undefined
        ? (withSkip ?? failed('Give memberships.'))
        : withMemberships(catalog, base, memberships)
    }
    case 'set_point_values':
      return withValuations(catalog, wallet ?? EMPTY_WALLET, op.input.values)
  }
}

// A card as add_card would set it up again today: its settings, and what's
// tracked for the current period (an earlier period's totals don't carry).
export function heldToInput(
  catalog: Catalog,
  held: WalletCard,
  today: string,
): CardInput {
  const input: CardInput = { id: held.id }
  if (held.checkout_label) input.checkoutLabel = held.checkout_label
  if (held.anniversary) input.anniversary = held.anniversary
  if (held.opened) input.opened = held.opened
  if (held.activated.length > 0) input.activated = held.activated
  if (held.enrolled && held.enrolled.length > 0) input.enrolled = held.enrolled
  if (held.bonus) {
    const { opened, spent, spend, by } = held.bonus
    input.bonus = {
      opened,
      spent,
      ...(spend === undefined ? {} : { spend }),
      ...(by === undefined ? {} : { by }),
    }
  }
  const card = catalog.cards.find((c) => c.id === held.id)
  if (!card) return input
  const anniversary = held.anniversary ?? null
  const now = (period: Parameters<typeof periodKey>[0]) =>
    periodKey(period, today, anniversary)
  const pickPeriod = choicePeriod(card)
  if (
    held.chosen &&
    pickPeriod !== null &&
    held.chosen.period === periodKey(pickPeriod, today, null)
  )
    input.picks = held.chosen.picks
  const caps = Object.entries(held.cap_usage).filter(([key, u]) => {
    const cap = capByKey(card, key)
    return cap !== undefined && u.period === now(cap.period)
  })
  if (caps.length > 0)
    input.capSpent = Object.fromEntries(caps.map(([k, u]) => [k, u.spent]))
  const milestones = Object.entries(held.milestone_usage ?? {}).filter(
    ([id, u]) => {
      const m = card.milestones.find((x) => x.id === id)
      return m !== undefined && u.period === now(m.period)
    },
  )
  if (milestones.length > 0)
    input.milestoneSpent = Object.fromEntries(
      milestones.map(([k, u]) => [k, u.spent]),
    )
  const credits = Object.entries(held.credit_usage ?? {}).filter(([id, u]) => {
    const c = card.credits.find((x) => x.id === id)
    return c !== undefined && tracksUse(c) && u.period === now(c.period)
  })
  if (credits.length > 0)
    input.creditUsed = Object.fromEntries(credits.map(([k, u]) => [k, u.used]))
  const skipped = (held.skipped_credits ?? []).filter(
    (id) =>
      card.credits.some((c) => c.id === id) ||
      card.free_nights.some((n) => n.id === id),
  )
  if (skipped.length > 0) input.skippedCredits = skipped
  const worth = Object.entries(held.night_values ?? {}).filter(([id]) =>
    card.free_nights.some((n) => n.id === id),
  )
  if (worth.length > 0) input.nightValues = Object.fromEntries(worth)
  return input
}

// Undo for a removed card: add_card with everything it held this period.
export const restoreOp = (
  catalog: Catalog,
  held: WalletCard,
  today: string,
): LocalOp => ({
  tool: 'add_card',
  input: cardChangeOf(heldToInput(catalog, held, today)),
})

// "Combine them": every card from both, the Claude wallet's settings where a
// card is in both, the memberships of both, and point values from both (the
// Claude wallet's where both set one). Sent as changes, never as a whole
// wallet.
export function combineOps(
  catalog: Catalog,
  claude: Wallet,
  browser: Wallet,
  today: string,
): LocalOp[] {
  const held = new Set(claude.cards.map((c) => c.id))
  const ops: LocalOp[] = browser.cards
    .filter((c) => !held.has(c.id))
    .map((c) => restoreOp(catalog, c, today))
  const memberships = [
    ...new Set([...claude.memberships, ...browser.memberships]),
  ]
  if (memberships.length > claude.memberships.length)
    ops.push(membershipsOp(memberships))
  const skipped = [
    ...new Set([
      ...(claude.skipped_issuers ?? []),
      ...(browser.skipped_issuers ?? []),
    ]),
  ]
  if (skipped.length > (claude.skipped_issuers ?? []).length)
    ops.push(skippedIssuersOp(skipped))
  // A point value only this browser set carries over; where both set one,
  // the Claude wallet's stays.
  const values = Object.fromEntries(
    Object.entries(browser.valuations).flatMap(([currency, v]) => {
      const cents = typeof v === 'number' ? v : v.value
      return currency in claude.valuations || cents === undefined
        ? []
        : [[currency, cents]]
    }),
  )
  if (Object.keys(values).length > 0)
    ops.push({ tool: 'set_point_values', input: { values } })
  return ops
}

const isEmpty = (w: Wallet | null) =>
  !w ||
  (w.cards.length === 0 &&
    w.memberships.length === 0 &&
    Object.keys(w.valuations).length === 0 &&
    (w.skipped_issuers ?? []).length === 0)

const sameWallet = (a: Wallet, b: Wallet) =>
  JSON.stringify([a.cards, a.memberships, a.valuations, a.skipped_issuers]) ===
  JSON.stringify([b.cards, b.memberships, b.valuations, b.skipped_issuers])

// Order-free and blind to empty values, so a field one side leaves out and
// the other holds empty doesn't count as a difference.
function canonical(v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    return v
      .map(canonical)
      .map((x) => JSON.stringify(x))
      .sort()
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v)
      .map(([k, x]) => [k, canonical(x)] as const)
      .filter(([, x]) => x !== null)
      .sort(([a], [b]) => a.localeCompare(b))
    return entries.length === 0 ? null : entries
  }
  return v
}

const differs = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) !== JSON.stringify(canonical(b))

const CARD_PARTS: [string, (keyof WalletCard)[]][] = [
  ['picks', ['chosen']],
  ['activations', ['activated']],
  ['credits', ['enrolled', 'credit_usage', 'skipped_credits', 'night_values']],
  ['bonus progress', ['bonus', 'milestone_usage']],
  ['spending totals', ['cap_usage']],
  ['card dates', ['anniversary', 'opened']],
  ['checkout labels', ['checkout_label']],
]

// What the two wallets hold differently beyond which cards they have, for
// the first-connection choice: "credits on Amex Platinum", "point values".
export function walletDifferences(
  claude: Wallet,
  browser: Wallet,
  name: (id: string) => string,
): string[] {
  const theirs = new Map(claude.cards.map((c) => [c.id, c]))
  const both = browser.cards.flatMap((mine) => {
    const other = theirs.get(mine.id)
    return other ? [[mine, other] as const] : []
  })
  const parts = CARD_PARTS.flatMap(([label, fields]) => {
    const names = both
      .filter(([a, b]) => fields.some((f) => differs(a[f], b[f])))
      .map(([a]) => name(a.id))
    return names.length > 0 ? [`${label} on ${listedFew(names)}`] : []
  })
  if (differs(claude.memberships, browser.memberships))
    parts.push('memberships')
  if (differs(claude.valuations, browser.valuations)) parts.push('point values')
  if (differs(claude.skipped_issuers, browser.skipped_issuers))
    parts.push('issuers left out of next-card answers')
  const order = (w: Wallet) => w.cards.map((c) => c.id).join(' ')
  const sameCards =
    claude.cards.length === browser.cards.length &&
    browser.cards.every((c) => theirs.has(c.id))
  if (parts.length === 0 && sameCards && order(claude) !== order(browser))
    parts.push('the order of the cards')
  return parts
}

// The browser's wallet, keeping settings the Claude wallet has and the
// browser doesn't: for a first connection where only the browser has cards.
export function keepClaudeSettings(claude: Wallet, browser: Wallet): Wallet {
  const skipped = [
    ...new Set([
      ...(claude.skipped_issuers ?? []),
      ...(browser.skipped_issuers ?? []),
    ]),
  ]
  return {
    ...browser,
    memberships: [...new Set([...claude.memberships, ...browser.memberships])],
    valuations: { ...claude.valuations, ...browser.valuations },
    ...(skipped.length > 0 ? { skipped_issuers: skipped } : {}),
  }
}

// What the first connection does: ask only when both sides have cards and
// they differ; otherwise use the side that has cards (or anything at all).
export type FirstConnection = 'claude' | 'browser' | 'same' | 'ask'

export function firstConnection(
  claude: Wallet,
  browser: Wallet | null,
): FirstConnection {
  if (!browser || isEmpty(browser)) return isEmpty(claude) ? 'same' : 'claude'
  if (sameWallet(claude, browser)) return 'same'
  const claudeCards = claude.cards.length > 0
  const browserCards = browser.cards.length > 0
  if (claudeCards && browserCards) return 'ask'
  if (browserCards) return 'browser'
  if (claudeCards) return 'claude'
  return isEmpty(claude) ? 'browser' : 'claude'
}

// Sign-in comes back to /#wallet&sync=on (or canceled, failed). Read once,
// then dropped from the address.
export type SyncReturn = 'on' | 'canceled' | 'failed'

export function syncReturn(hash: string): {
  sync: SyncReturn | null
  hash: string
} {
  const parts = hash.replace(/^#/, '').split('&')
  const value = parts.find((p) => p.startsWith('sync='))?.slice(5)
  const kept = parts.filter((p) => p !== '' && !p.startsWith('sync='))
  return {
    sync:
      value === 'on' || value === 'canceled' || value === 'failed'
        ? value
        : null,
    hash: kept.length > 0 ? `#${kept.join('&')}` : '',
  }
}

// Any page could link to #wallet&sync=on, so the return counts only in the
// tab that pressed connect: it marks its own session storage just before
// leaving for sign-in, and the mark is read and cleared on the next load.
const STARTED = 'earnrate:sync-started'

export function signInStarted(): void {
  try {
    sessionStorage.setItem(STARTED, '1')
  } catch {
    // Without storage the return can't be told from a link, so it's ignored.
  }
}

export function takeSignInStarted(): boolean {
  try {
    const started = sessionStorage.getItem(STARTED) === '1'
    sessionStorage.removeItem(STARTED)
    return started
  } catch {
    return false
  }
}

// Whether My wallet can be changed right now, and what to say if not.
export function editState({
  synced,
  online,
  busy,
}: {
  synced: boolean
  online: boolean
  busy: boolean
}): { locked: boolean; note: string | null } {
  if (synced && !online) return { locked: true, note: NEEDS_CONNECTION }
  return { locked: busy, note: null }
}

export type SyncResult =
  | { kind: 'ok'; wallet: Wallet }
  | { kind: 'refused'; error: string }
  | { kind: 'ended' } // signed out: code changed, wallet deleted, or expired
  | { kind: 'offline' } // no connection, or earnrate's server unreachable
  | { kind: 'limited' }

export const LIMITED = 'Too many changes at once. Try again in a minute.'
export const NEEDS_CONNECTION = 'Changes need a connection.'
export const ENDED = 'This browser was signed out of your Claude wallet.'
export const NOT_SAVED =
  "That change didn't reach your Claude wallet. Try it again."

// Whether the synced wallet, read after a change's answer was lost, already
// has the change: the card added or gone, or the change making no
// difference when made again. A whole-wallet import isn't checked.
export function changeLanded(
  catalog: Catalog,
  before: Wallet | null,
  after: Wallet,
  op: WalletOp,
  today: string,
): boolean {
  const holds = (w: Wallet | null, id: string) =>
    w?.cards.some((c) => c.id === id) ?? false
  switch (op.tool) {
    case 'import_wallet':
      return false
    case 'add_card':
      return holds(after, op.input.cardId) && !holds(before, op.input.cardId)
    case 'remove_card':
      return !holds(after, op.input.cardId) && holds(before, op.input.cardId)
    default: {
      const again = applyLocally(catalog, after, op, today)
      return again.ok && sameWallet(again.wallet, after)
    }
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>

// One /api request at a time: two that refresh the same expired token at
// once get two new refresh tokens, the second voiding the first, and the
// browser may keep the void one and be signed out at the next refresh.
let queue: Promise<unknown> = Promise.resolve()
function inTurn<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run)
  queue = next.catch(() => undefined)
  return next
}

// Reads the synced wallet (no op) or makes one change.
export function syncRequest(
  op: WalletOp | null,
  send: Fetch = (input, init) => fetch(input, init),
): Promise<SyncResult> {
  return inTurn(() => request(op, send))
}

async function request(op: WalletOp | null, send: Fetch): Promise<SyncResult> {
  let response: Response
  try {
    response = await send('/api/wallet', {
      method: op ? 'POST' : 'GET',
      headers: {
        [SYNC_HEADER]: '1',
        ...(op ? { 'content-type': 'application/json' } : {}),
      },
      credentials: 'same-origin',
      cache: 'no-store',
      ...(op ? { body: JSON.stringify(op) } : {}),
    })
  } catch {
    return { kind: 'offline' }
  }
  if (response.status === 401) return { kind: 'ended' }
  if (response.status === 429) return { kind: 'limited' }
  const body = (await response.json().catch(() => null)) as {
    wallet?: unknown
    error?: unknown
  } | null
  if (response.status === 200) {
    const wallet = normalizeWallet(body?.wallet)
    return wallet ? { kind: 'ok', wallet } : { kind: 'offline' }
  }
  if (
    (response.status === 422 || response.status === 400) &&
    typeof body?.error === 'string'
  )
    return { kind: 'refused', error: body.error }
  return { kind: 'offline' }
}

// Signs this browser out; false when earnrate's server couldn't be reached.
export function disconnect(
  send: Fetch = (input, init) => fetch(input, init),
): Promise<boolean> {
  return inTurn(async () => {
    try {
      const res = await send('/api/disconnect', {
        method: 'POST',
        headers: { [SYNC_HEADER]: '1' },
        credentials: 'same-origin',
      })
      return res.status === 204
    } catch {
      return false
    }
  })
}
