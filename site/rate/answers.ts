// Which of a rated card's statement credits and free nights its holder
// uses. On the page they change the report and its link; for the visitor's
// own wallet they're also saved, through the same wallet-change rules and
// sync path My wallet uses. A shared report's are never saved.
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
  addOp,
  applyLocally,
  ENDED,
  LIMITED,
  changeLanded,
  NOT_SAVED,
  NEEDS_CONNECTION,
  removeOp,
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

// One tap, or All / None, on a card's tiles: credits now used, now not
// used, and back to unanswered. Credits it doesn't name keep their marks.
export type MarksChange = { use?: string[]; skip?: string[]; clear?: string[] }

export function changedMarks(was: Marks, change: MarksChange): Marks {
  const use = [...new Set(change.use ?? [])]
  const skip = [...new Set(change.skip ?? [])].filter((id) => !use.includes(id))
  const touched = [...use, ...skip, ...(change.clear ?? [])]
  const keep = (list: string[]) => list.filter((id) => !touched.includes(id))
  return {
    used: [...keep(was.used), ...use],
    skipped: [...keep(was.skipped), ...skip],
  }
}

type Tile = { id: string; answer: 'used' | 'skipped' | null }

// A tile tapped: used, or, when it was, back to what it was before it was
// marked used (unanswered unless it had been answered "no").
export const tapChange = (
  tile: Tile,
  before: Tile['answer'] | undefined,
): MarksChange =>
  tile.answer !== 'used'
    ? { use: [tile.id] }
    : before === 'skipped'
      ? { skip: [tile.id] }
      : { clear: [tile.id] }

// None: the card's unanswered credits aren't used. Once every one is
// answered, none of them is.
export function noneChange(tiles: Tile[]): MarksChange {
  const open = tiles.filter((t) => t.answer === null).map((t) => t.id)
  return { skip: open.length > 0 ? open : tiles.map((t) => t.id) }
}

// A credit that has paid out, or a night given a value, stays used without
// its `enrolled` entry, so it can't go back to unanswered: it's not used.
export function settledMarks(
  card: Card,
  held: WalletCard,
  marks: Marks,
): Marks {
  const after = {
    ...held,
    enrolled: marks.used,
    skipped_credits: marks.skipped,
  }
  const stuck = heldMarks(card, after).used.filter(
    (id) => !marks.used.includes(id),
  )
  return stuck.length === 0
    ? marks
    : { used: marks.used, skipped: [...marks.skipped, ...stuck] }
}

// The same, for a card in the visitor's own saved wallet.
function settledOwn(
  deps: Pick<SaveDeps, 'catalog' | 'read'>,
  cardId: string,
  marks: Marks,
): Marks {
  const held = deps.read()?.cards.find((c) => c.id === cardId)
  const card = deps.catalog.cards.find((c) => c.id === cardId)
  return held && card ? settledMarks(card, held, marks) : marks
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
  send: (op: LocalOp | null) => Promise<SyncResult>
  signedOut: () => void
}

// The saved wallet after the change, or the refusal and the wallet as it
// still is, so the page can show what's saved.
export type SaveResult =
  | { ok: true; wallet: Wallet }
  | { ok: false; error: string; wallet: Wallet | null }

export type Saver = (cardId: string, marks: Marks) => Promise<SaveResult>

const GONE = "This card isn't in My wallet any more. Reload the page."

// One change to the visitor's own wallet: made on the synced wallet when
// sync is on, otherwise here by the shared wallet-change rules, then saved.
export async function saveChange(
  deps: SaveDeps,
  op: LocalOp,
): Promise<SaveResult> {
  const refused = (error: string): SaveResult => ({
    ok: false,
    error,
    wallet: deps.read(),
  })
  if (deps.synced()) {
    if (!deps.online()) return refused(NEEDS_CONNECTION)
    const before = deps.read()
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
      case 'offline': {
        // The change may have been made with only its answer lost.
        const check = await deps.send(null)
        if (check.kind !== 'ok') return refused(NEEDS_CONNECTION)
        deps.write(check.wallet)
        return changeLanded(
          deps.catalog,
          before,
          check.wallet,
          op,
          deps.today(),
        )
          ? { ok: true, wallet: check.wallet }
          : refused(NOT_SAVED)
      }
    }
  }
  const change = applyLocally(deps.catalog, deps.read(), op, deps.today())
  if (!change.ok) return refused(change.error)
  deps.write(change.wallet)
  return { ok: true, wallet: change.wallet }
}

// A card tapped in, or out, on /rate when the visitor has no saved cards.
export const addCard = (deps: SaveDeps, cardId: string) =>
  saveChange(deps, addOp(cardId))

export const removeCard = (deps: SaveDeps, cardId: string) =>
  saveChange(deps, removeOp(cardId))

export async function saveMarks(
  deps: SaveDeps,
  cardId: string,
  marks: Marks,
): Promise<SaveResult> {
  const wallet = deps.read()
  if (!wallet?.cards.some((c) => c.id === cardId))
    return { ok: false, error: GONE, wallet }
  return saveChange(deps, marksOp(cardId, settledOwn(deps, cardId, marks)))
}

// Only the visitor's own wallet saves answers: the saved one, or the one
// they start by tapping cards in. A shared report never touches storage.
export function answerSaver(source: Source, deps: SaveDeps): Saver | null {
  return source.kind === 'own' || source.kind === 'pick'
    ? (cardId, marks) => saveMarks(deps, cardId, marks)
    : null
}
