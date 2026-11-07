import { describe, expect, test } from 'vitest'
import {
  addToWallet,
  removeFromWallet,
  updateInWallet,
  withMemberships,
  withValuations,
} from '../src/engine/wallet-change.ts'
import { loadCatalog } from '../src/data/load.ts'
import type { Wallet } from '../src/schema/wallet.ts'
import { SYNC_HEADER } from '../site/api.ts'
import {
  addOp,
  applyLocally,
  combineOps,
  editState,
  firstConnection,
  heldToInput,
  importOp,
  membershipsOp,
  pointValueOp,
  removeOp,
  syncRequest,
  syncReturn,
  updateOp,
  type LocalOp,
} from '../site/app/sync.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()

const walletWith = (...ids: string[]): Wallet => {
  let w: Wallet | null = null
  for (const id of ids) {
    const change = addToWallet(catalog, w, { id }, TODAY)
    if (!change.ok) throw new Error(change.error)
    w = change.wallet
  }
  return w ?? { valuations: {}, memberships: [], cards: [] }
}

const run = (wallet: Wallet | null, ops: LocalOp[]): Wallet => {
  let w = wallet
  for (const op of ops) {
    const change = applyLocally(catalog, w, op, TODAY)
    if (!change.ok) throw new Error(change.error)
    w = change.wallet
  }
  if (!w) throw new Error('no wallet')
  return w
}

describe('the operation each control produces', () => {
  test('controls produce the hosted API change format', () => {
    expect(addOp('amex-gold')).toEqual({
      tool: 'add_card',
      input: { cardId: 'amex-gold' },
    })
    expect(
      updateOp({
        id: 'amex-gold',
        activated: [],
        opened: null,
        bonus: { opened: '2026-09-01', spent: 500 },
      }),
    ).toEqual({
      tool: 'update_card',
      input: {
        cardId: 'amex-gold',
        activated: [],
        opened: null,
        bonus: { opened: '2026-09-01', spent: 500 },
      },
    })
    expect(removeOp('amex-gold')).toEqual({
      tool: 'remove_card',
      input: { cardId: 'amex-gold' },
    })
    expect(membershipsOp(['costco'])).toEqual({
      tool: 'set_memberships',
      input: { memberships: ['costco'] },
    })
    expect(pointValueOp('MR', 1.6)).toEqual({
      tool: 'set_point_values',
      input: { values: { MR: 1.6 } },
    })
    expect(pointValueOp('MR', null).input).toEqual({ values: { MR: null } })
    expect(importOp('cards: []\n')).toEqual({
      tool: 'import_wallet',
      input: { yaml: 'cards: []\n', replace: true },
    })
  })

  test('applied locally, each one does what the old control computed', () => {
    const base = walletWith('amex-gold', 'usbank-cash-plus')
    const update = {
      id: 'usbank-cash-plus',
      picks: { 'five-percent': ['fast-food', 'cell-phone'] },
      activated: [],
    }
    const cases: [LocalOp, ReturnType<typeof applyLocally>][] = [
      [
        addOp('citi-double-cash'),
        addToWallet(catalog, base, { id: 'citi-double-cash' }, TODAY),
      ],
      [updateOp(update), updateInWallet(catalog, base, update, TODAY)],
      [removeOp('amex-gold'), removeFromWallet(base, 'amex-gold')],
      [membershipsOp(['costco']), withMemberships(catalog, base, ['costco'])],
      [pointValueOp('MR', 1.6), withValuations(catalog, base, { MR: 1.6 })],
    ]
    for (const [op, expected] of cases)
      expect(applyLocally(catalog, base, op, TODAY), op.tool).toEqual(expected)
  })

  test('refusals locally are the shared rules’ refusals', () => {
    const base = walletWith('amex-gold')
    const refused = applyLocally(
      catalog,
      base,
      removeOp('citi-double-cash'),
      TODAY,
    )
    expect(refused).toEqual(removeFromWallet(base, 'citi-double-cash'))
    expect(refused.ok).toBe(false)
    expect(applyLocally(catalog, null, addOp('not-a-card'), TODAY).ok).toBe(
      false,
    )
    expect(
      applyLocally(catalog, null, membershipsOp(['costco']), TODAY),
    ).toMatchObject({ ok: true, wallet: { memberships: ['costco'] } })
  })
})

describe('combining two wallets', () => {
  test('every card from both, Claude’s settings where a card is in both', () => {
    const claude = run(walletWith('amex-gold'), [
      updateOp({ id: 'amex-gold', checkoutLabel: 'Claude Gold' }),
      membershipsOp(['amazon-prime']),
      pointValueOp('MR', 2),
    ])
    const browser = run(walletWith('amex-gold', 'usbank-cash-plus'), [
      updateOp({ id: 'amex-gold', checkoutLabel: 'Browser Gold' }),
      updateOp({
        id: 'usbank-cash-plus',
        checkoutLabel: 'Cash+',
        picks: { 'five-percent': ['fast-food', 'cell-phone'] },
        capSpent: { 'five-percent-combined': 400 },
        bonus: { opened: '2026-09-01', spent: 250 },
      }),
      membershipsOp(['costco']),
      pointValueOp('MR', 1.2),
    ])
    const ops = combineOps(catalog, claude, browser, TODAY)
    expect(ops.map((o) => o.tool)).toEqual(['add_card', 'set_memberships'])
    const combined = run(claude, ops)
    expect(combined.cards.map((c) => c.id)).toEqual([
      'amex-gold',
      'usbank-cash-plus',
    ])
    expect(combined.cards[0]?.checkout_label).toBe('Claude Gold')
    expect(combined.cards[1]).toEqual(browser.cards[1])
    expect(combined.memberships.sort()).toEqual(['amazon-prime', 'costco'])
    expect(combined.valuations).toEqual({ MR: 2 })
  })

  test("an earlier period's picks and totals don't carry over", () => {
    const browser = run(walletWith('usbank-cash-plus'), [
      updateOp({
        id: 'usbank-cash-plus',
        picks: { 'five-percent': ['fast-food', 'cell-phone'] },
        capSpent: { 'five-percent-combined': 400 },
      }),
    ])
    const held = browser.cards[0]
    if (!held) throw new Error('no card')
    const nextQuarter = '2027-01-05'
    expect(heldToInput(catalog, held, TODAY)).toMatchObject({
      picks: { 'five-percent': ['fast-food', 'cell-phone'] },
      capSpent: { 'five-percent-combined': 400 },
    })
    const later = heldToInput(catalog, held, nextQuarter)
    expect(later.picks).toBeUndefined()
    expect(later.capSpent).toBeUndefined()
  })

  test('nothing to send when the browser adds nothing', () => {
    const claude = run(walletWith('amex-gold'), [membershipsOp(['costco'])])
    expect(combineOps(catalog, claude, walletWith('amex-gold'), TODAY)).toEqual(
      [],
    )
  })
})

describe('the first connection', () => {
  const empty: Wallet = { valuations: {}, memberships: [], cards: [] }

  test('asks only when both sides have different cards', () => {
    expect(
      firstConnection(walletWith('amex-gold'), walletWith('citi-double-cash')),
    ).toBe('ask')
    expect(
      firstConnection(walletWith('amex-gold'), walletWith('amex-gold')),
    ).toBe('same')
    expect(firstConnection(walletWith('amex-gold'), null)).toBe('claude')
    expect(firstConnection(walletWith('amex-gold'), empty)).toBe('claude')
    expect(firstConnection(empty, walletWith('amex-gold'))).toBe('browser')
    expect(firstConnection(empty, null)).toBe('same')
    const settingsOnly = run(null, [membershipsOp(['costco'])])
    expect(firstConnection(empty, settingsOnly)).toBe('browser')
    expect(firstConnection(walletWith('amex-gold'), settingsOnly)).toBe(
      'claude',
    )
  })
})

describe('the return address and the offline flag', () => {
  test('sign-in results are read once and dropped from the address', () => {
    expect(syncReturn('#wallet&sync=on')).toEqual({
      sync: 'on',
      hash: '#wallet',
    })
    expect(syncReturn('#wallet&sync=canceled').sync).toBe('canceled')
    expect(syncReturn('#wallet&sync=failed').sync).toBe('failed')
    expect(syncReturn('#wallet&sync=evil')).toEqual({
      sync: null,
      hash: '#wallet',
    })
    expect(syncReturn('#best=costco')).toEqual({
      sync: null,
      hash: '#best=costco',
    })
    expect(syncReturn('')).toEqual({ sync: null, hash: '' })
  })

  test('synced and offline, changes are locked with a reason', () => {
    expect(editState({ synced: true, online: false, busy: false })).toEqual({
      locked: true,
      note: 'Changes need a connection.',
    })
    expect(editState({ synced: false, online: false, busy: false })).toEqual({
      locked: false,
      note: null,
    })
    expect(editState({ synced: true, online: true, busy: true })).toEqual({
      locked: true,
      note: null,
    })
    expect(editState({ synced: true, online: true, busy: false }).locked).toBe(
      false,
    )
  })
})

describe('talking to /api/wallet', () => {
  const answer =
    (status: number, body: unknown, seen: RequestInit[] = []) =>
    (url: string, init: RequestInit) => {
      expect(url).toBe('/api/wallet')
      seen.push(init)
      return Promise.resolve(
        new Response(body === null ? null : JSON.stringify(body), { status }),
      )
    }

  test('a change is one POST with the sync header, and nothing else', async () => {
    const seen: RequestInit[] = []
    const wallet = walletWith('amex-gold')
    const result = await syncRequest(
      addOp('amex-gold'),
      answer(200, { message: 'Added', wallet, summary: {} }, seen),
    )
    expect(result).toEqual({
      kind: 'ok',
      wallet: { valuations: {}, memberships: [], cards: wallet.cards },
    })
    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.headers).toEqual({
      [SYNC_HEADER]: '1',
      'content-type': 'application/json',
    })
    expect(JSON.parse(seen[0]?.body as string)).toEqual(addOp('amex-gold'))
    await syncRequest(null, answer(200, { wallet, summary: {} }, seen))
    expect(seen[1]?.method).toBe('GET')
    expect(seen[1]?.body).toBeUndefined()
  })

  test('each answer becomes what the page shows', async () => {
    expect(
      await syncRequest(
        removeOp('x'),
        answer(422, { error: "x isn't in the wallet." }),
      ),
    ).toEqual({ kind: 'refused', error: "x isn't in the wallet." })
    expect(
      await syncRequest(null, answer(401, { error: 'not-synced' })),
    ).toEqual({ kind: 'ended' })
    expect(await syncRequest(null, answer(429, null))).toEqual({
      kind: 'limited',
    })
    expect(
      await syncRequest(null, answer(503, { error: 'unreachable' })),
    ).toEqual({ kind: 'offline' })
    expect(
      await syncRequest(null, () => Promise.reject(new TypeError('offline'))),
    ).toEqual({ kind: 'offline' })
  })
})
