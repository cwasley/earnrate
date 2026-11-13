import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { creditChoices } from '../src/engine/credits.ts'
import { addToWallet } from '../src/engine/wallet-change.ts'
import { reportStart, type ReportInput } from '../src/engine/wallet-report.ts'
import type { Wallet } from '../src/schema/wallet.ts'
import { enrollLine } from '../site/app/credit-enroll.ts'
import {
  ENDED,
  NEEDS_CONNECTION,
  NOT_SAVED,
  type LocalOp,
} from '../site/app/sync.ts'
import {
  addCard,
  answeredMarks,
  answerSaver,
  heldMarks,
  marksOp,
  removeCard,
  sameMarks,
  type Marks,
  type SaveDeps,
} from '../site/rate/answers.ts'
import { encodeReport } from '../site/rate/link.ts'
import { reportSource, type Source } from '../site/rate/source.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()

const platinum = catalog.cards.find((c) => c.id === 'amex-platinum')
if (!platinum) throw new Error('no Platinum')
const gold = catalog.cards.find((c) => c.id === 'amex-gold')
if (!gold) throw new Error('no Gold')

function saved(
  id = 'amex-platinum',
  enrolled = ['resy'],
  skippedCredits = ['equinox'],
): Wallet {
  const change = addToWallet(
    catalog,
    null,
    { id, enrolled, skippedCredits },
    TODAY,
  )
  if (!change.ok) throw new Error(change.error)
  return change.wallet
}

const NONE: Marks = { used: [], skipped: [] }

// The ids of the card's tiles on /rate, as the page lists them.
const tileIds = (wallet: Wallet, cardId: string) => {
  const held = wallet.cards.find((c) => c.id === cardId)
  const card = catalog.cards.find((c) => c.id === cardId)
  if (!held || !card) throw new Error(`no ${cardId}`)
  return creditChoices(catalog, card, held, TODAY, {}).map((c) => c.id)
}

const report = (cards: ReportInput['cards']) =>
  reportStart(catalog, { cards, memberships: [], valuations: {} }, TODAY, {
    lines: [],
    typical: true,
  })

// Storage and the network as the page would reach them, counted.
function harness(wallet: Wallet | null, synced = false) {
  const log = {
    reads: 0,
    writes: [] as Wallet[],
    sent: [] as (LocalOp | null)[],
    signedOut: 0,
  }
  let server = wallet
  const deps: SaveDeps = {
    catalog,
    today: () => TODAY,
    read: () => {
      log.reads++
      return log.writes.at(-1) ?? wallet
    },
    write: (w) => log.writes.push(w),
    synced: () => synced,
    online: () => true,
    send: (op) => {
      log.sent.push(op)
      if (op === null)
        return Promise.resolve(
          server ? { kind: 'ok', wallet: server } : { kind: 'offline' },
        )
      if (!server || op.tool !== 'update_card')
        return Promise.resolve({ kind: 'offline' })
      const { cardId, enrolled = [], skippedCredits = [] } = op.input
      server = {
        ...server,
        cards: server.cards.map((c) =>
          c.id === cardId
            ? { ...c, enrolled, skipped_credits: skippedCredits }
            : c,
        ),
      }
      return Promise.resolve({ kind: 'ok', wallet: server })
    },
    signedOut: () => log.signedOut++,
  }
  return { deps, log }
}

const throwing: SaveDeps = new Proxy({} as SaveDeps, {
  get: () => () => {
    throw new Error('touched storage')
  },
})

describe("Rate my wallet's credit answers", () => {
  test('a shared report, a bad link or one loading get no saver, and touch nothing', () => {
    const link = encodeReport(catalog, {
      input: {
        cards: [{ id: 'amex-platinum', picks: {}, used: ['resy'] }],
        memberships: [],
        valuations: {},
      },
      lines: null,
    })
    const shared = reportSource(catalog, `#${link}`, () => {
      throw new Error('read the saved wallet')
    })
    expect(shared.kind).toBe('shared')
    const others: Source[] = [
      shared,
      { kind: 'bad', message: 'gone' },
      { kind: 'loading' },
    ]
    for (const source of others)
      expect(answerSaver(source, throwing), source.kind).toBeNull()
    expect(answerSaver({ kind: 'pick', rows: null }, throwing)).not.toBeNull()
  })

  test('with no saved cards, each card tapped in is added to the saved wallet, and tapping it again takes it out', async () => {
    const { deps, log } = harness(null)
    const first = await addCard(deps, 'chase-sapphire-preferred')
    expect(first.ok).toBe(true)
    expect(log.sent).toEqual([])
    expect(log.writes.at(-1)?.cards.map((c) => c.id)).toEqual([
      'chase-sapphire-preferred',
    ])
    await addCard(deps, 'amex-blue-cash-preferred')
    expect(log.writes.at(-1)?.cards.map((c) => c.id)).toEqual([
      'chase-sapphire-preferred',
      'amex-blue-cash-preferred',
    ])
    const again = await addCard(deps, 'amex-blue-cash-preferred')
    expect(again.ok).toBe(false)
    expect(log.writes).toHaveLength(2)
    await removeCard(deps, 'amex-blue-cash-preferred')
    expect(log.writes.at(-1)?.cards.map((c) => c.id)).toEqual([
      'chase-sapphire-preferred',
    ])
    const memberships = harness({
      valuations: {},
      memberships: ['amazon-prime'],
      cards: [],
    })
    await addCard(memberships.deps, 'chase-prime-visa')
    expect(memberships.log.writes.at(-1)?.memberships).toEqual(['amazon-prime'])
  })

  test('with sync on, a card tapped in goes to the synced wallet, and nothing is written without a connection', async () => {
    const synced: Wallet = { valuations: {}, memberships: [], cards: [] }
    const on = harness(synced, true)
    on.deps.send = (op) => {
      on.log.sent.push(op)
      const change = addToWallet(catalog, synced, { id: 'amex-gold' }, TODAY)
      return Promise.resolve(
        change.ok
          ? { kind: 'ok', wallet: change.wallet }
          : { kind: 'refused', error: change.error },
      )
    }
    expect((await addCard(on.deps, 'amex-gold')).ok).toBe(true)
    expect(on.log.sent).toEqual([
      { tool: 'add_card', input: { cardId: 'amex-gold' } },
    ])
    expect(on.log.writes.at(-1)?.cards.map((c) => c.id)).toEqual(['amex-gold'])

    const offline = harness(null, true)
    offline.deps.online = () => false
    expect(await addCard(offline.deps, 'amex-gold')).toEqual({
      ok: false,
      error: NEEDS_CONNECTION,
      wallet: null,
    })
    expect(offline.log.writes).toEqual([])
  })

  test("the saved wallet's answers save through the wallet-change rules, as My wallet's Settings sends them", async () => {
    const wallet = saved()
    const held = wallet.cards[0]
    if (!held) throw new Error('no card')
    expect(heldMarks(platinum, held)).toEqual({
      used: ['resy'],
      skipped: ['equinox'],
    })
    const marks = answeredMarks(
      heldMarks(platinum, held),
      ['uber-cash', 'equinox', 'resy'],
      ['uber-cash', 'equinox'],
    )
    expect(marks).toEqual({
      used: ['uber-cash', 'equinox'],
      skipped: ['resy'],
    })
    expect(marksOp('amex-platinum', marks)).toEqual({
      tool: 'update_card',
      input: {
        cardId: 'amex-platinum',
        enrolled: ['uber-cash', 'equinox'],
        skippedCredits: ['resy'],
      },
    })
    const { deps, log } = harness(wallet)
    const save = answerSaver({ kind: 'own', wallet, rows: null }, deps)
    expect(save).not.toBeNull()
    const result = await save?.('amex-platinum', marks)
    expect(result?.ok).toBe(true)
    expect(log.sent).toEqual([])
    expect(log.writes).toHaveLength(1)
    const after = log.writes[0]?.cards[0]
    if (!after) throw new Error('not saved')
    expect(heldMarks(platinum, after)).toEqual(marks)
    expect(after.cap_usage).toEqual(held.cap_usage)
  })

  test('with sync on, the change goes to the synced wallet and the answer back is cached; signed out, nothing is written', async () => {
    const wallet = saved()
    const marks = { used: ['resy', 'clear-plus'], skipped: ['equinox'] }
    const on = harness(wallet, true)
    const save = answerSaver({ kind: 'own', wallet, rows: null }, on.deps)
    const result = await save?.('amex-platinum', marks)
    expect(result?.ok).toBe(true)
    expect(on.log.sent).toEqual([marksOp('amex-platinum', marks)])
    expect(on.log.writes).toHaveLength(1)

    const ended = harness(wallet, true)
    ended.deps.send = () => Promise.resolve({ kind: 'ended' })
    const refused = await answerSaver(
      { kind: 'own', wallet, rows: null },
      ended.deps,
    )?.('amex-platinum', marks)
    expect(refused).toEqual({ ok: false, error: ENDED, wallet })
    expect(ended.log.writes).toEqual([])
    expect(ended.log.signedOut).toBe(1)

    const offline = harness(wallet, true)
    offline.deps.online = () => false
    const later = await answerSaver(
      { kind: 'own', wallet, rows: null },
      offline.deps,
    )?.('amex-platinum', marks)
    expect(later).toEqual({ ok: false, error: NEEDS_CONNECTION, wallet })
    expect(offline.log.sent).toEqual([])
    expect(offline.log.writes).toEqual([])
  })

  test('with sync on, a change whose answer was lost is checked against the synced wallet', async () => {
    const wallet = saved()
    const marks = { used: ['resy', 'clear-plus'], skipped: ['equinox'] }
    const own = { kind: 'own', wallet, rows: null } as const

    const made = harness(wallet, true)
    const send = made.deps.send
    made.deps.send = async (op) => {
      const result = await send(op)
      return op === null ? result : { kind: 'offline' }
    }
    const landed = await answerSaver(own, made.deps)?.('amex-platinum', marks)
    expect(landed?.ok).toBe(true)
    expect(made.log.sent).toEqual([marksOp('amex-platinum', marks), null])
    const cached = made.log.writes.at(-1)?.cards[0]
    if (!cached) throw new Error('not cached')
    expect(heldMarks(platinum, cached)).toEqual(marks)

    const lost = harness(wallet, true)
    lost.deps.send = (op) =>
      Promise.resolve(
        op === null ? { kind: 'ok', wallet } : { kind: 'offline' },
      )
    expect(await answerSaver(own, lost.deps)?.('amex-platinum', marks)).toEqual(
      { ok: false, error: NOT_SAVED, wallet },
    )

    const away = harness(wallet, true)
    away.deps.send = () => Promise.resolve({ kind: 'offline' })
    expect(await answerSaver(own, away.deps)?.('amex-platinum', marks)).toEqual(
      { ok: false, error: NEEDS_CONNECTION, wallet },
    )
    expect(away.log.writes).toEqual([])
  })

  test('the first tap on a card answers all of it: that credit used, every other one not, saved as one change', async () => {
    const wallet = saved('amex-gold', [], [])
    const ids = tileIds(wallet, 'amex-gold')
    expect(ids.length).toBeGreaterThan(1)
    expect(report([{ id: 'amex-gold', picks: {} }]).range).not.toBeNull()
    const marks = answeredMarks(NONE, ids, ['uber-cash'])
    expect(marks).toEqual({
      used: ['uber-cash'],
      skipped: ids.filter((id) => id !== 'uber-cash'),
    })
    const { deps, log } = harness(wallet, true)
    const save = answerSaver({ kind: 'own', wallet, rows: null }, deps)
    expect((await save?.('amex-gold', marks))?.ok).toBe(true)
    expect(log.sent).toEqual([marksOp('amex-gold', marks)])
    expect(log.writes).toHaveLength(1)
    const held = log.writes[0]?.cards[0]
    if (!held) throw new Error('not saved')
    expect(sameMarks(heldMarks(gold, held), marks)).toBe(true)
    const after = report([{ id: 'amex-gold', picks: {}, ...marks }])
    expect(after.range).toBeNull()
    expect(
      after.creditChoices[0]?.choices.map((c) => [c.id, c.answer]),
    ).toEqual(ids.map((id) => [id, id === 'uber-cash' ? 'used' : 'skipped']))
  })

  test('All and None are one change each, with the whole card in it', async () => {
    const wallet = saved('amex-gold', [], [])
    const ids = tileIds(wallet, 'amex-gold')
    const { deps, log } = harness(wallet, true)
    const save = answerSaver({ kind: 'own', wallet, rows: null }, deps)
    const all = answeredMarks(NONE, ids, ids)
    expect(all).toEqual({ used: ids, skipped: [] })
    await save?.('amex-gold', all)
    expect(log.sent).toEqual([marksOp('amex-gold', all)])
    const none = answeredMarks(all, ids, [])
    expect(none).toEqual({ used: [], skipped: ids })
    await save?.('amex-gold', none)
    expect(log.sent).toEqual([
      marksOp('amex-gold', all),
      marksOp('amex-gold', none),
    ])
    expect(log.writes).toHaveLength(2)
    expect(report([{ id: 'amex-gold', picks: {}, ...none }]).range).toBeNull()
    expect(sameMarks(answeredMarks(none, ids, []), none)).toBe(true)
  })

  test("a card partly answered in My wallet shows what's used and stays unanswered until it's tapped", () => {
    const wallet = saved()
    const held = wallet.cards[0]
    if (!held) throw new Error('no card')
    const choices = creditChoices(catalog, platinum, held, TODAY, {})
    expect(choices.filter((c) => c.answer === 'used').map((c) => c.id)).toEqual(
      ['resy'],
    )
    expect(choices.some((c) => c.answer === null)).toBe(true)
    const was = heldMarks(platinum, held)
    expect(
      report([{ id: 'amex-platinum', picks: {}, ...was }]).range,
    ).not.toBeNull()
    const ids = choices.map((c) => c.id)
    const tapped = answeredMarks(was, ids, ['resy', 'uber-cash'])
    expect([...tapped.used].sort()).toEqual(['resy', 'uber-cash'])
    expect([...tapped.skipped].sort()).toEqual(
      ids.filter((id) => id !== 'resy' && id !== 'uber-cash').sort(),
    )
    expect(
      report([{ id: 'amex-platinum', picks: {}, ...tapped }]).range,
    ).toBeNull()
  })

  test('the enroll line reminds that used credits pay only once enrolled, with their issuer', () => {
    const held = saved('amex-gold', [], []).cards[0]
    if (!held) throw new Error('no card')
    const line = (used: string[], skipped: string[] = []) =>
      enrollLine(
        catalog,
        'amex-gold',
        creditChoices(
          catalog,
          gold,
          { ...held, enrolled: used, skipped_credits: skipped },
          TODAY,
          {},
        ),
      )
    expect(line([])).toBeNull()
    expect(line(['uber-cash'])).toBeNull()
    expect(line(['uber-cash'], ['resy', 'dining'])).toBeNull()
    expect(line(['resy'])).toBe(
      "Resy pays only once you've enrolled with American Express.",
    )
    expect(line(['uber-cash', 'resy', 'dining'])).toBe(
      "Grubhub and Resy pay only once you've enrolled with American Express.",
    )
  })
})
