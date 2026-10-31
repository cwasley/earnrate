import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isMap, isSeq, parseDocument, stringify, type Node } from 'yaml'
import { WalletSchema, type Wallet } from '../schema/wallet.ts'

export type BonusFields = {
  opened: string
  spent: number
  spend?: number
  by?: string
}

export type CardFields = {
  checkout_label?: string
  anniversary?: string
  chosen?: { period: string; picks: Record<string, string[]> }
  activated?: string[]
  bonus?: BonusFields | null // null removes it
}

export type CardEntry = CardFields & { id: string }

const NEW_WALLET = `# Your earnrate wallet: the cards you hold, by id. Never card numbers.
# Format: https://github.com/cwasley/earnrate#your-wallet

`

const BY_HAND = 'edit the wallet by hand'

const lineStart = (text: string, at: number) =>
  text.lastIndexOf('\n', at - 1) + 1

function afterLine(text: string, at: number): number {
  const end = text.indexOf('\n', at)
  return end === -1 ? text.length : end + 1
}

function insertLines(text: string, at: number, lines: string): string {
  const head = text.slice(0, at)
  const gap = head.length > 0 && !head.endsWith('\n') ? '\n' : ''
  return `${head}${gap}${lines}${text.slice(at)}`
}

function range(node: unknown): [number, number, number] {
  const r = (node as Node | null)?.range
  if (!r) throw new Error(`a wallet value has no source position; ${BY_HAND}`)
  return r
}

const keyOf = (pair: { key: unknown }) =>
  (pair.key as { value?: unknown } | null)?.value

const scalar = (value: string) => stringify(value).trimEnd()
const flowList = (ids: string[]) => `[${ids.join(', ')}]`

function fieldLines(field: keyof CardFields, f: CardFields, indent: string) {
  switch (field) {
    case 'checkout_label':
    case 'anniversary': {
      const value = f[field]
      return value === undefined ? '' : `${indent}${field}: ${scalar(value)}\n`
    }
    case 'activated':
      return f.activated === undefined
        ? ''
        : `${indent}activated: ${flowList(f.activated)}\n`
    case 'bonus': {
      if (!f.bonus) return ''
      const b = f.bonus
      return [
        `${indent}bonus:\n`,
        `${indent}  opened: ${scalar(b.opened)}\n`,
        `${indent}  spent: ${String(b.spent)}\n`,
        b.spend === undefined ? '' : `${indent}  spend: ${String(b.spend)}\n`,
        b.by === undefined ? '' : `${indent}  by: ${scalar(b.by)}\n`,
      ].join('')
    }
    case 'chosen': {
      if (f.chosen === undefined) return ''
      const picks = Object.entries(f.chosen.picks)
        .map(([choice, ids]) => `${indent}    ${choice}: ${flowList(ids)}\n`)
        .join('')
      return `${indent}chosen:\n${indent}  period: ${scalar(f.chosen.period)}\n${indent}  picks:\n${picks}`
    }
  }
}

const FIELDS = [
  'checkout_label',
  'anniversary',
  'chosen',
  'activated',
  'bonus',
] as const

function cardsSeq(text: string) {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) throw new Error(doc.errors[0]?.message)
  const cards = doc.get('cards', true)
  if (!isSeq(cards) || cards.flow) {
    throw new Error(`"cards" isn't a block list; ${BY_HAND}`)
  }
  return { doc, cards }
}

function findCard(text: string, cardId: string) {
  const { cards } = cardsSeq(text)
  const card = cards.items.find(
    (item) => isMap(item) && item.get('id') === cardId,
  )
  if (!isMap(card)) throw new Error(`no card '${cardId}' in the wallet`)
  if (card.flow)
    throw new Error(`card '${cardId}' is written inline; ${BY_HAND}`)
  return card
}

const column = (text: string, at: number) => at - lineStart(text, at)

// Appends a card after the last one, matching the list's indentation.
export function addCardText(text: string | null, entry: CardEntry): string {
  if (text === null || text.trim() === '') {
    return `${NEW_WALLET}cards:\n${cardLines(entry, '  ')}`
  }
  const { cards } = cardsSeq(text)
  const first = cards.items[0]
  if (!isMap(first)) throw new Error(`"cards" is empty; ${BY_HAND}`)
  const keyColumn = column(text, range(first)[0])
  if (keyColumn < 2 || text[range(first)[0] - 2] !== '-') {
    throw new Error(`can't tell how the cards are indented; ${BY_HAND}`)
  }
  const at = afterLine(text, range(cards)[1] - 1)
  return insertLines(text, at, cardLines(entry, ' '.repeat(keyColumn - 2)))
}

function cardLines(entry: CardEntry, dashIndent: string): string {
  const indent = `${dashIndent}  `
  return `${dashIndent}- id: ${entry.id}\n${FIELDS.map((f) => fieldLines(f, entry, indent)).join('')}`
}

export function removeCardText(text: string, cardId: string): string {
  const card = findCard(text, cardId)
  const start = lineStart(text, range(card)[0])
  const end = afterLine(text, range(card)[1] - 1)
  return text.slice(0, start) + text.slice(end)
}

// Replaces each given field in place, or adds it after the card's last line.
export function updateCardText(
  text: string,
  cardId: string,
  fields: CardFields,
): string {
  let out = text
  for (const field of FIELDS) {
    if (fields[field] === undefined) continue
    const card = findCard(out, cardId)
    const indent = ' '.repeat(column(out, range(card)[0]))
    const lines = fieldLines(field, fields, indent)
    const pair = card.items.find((p) => keyOf(p) === field)
    if (pair && lines === '') {
      const start = lineStart(out, range(pair.key)[0])
      const end = afterLine(out, range(pair.value)[1] - 1)
      out = out.slice(0, start) + out.slice(end)
    } else if (pair) {
      const start = range(pair.key)[0]
      const end = afterLine(out, range(pair.value)[1] - 1)
      out = out.slice(0, start) + lines.trimStart() + out.slice(end)
    } else {
      out = insertLines(out, afterLine(out, range(card)[1] - 1), lines)
    }
  }
  return out
}

export function setMembershipsText(
  text: string,
  memberships: string[],
): string {
  const { doc } = cardsSeq(text)
  const root = doc.contents
  if (!isMap(root)) throw new Error(`the wallet isn't a map; ${BY_HAND}`)
  const line = `memberships: ${flowList(memberships)}\n`
  const pair = root.items.find((p) => keyOf(p) === 'memberships')
  if (pair) {
    const start = range(pair.key)[0]
    const end = afterLine(
      text,
      (pair.value === null ? range(pair.key) : range(pair.value))[1] - 1,
    )
    return text.slice(0, start) + line + text.slice(end)
  }
  const cards = root.items.find((p) => keyOf(p) === 'cards')
  return insertLines(text, lineStart(text, range(cards?.key)[0]), line)
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null
    throw e
  }
}

export async function readWalletText(
  file: string,
): Promise<{ text: string | null; wallet: Wallet | null }> {
  const text = await readText(file)
  return {
    text,
    wallet:
      text === null ? null : WalletSchema.parse(parseDocument(text).toJS()),
  }
}

// Writes `after` only if it parses to exactly `expected`, so a splice that
// went wrong can never change anything it wasn't meant to.
export async function commitWalletText(
  file: string,
  after: string,
  expected: Wallet,
): Promise<void> {
  const parsed = WalletSchema.safeParse(parseDocument(after).toJS())
  if (!parsed.success || !isDeepStrictEqual(parsed.data, expected)) {
    throw new Error(`couldn't update ${file} safely; ${BY_HAND}`)
  }
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${String(process.pid)}.tmp`
  await writeFile(tmp, after)
  await rename(tmp, file)
}
