import { isDeepStrictEqual } from 'node:util'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { isMap, isSeq, parseDocument, type Node } from 'yaml'
import type { CapBooking } from '../engine/record.ts'
import { WalletSchema } from '../schema/wallet.ts'

const lineStart = (text: string, at: number) =>
  text.lastIndexOf('\n', at - 1) + 1

function afterLine(text: string, at: number): number {
  const end = text.indexOf('\n', at)
  return end === -1 ? text.length : end + 1
}

// Inserts whole lines at a line boundary, adding the missing newline when the
// file's last line has none.
function insertLines(text: string, at: number, lines: string): string {
  const head = text.slice(0, at)
  const gap = head.length > 0 && !head.endsWith('\n') ? '\n' : ''
  return `${head}${gap}${lines}${text.slice(at)}`
}

const column = (text: string, at: number) => at - lineStart(text, at)

function range(node: unknown): [number, number, number] {
  const r = (node as Node | null)?.range
  if (!r) throw new Error('wallet YAML node has no source position')
  return r
}

function flowUsage(booking: CapBooking): string {
  const period = /^\d+$/.test(booking.period)
    ? `"${booking.period}"`
    : booking.period
  return `{ period: ${period}, spent: ${String(booking.after)} }`
}

// Splices one line into the file's text instead of re-serializing the YAML,
// so comments, ordering and formatting elsewhere stay byte-for-byte the same.
function spliceBooking(text: string, booking: CapBooking): string {
  const doc = parseDocument(text)
  const cards = doc.get('cards', true)
  if (!isSeq(cards)) throw new Error('"cards" isn\'t a list')
  const card = cards.items.find(
    (item) => isMap(item) && item.get('id') === booking.cardId,
  )
  if (!isMap(card)) throw new Error(`no card '${booking.cardId}'`)
  const value = flowUsage(booking)

  const usage = card.get('cap_usage', true)
  if (isMap(usage) && !usage.flow && usage.items.length > 0) {
    const existing = usage.items.find(
      (p) => (p.key as { value?: unknown } | null)?.value === booking.capKey,
    )
    if (existing) {
      const [start, end] = range(existing.value)
      return text.slice(0, start) + value + text.slice(end)
    }
    const first = usage.items[0]
    const indent = ' '.repeat(column(text, range(first?.key)[0]))
    const at = afterLine(text, range(usage)[1] - 1)
    return insertLines(text, at, `${indent}${booking.capKey}: ${value}\n`)
  }
  if (usage !== undefined) {
    throw new Error(
      `card '${booking.cardId}' has a cap_usage that isn't a block map; edit it by hand`,
    )
  }

  const firstKey = card.items[0]?.key
  const indent = ' '.repeat(column(text, range(firstKey)[0]))
  const at = afterLine(text, range(card)[1] - 1)
  return insertLines(
    text,
    at,
    `${indent}cap_usage:\n${indent}  ${booking.capKey}: ${value}\n`,
  )
}

function spliceBonusSpent(text: string, cardId: string, spent: number): string {
  const doc = parseDocument(text)
  const cards = doc.get('cards', true)
  if (!isSeq(cards)) throw new Error('"cards" isn\'t a list')
  const card = cards.items.find(
    (item) => isMap(item) && item.get('id') === cardId,
  )
  if (!isMap(card)) throw new Error(`no card '${cardId}'`)
  const bonus = card.get('bonus', true)
  if (!isMap(bonus)) throw new Error(`card '${cardId}' has no bonus`)
  const value = String(spent)

  const existing = bonus.items.find(
    (p) => (p.key as { value?: unknown } | null)?.value === 'spent',
  )
  if (existing) {
    const [start, end] = range(existing.value)
    return text.slice(0, start) + value + text.slice(end)
  }
  if (bonus.flow) {
    const close = text.lastIndexOf('}', range(bonus)[1])
    const before = text.slice(0, close).trimEnd()
    return `${before}, spent: ${value} ${text.slice(close)}`
  }
  const first = bonus.items[0]
  const indent = ' '.repeat(column(text, range(first?.key)[0]))
  const at = afterLine(text, range(bonus)[1] - 1)
  return insertLines(text, at, `${indent}spent: ${value}\n`)
}

// Sets how much has been spent toward a card's welcome bonus.
export async function writeBonusSpent(
  file: string,
  cardId: string,
  spent: number,
): Promise<void> {
  const before = await readFile(file, 'utf8')
  const after = spliceBonusSpent(before, cardId, spent)

  const oldWallet = WalletSchema.parse(parseDocument(before).toJS())
  const parsed = WalletSchema.safeParse(parseDocument(after).toJS())
  const expected = {
    ...oldWallet,
    cards: oldWallet.cards.map((c) =>
      c.id === cardId && c.bonus ? { ...c, bonus: { ...c.bonus, spent } } : c,
    ),
  }
  if (!parsed.success || !isDeepStrictEqual(parsed.data, expected)) {
    throw new Error(
      `couldn't update ${file} safely; set the bonus's spent to ${String(spent)} by hand`,
    )
  }
  const tmp = `${file}.${String(process.pid)}.tmp`
  await writeFile(tmp, after)
  await rename(tmp, file)
}

const queues = new Map<string, Promise<unknown>>()

// Runs `task` after every earlier task for the same file has settled, so a
// read-modify-write of the wallet never interleaves with another.
export function withWalletLock<T>(
  file: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve()
  const run = previous.then(task, task)
  queues.set(
    file,
    run.catch(() => undefined),
  )
  return run
}

export async function writeCapBooking(
  file: string,
  booking: CapBooking,
): Promise<void> {
  const before = await readFile(file, 'utf8')
  const after = spliceBooking(before, booking)

  const oldWallet = WalletSchema.parse(parseDocument(before).toJS())
  const parsed = WalletSchema.safeParse(parseDocument(after).toJS())
  const expected = {
    ...oldWallet,
    cards: oldWallet.cards.map((c) =>
      c.id === booking.cardId
        ? {
            ...c,
            cap_usage: {
              ...c.cap_usage,
              [booking.capKey]: {
                period: booking.period,
                spent: booking.after,
              },
            },
          }
        : c,
    ),
  }
  if (!parsed.success || !isDeepStrictEqual(parsed.data, expected)) {
    throw new Error(
      `couldn't update ${file} safely; add the cap usage by hand: ${booking.capKey}: ${flowUsage(booking)}`,
    )
  }

  const tmp = `${file}.${String(process.pid)}.tmp`
  await writeFile(tmp, after)
  await rename(tmp, file)
}
