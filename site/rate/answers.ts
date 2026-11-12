// Which of a rated card's statement credits and free nights its holder
// uses. On the page they change the report and its link; only for the
// visitor's own saved wallet are they also saved, through the same
// wallet-change rules and sync path My wallet uses.
import {
  creditInUse,
  isSkipped,
  nightInUse,
  nightSkipped,
} from '../../src/engine/credits.ts'
import type { Card } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Wallet, WalletCard } from '../../src/schema/wallet.ts'
import {
  applyLocally,
  ENDED,
  LIMITED,
  NEEDS_CONNECTION,
  updateOp,
  type LocalOp,
  type SyncResult,
} from '../app/sync.ts'
import type { Source } from './source.ts'

export type Marks = { used: string[]; skipped: string[] }

// What the holder has said, by the rules the fee math uses.
export function heldMarks(card: Card, held: WalletCard): Marks {
  return {
    used: [
      ...card.credits.filter((c) => creditInUse(c, held)).map((c) => c.id),
      ...card.free_nights.filter((n) => nightInUse(n, held)).map((n) => n.id),
    ],
    skipped: [
      ...card.credits.filter((c) => isSkipped(c, held)).map((c) => c.id),
      ...card.free_nights.filter((n) => nightSkipped(n, held)).map((n) => n.id),
    ],
  }
}

// A card's marks once it's answered on /rate: of its credits `ids`, those in
// `used` are used and every other one is not. Marks for credits it no longer
// lists stay as they were.
export function answeredMarks(
  was: Marks,
  ids: string[],
  used: string[],
): Marks {
  const out = (list: string[]) => list.filter((id) => !ids.includes(id))
  return {
    used: [...out(was.used), ...ids.filter((id) => used.includes(id))],
    skipped: [...out(was.skipped), ...ids.filter((id) => !used.includes(id))],
  }
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

export const sameMarks = (a: Marks, b: Marks) =>
  sameSet(a.used, b.used) && sameSet(a.skipped, b.skipped)

// The change that saves a card's marks: its whole used and not-used lists,
// as My wallet's Settings sends them.
export const marksOp = (cardId: string, marks: Marks): LocalOp =>
  updateOp({ id: cardId, enrolled: marks.used, skippedCredits: marks.skipped })

export type SaveDeps = {
  catalog: Catalog
  today: () => string
  read: () => Wallet | null
  write: (wallet: Wallet) => void
  synced: () => boolean
  online: () => boolean
  send: (op: LocalOp) => Promise<SyncResult>
  signedOut: () => void
}

// The saved wallet after the change, or the refusal and the wallet as it
// still is, so the page can show what's saved.
export type SaveResult =
  | { ok: true; wallet: Wallet }
  | { ok: false; error: string; wallet: Wallet | null }

export type Saver = (cardId: string, marks: Marks) => Promise<SaveResult>

const GONE = "This card isn't in My wallet any more. Reload the page."

export async function saveMarks(
  deps: SaveDeps,
  cardId: string,
  marks: Marks,
): Promise<SaveResult> {
  const wallet = deps.read()
  const refused = (error: string): SaveResult => ({
    ok: false,
    error,
    wallet: deps.read(),
  })
  if (!wallet?.cards.some((c) => c.id === cardId)) return refused(GONE)
  const op = marksOp(cardId, marks)
  if (deps.synced()) {
    if (!deps.online()) return refused(NEEDS_CONNECTION)
    const result = await deps.send(op)
    switch (result.kind) {
      case 'ok':
        deps.write(result.wallet)
        return { ok: true, wallet: result.wallet }
      case 'refused':
        return refused(result.error)
      case 'ended':
        deps.signedOut()
        return refused(ENDED)
      case 'limited':
        return refused(LIMITED)
      case 'offline':
        return refused(NEEDS_CONNECTION)
    }
  }
  const change = applyLocally(deps.catalog, wallet, op, deps.today())
  if (!change.ok) return refused(change.error)
  deps.write(change.wallet)
  return { ok: true, wallet: change.wallet }
}

// Only the visitor's own saved wallet saves answers: a shared report or
// cards tapped in on the page never touch storage.
export function answerSaver(source: Source, deps: SaveDeps): Saver | null {
  return source.kind === 'own'
    ? (cardId, marks) => saveMarks(deps, cardId, marks)
    : null
}
