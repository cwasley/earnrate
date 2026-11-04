import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomic-write.ts'
import { isDeepStrictEqual } from 'node:util'
import { isMap, isSeq, parseDocument, stringify, type Node } from 'yaml'
import {
  applyBonusBooking,
  applyBooking,
  applyCreditBooking,
  applyMilestoneBooking,
  type BonusBooking,
  type CapBooking,
  type CreditBooking,
  type MilestoneBooking,
} from '../engine/record.ts'
import type { CardFields } from '../engine/wallet-change.ts'
import { WALLET_VERSION, WalletSchema, type Wallet } from '../schema/wallet.ts'

type CardEntry = CardFields & { id: string }

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
    case 'anniversary':
    case 'opened': {
      const value = f[field]
      return value == null ? '' : `${indent}${field}: ${scalar(value)}\n`
    }
    case 'activated':
      return f.activated === undefined
        ? ''
        : `${indent}activated: ${flowList(f.activated)}\n`
    case 'enrolled':
      return f.enrolled === undefined
        ? ''
        : `${indent}enrolled: ${flowList(f.enrolled)}\n`
    case 'credit_usage': {
      if (f.credit_usage === undefined) return ''
      const entries = Object.entries(f.credit_usage)
        .map(
          ([key, u]) =>
            `${indent}  ${key}: { period: ${scalar(u.period)}, used: ${String(u.used)} }\n`,
        )
        .join('')
      return entries === '' ? '' : `${indent}credit_usage:\n${entries}`
    }
    case 'cap_usage': {
      if (f.cap_usage === undefined) return ''
      const caps = Object.entries(f.cap_usage)
        .map(
          ([key, u]) =>
            `${indent}  ${key}: { period: ${scalar(u.period)}, spent: ${String(u.spent)} }\n`,
        )
        .join('')
      return caps === '' ? '' : `${indent}cap_usage:\n${caps}`
    }
    case 'milestone_usage': {
      if (f.milestone_usage === undefined) return ''
      const entries = Object.entries(f.milestone_usage)
        .map(
          ([key, u]) =>
            `${indent}  ${key}: { period: ${scalar(u.period)}, spent: ${String(u.spent)} }\n`,
        )
        .join('')
      return entries === '' ? '' : `${indent}milestone_usage:\n${entries}`
    }
    case 'bonus': {
      if (!f.bonus) return ''
      const b = f.bonus
      return [
        `${indent}bonus:\n`,
        `${indent}  opened: ${scalar(b.opened)}\n`,
        `${indent}  spent: ${String(b.spent)}\n`,
        b.spend === undefined ? '' : `${indent}  spend: ${String(b.spend)}\n`,
        b.by === undefined ? '' : `${indent}  by: ${scalar(b.by)}\n`,
        b.points === undefined
          ? ''
          : `${indent}  points: ${String(b.points)}\n`,
        b.dollars === undefined
          ? ''
          : `${indent}  dollars: ${String(b.dollars)}\n`,
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
  'opened',
  'chosen',
  'activated',
  'cap_usage',
  'milestone_usage',
  'enrolled',
  'credit_usage',
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

function rootMap(text: string) {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) throw new Error(doc.errors[0]?.message)
  const root = doc.contents
  if (!isMap(root)) throw new Error(`the wallet isn't a map; ${BY_HAND}`)
  return root
}

// A wallet with no cards yet, for memberships or point values saved first.
export const EMPTY_WALLET_TEXT = `${NEW_WALLET}version: ${String(WALLET_VERSION)}\ncards: []\n`

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
    return `${NEW_WALLET}version: ${String(WALLET_VERSION)}\ncards:\n${cardLines(entry, '  ')}`
  }
  const pair = rootMap(text).items.find((p) => keyOf(p) === 'cards')
  const value = pair?.value
  const none = value === null || (isSeq(value) && value.items.length === 0)
  if (!pair || none) {
    const block = `cards:\n${cardLines(entry, '  ')}`
    if (!pair) return insertLines(text, text.length, block)
    const start = lineStart(text, range(pair.key)[0])
    const end = afterLine(text, range(value ?? pair.key)[1] - 1)
    return text.slice(0, start) + block + text.slice(end)
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
  const end = afterLine(text, range(card)[1] - 1)
  if (cardsSeq(text).cards.items.length === 1) {
    const pair = rootMap(text).items.find((p) => keyOf(p) === 'cards')
    const start = lineStart(text, range(pair?.key)[0])
    return `${text.slice(0, start)}cards: []\n${text.slice(end)}`
  }
  const start = lineStart(text, range(card)[0])
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
  const root = rootMap(text)
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
  return cards
    ? insertLines(text, lineStart(text, range(cards.key)[0]), line)
    : insertLines(text, text.length, line)
}

// Point values, one currency at a time so the rest of the file, comments
// included, stays as it was: a value is replaced in place, a new one goes
// after the last, a removed one loses its line. An inline map is rewritten.
export function setValuationsText(
  text: string,
  changes: Record<string, number | null>,
): string {
  let out = text
  for (const [id, cents] of Object.entries(changes))
    out = setValuationText(out, id, cents)
  return out
}

// The start of the line at `at`, moved up past the comments right above it,
// so a comment stays with the line it describes.
function aboveComments(text: string, at: number): number {
  let start = lineStart(text, at)
  while (start > 0) {
    const previous = lineStart(text, start - 1)
    if (!text.slice(previous, start).trimStart().startsWith('#')) break
    start = previous
  }
  return start
}

function setValuationText(
  text: string,
  id: string,
  cents: number | null,
): string {
  const root = rootMap(text)
  const pair = root.items.find((p) => keyOf(p) === 'valuations')
  const map = pair?.value
  const line = cents === null ? '' : `${id}: ${String(cents)}`
  if (!pair || map === null || (isMap(map) && map.items.length === 0)) {
    if (cents === null) return text
    const block = `valuations:\n  ${line}\n`
    if (pair) {
      const start = range(pair.key)[0]
      const end = afterLine(text, range(map ?? pair.key)[1] - 1)
      return text.slice(0, start) + block + text.slice(end)
    }
    const before = root.items.find(
      (p) => keyOf(p) === 'memberships' || keyOf(p) === 'cards',
    )
    return before
      ? insertLines(text, aboveComments(text, range(before.key)[0]), block)
      : insertLines(text, text.length, block)
  }
  if (!isMap(map)) throw new Error(`"valuations" isn't a map; ${BY_HAND}`)
  if (map.flow) {
    const values = Object.entries(
      map.toJSON() as Record<string, unknown>,
    ).filter(([k]) => k !== id)
    if (cents !== null) values.push([id, cents])
    const entries = values.map(
      ([k, v]) => `${k}: ${stringify(v, { flow: true }).trimEnd()}`,
    )
    const start = range(pair.key)[0]
    const end = afterLine(text, range(map)[1] - 1)
    return (
      text.slice(0, start) +
      (entries.length === 0 ? '' : `valuations: { ${entries.join(', ')} }\n`) +
      text.slice(end)
    )
  }
  const own = map.items.find((p) => keyOf(p) === id)
  if (own) {
    if (cents === null) {
      if (map.items.length === 1) {
        const start = lineStart(text, range(pair.key)[0])
        return (
          text.slice(0, start) + text.slice(afterLine(text, range(map)[1] - 1))
        )
      }
      const start = lineStart(text, range(own.key)[0])
      return (
        text.slice(0, start) +
        text.slice(afterLine(text, range(own.value)[1] - 1))
      )
    }
    const [start, end] = range(own.value)
    return text.slice(0, start) + String(cents) + text.slice(end)
  }
  if (cents === null) return text
  const first = map.items[0]
  const last = map.items.at(-1)
  const indent = ' '.repeat(column(text, range(first?.key)[0]))
  return insertLines(
    text,
    afterLine(text, range(last?.value ?? last?.key)[1] - 1),
    `${indent}${line}\n`,
  )
}

type UsageField = 'cap_usage' | 'milestone_usage' | 'credit_usage'

function flowUsage(period: string, spent: number, name = 'spent'): string {
  const key = /^\d+$/.test(period) ? `"${period}"` : period
  return `{ period: ${key}, ${name}: ${String(spent)} }`
}

// Sets one entry of a card's cap_usage or milestone_usage, adding the map
// when the card has none.
function usageText(
  text: string,
  cardId: string,
  field: UsageField,
  key: string,
  value: string,
): string {
  const card = findCard(text, cardId)
  const usage = card.get(field, true)
  if (isMap(usage) && !usage.flow && usage.items.length > 0) {
    const existing = usage.items.find((p) => keyOf(p) === key)
    if (existing) {
      const [start, end] = range(existing.value)
      return text.slice(0, start) + value + text.slice(end)
    }
    const indent = ' '.repeat(column(text, range(usage.items[0]?.key)[0]))
    const at = afterLine(text, range(usage)[1] - 1)
    return insertLines(text, at, `${indent}${key}: ${value}\n`)
  }
  if (usage !== undefined)
    throw new Error(
      `card '${cardId}' has a ${field} that isn't a block map; ${BY_HAND}`,
    )
  const indent = ' '.repeat(column(text, range(card.items[0]?.key)[0]))
  const at = afterLine(text, range(card)[1] - 1)
  return insertLines(
    text,
    at,
    `${indent}${field}:\n${indent}  ${key}: ${value}\n`,
  )
}

function bonusSpentText(text: string, cardId: string, spent: number): string {
  const bonus = findCard(text, cardId).get('bonus', true)
  if (!isMap(bonus)) throw new Error(`card '${cardId}' has no bonus`)
  const value = String(spent)
  const existing = bonus.items.find((p) => keyOf(p) === 'spent')
  if (existing) {
    const [start, end] = range(existing.value)
    return text.slice(0, start) + value + text.slice(end)
  }
  if (bonus.flow) {
    const close = text.lastIndexOf('}', range(bonus)[1])
    return `${text.slice(0, close).trimEnd()}, spent: ${value} ${text.slice(close)}`
  }
  const indent = ' '.repeat(column(text, range(bonus.items[0]?.key)[0]))
  const at = afterLine(text, range(bonus)[1] - 1)
  return insertLines(text, at, `${indent}spent: ${value}\n`)
}

// Writes spending toward caps, welcome bonuses and spend milestones, and
// merchant credits used, in one checked write.
export async function writeProgress(
  file: string,
  caps: CapBooking[],
  bonuses: Pick<BonusBooking, 'cardId' | 'after'>[],
  milestones: Pick<
    MilestoneBooking,
    'cardId' | 'milestoneId' | 'period' | 'after'
  >[] = [],
  credits: Pick<
    CreditBooking,
    'cardId' | 'creditId' | 'period' | 'after'
  >[] = [],
): Promise<void> {
  const { text, wallet } = await readWalletText(file)
  if (text === null || wallet === null) throw new Error(`No wallet at ${file}.`)
  let after = text
  let expected = wallet
  for (const b of caps) {
    after = usageText(
      after,
      b.cardId,
      'cap_usage',
      b.capKey,
      flowUsage(b.period, b.after),
    )
    expected = applyBooking(expected, b)
  }
  for (const m of milestones) {
    after = usageText(
      after,
      m.cardId,
      'milestone_usage',
      m.milestoneId,
      flowUsage(m.period, m.after),
    )
    expected = applyMilestoneBooking(expected, m)
  }
  for (const b of bonuses) {
    after = bonusSpentText(after, b.cardId, b.after)
    expected = applyBonusBooking(expected, b)
  }
  for (const c of credits) {
    after = usageText(
      after,
      c.cardId,
      'credit_usage',
      c.creditId,
      flowUsage(c.period, c.after, 'used'),
    )
    expected = applyCreditBooking(expected, c)
  }
  const byHand = [
    ...caps.map(
      (b) =>
        `${b.cardId} cap_usage ${b.capKey}: ${flowUsage(b.period, b.after)}`,
    ),
    ...bonuses.map((b) => `${b.cardId} bonus spent: ${String(b.after)}`),
    ...milestones.map(
      (m) =>
        `${m.cardId} milestone_usage ${m.milestoneId}: ${flowUsage(m.period, m.after)}`,
    ),
    ...credits.map(
      (c) =>
        `${c.cardId} credit_usage ${c.creditId}: ${flowUsage(c.period, c.after, 'used')}`,
    ),
  ].join('; ')
  await commitWalletText(file, after, expected, `add it by hand: ${byHand}`)
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
  fallback = BY_HAND,
): Promise<void> {
  const parsed = WalletSchema.safeParse(parseDocument(after).toJS())
  if (!parsed.success || !isDeepStrictEqual(parsed.data, expected)) {
    throw new Error(`couldn't update ${file} safely; ${fallback}`)
  }
  await writeFileAtomic(file, after)
}
