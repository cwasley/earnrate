import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { addToWallet } from '../src/engine/wallet-change.ts'
import type { Wallet } from '../src/schema/wallet.ts'
import { ENDED, NEEDS_CONNECTION, type LocalOp } from '../site/app/sync.ts'
import {
  answerSaver,
  heldMarks,
  marksOp,
  withAnswer,
  type SaveDeps,
} from '../site/rate/answers.ts'
import { encodeReport } from '../site/rate/link.ts'
import { reportSource, type Source } from '../site/rate/source.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()

const platinum = catalog.cards.find((c) => c.id === 'amex-platinum')
if (!platinum) throw new Error('no Platinum')

function saved(): Wallet {
  const change = addToWallet(
    catalog,
    null,
    { id: 'amex-platinum', enrolled: ['resy'], skippedCredits: ['equinox'] },
    TODAY,
  )
  if (!change.ok) throw new Error(change.error)
  return change.wallet
}

// Storage and the network as the page would reach them, counted.
function harness(wallet: Wallet | null, synced = false) {
  const log = {
    reads: 0,
    writes: [] as Wallet[],
    sent: [] as LocalOp[],
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
  test('a shared report, cards tapped in, a bad link or one loading get no saver, and touch nothing', () => {
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
      { kind: 'pick', rows: null },
      { kind: 'bad', message: 'gone' },
      { kind: 'loading' },
    ]
    for (const source of others)
      expect(answerSaver(source, throwing), source.kind).toBeNull()
  })

  test("the saved wallet's answers save through the wallet-change rules, as My wallet's Settings sends them", async () => {
    const wallet = saved()
    const held = wallet.cards[0]
    if (!held) throw new Error('no card')
    expect(heldMarks(platinum, held)).toEqual({
      used: ['resy'],
      skipped: ['equinox'],
    })
    const marks = withAnswer(
      withAnswer(heldMarks(platinum, held), ['uber-cash', 'equinox'], 'used'),
      ['resy'],
      null,
    )
    expect(marks).toEqual({ used: ['uber-cash', 'equinox'], skipped: [] })
    expect(marksOp('amex-platinum', marks)).toEqual({
      tool: 'update_card',
      input: {
        cardId: 'amex-platinum',
        enrolled: ['uber-cash', 'equinox'],
        skippedCredits: [],
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
})
