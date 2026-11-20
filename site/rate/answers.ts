// Which of a rated card's statement credits and free nights its holder
// uses. On the page they change the report and its link; for the visitor's
// own wallet they're also saved, through the same wallet-change rules and
// sync path My wallet uses. A shared report's are never saved.
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
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
import { settledMarks, type Marks } from '../../src/engine/credit-marks.ts'

export {
  changedMarks,
  heldMarks,
  noneChange,
  settledMarks,
  tapChange,
  type Marks,
  type MarksChange,
} from '../../src/engine/credit-marks.ts'

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
