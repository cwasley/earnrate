// Which of a held card's statement credits and free nights its holder
// uses, and how a tap, All or None changes that: earnrate.dev's /rate and
// My wallet, and the iPhone app's card settings. Node-free.
import { creditInUse, isSkipped, nightInUse, nightSkipped } from './credits.ts'
import type { Card } from '../schema/card.ts'
import type { WalletCard } from '../schema/wallet.ts'

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
