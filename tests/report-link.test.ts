import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { addToWallet, updateInWallet } from '../src/engine/wallet-change.ts'
import type { Wallet } from '../src/schema/wallet.ts'
import {
  linkUpdater,
  parseLink,
  RETRY_MS,
  SETTLE_MS,
  STALE,
  type MyLink,
} from '../site/app/report-link.ts'
import { decodeReport } from '../site/rate/link.ts'
import { ownReport, spendingLines } from '../site/rate/own-report.ts'
import type { Saved, Written } from '../site/rate/store.ts'
import { newId, newKey } from '../site/report-ids.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()

function wallet(...ids: string[]): Wallet {
  let w: Wallet | null = null
  for (const id of ids) {
    const change = addToWallet(catalog, w, { id }, TODAY)
    if (!change.ok) throw new Error(change.error)
    w = change.wallet
  }
  if (!w) throw new Error('no wallet')
  return w
}

// A browser: its saved link and report, and a server that answers writes.
function browser(answers: Written[] = []) {
  let saved: string | null = null
  let report: string | null = 'R1'
  const writes: { link: Saved; report: string; keepalive: boolean }[] = []
  const removed: Saved[] = []
  let pending: (() => void)[] = []
  let hold = false
  const updater = linkUpdater({
    load: () => parseLink(saved),
    store: (l) => {
      saved = l === null ? null : JSON.stringify(l)
    },
    current: (spending) =>
      report === null ? null : spending ? `${report}+spend` : report,
    write: (link, r, keepalive = false) => {
      writes.push({ link, report: r, keepalive })
      const answer = answers.shift() ?? 'ok'
      if (!hold) return Promise.resolve(answer)
      return new Promise((resolve) => {
        pending.push(() => {
          resolve(answer)
        })
      })
    },
    remove: (link) => {
      removed.push(link)
      return Promise.resolve(true)
    },
    later: (fn, ms) => setTimeout(fn, ms),
    cancel: (t) => {
      clearTimeout(t as ReturnType<typeof setTimeout>)
    },
  })
  return {
    updater,
    writes,
    removed,
    link: () => parseLink(saved),
    raw: () => saved,
    setReport: (r: string | null) => {
      report = r
    },
    hold: (on: boolean) => {
      hold = on
    },
    release: () => {
      const p = pending
      pending = []
      for (const fn of p) fn()
    },
  }
}

const settle = async (ms = SETTLE_MS) => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('your own report link', () => {
  test('making a link writes it once and remembers only its id, key, spending choice and report', async () => {
    const b = browser()
    const link = { id: newId(), key: newKey() }
    expect(await b.updater.make(link, true)).toBe('ok')
    expect(b.writes).toEqual([{ link, report: 'R1+spend', keepalive: false }])
    expect(JSON.parse(b.raw() ?? '')).toEqual({
      ...link,
      spending: true,
      sent: 'R1+spend',
    })
  })

  test('a failed first write forgets the link, whatever the reason', async () => {
    for (const answer of ['busy', 'full', 'refused', 'offline'] as const) {
      const b = browser([answer])
      expect(await b.updater.make({ id: newId(), key: newKey() }, false)).toBe(
        answer,
      )
      expect(b.link(), answer).toBeNull()
      b.setReport('R2')
      b.updater.changed()
      await settle()
      expect(b.writes, answer).toHaveLength(1)
    }
  })

  test('a run of changes is one write, a few seconds after the last', async () => {
    const b = browser()
    await b.updater.make({ id: newId(), key: newKey() }, false)
    for (const r of ['R2', 'R3', 'R4']) {
      b.setReport(r)
      b.updater.changed()
      await settle(SETTLE_MS - 1000)
    }
    expect(b.writes).toHaveLength(1)
    await settle(1000)
    expect(b.writes.map((w) => w.report)).toEqual(['R1', 'R4'])
    expect(b.link()?.sent).toBe('R4')
  })

  test('a change that leaves the report as it was sends nothing', async () => {
    const b = browser()
    await b.updater.make({ id: newId(), key: newKey() }, false)
    b.setReport('R2')
    b.setReport('R1')
    b.updater.changed()
    await settle()
    expect(b.writes).toHaveLength(1)
  })

  test('one write at a time: changes during a write go in the next one', async () => {
    const b = browser()
    await b.updater.make({ id: newId(), key: newKey() }, false)
    b.hold(true)
    b.setReport('R2')
    b.updater.changed()
    await settle()
    expect(b.writes).toHaveLength(2)
    b.setReport('R3')
    b.updater.changed()
    await settle()
    b.setReport('R4')
    b.updater.changed()
    await settle()
    expect(b.writes).toHaveLength(2)
    b.hold(false)
    b.release()
    await settle(0)
    expect(b.writes.map((w) => w.report)).toEqual(['R1', 'R2', 'R4'])
    expect(b.link()?.sent).toBe('R4')
  })

  test('when busy it tries again later, and says so only if it keeps failing', async () => {
    const b = browser(['ok', 'busy', 'busy', 'offline', 'ok'])
    const states: (string | null)[] = []
    b.updater.subscribe((s) => states.push(s.trouble))
    await b.updater.make({ id: newId(), key: newKey() }, false)
    b.setReport('R2')
    b.updater.changed()
    await settle()
    expect(b.writes).toHaveLength(2)
    expect(b.updater.state().trouble).toBeNull()
    await settle(RETRY_MS[0])
    expect(b.writes).toHaveLength(3)
    expect(b.updater.state().trouble).toBeNull()
    await settle(RETRY_MS[1])
    expect(b.writes).toHaveLength(4)
    expect(b.updater.state().trouble).toBe(STALE)
    await settle(RETRY_MS[2])
    expect(b.writes).toHaveLength(5)
    expect(b.updater.state().trouble).toBeNull()
    expect(b.link()?.sent).toBe('R2')
    expect(states).toContain(STALE)
  })

  test("a report the server refuses isn't sent again until it changes", async () => {
    const b = browser(['ok', 'refused'])
    await b.updater.make({ id: newId(), key: newKey() }, false)
    b.setReport('R2')
    b.updater.changed()
    await settle()
    expect(b.updater.state().trouble).toBe(STALE)
    b.updater.changed()
    await settle(RETRY_MS.reduce((a, c) => a + c, 0))
    expect(b.writes).toHaveLength(2)
    b.setReport('R3')
    b.updater.changed()
    await settle()
    expect(b.writes.map((w) => w.report)).toEqual(['R1', 'R2', 'R3'])
    expect(b.updater.state().trouble).toBeNull()
  })

  test('ticking spending in or out updates the link', async () => {
    const b = browser()
    await b.updater.make({ id: newId(), key: newKey() }, false)
    b.updater.setSpending(true)
    await settle()
    expect(b.writes.map((w) => w.report)).toEqual(['R1', 'R1+spend'])
    expect(b.link()?.spending).toBe(true)
  })

  test('delete removes it on the server and forgets it here, after any write under way', async () => {
    const b = browser()
    const link = { id: newId(), key: newKey() }
    await b.updater.make(link, false)
    b.hold(true)
    b.setReport('R2')
    b.updater.changed()
    await settle()
    const done = b.updater.remove()
    await settle(0)
    expect(b.removed).toEqual([])
    b.hold(false)
    b.release()
    expect(await done).toBe(true)
    expect(b.removed).toEqual([link])
    expect(b.link()).toBeNull()
    b.setReport('R3')
    b.updater.changed()
    await settle()
    expect(b.writes).toHaveLength(2)
  })

  test('a change waiting when delete is pressed is never sent', async () => {
    const b = browser()
    await b.updater.make({ id: newId(), key: newKey() }, false)
    b.setReport('R2')
    b.updater.changed()
    await b.updater.remove()
    await settle()
    expect(b.writes).toHaveLength(1)
    expect(b.link()).toBeNull()
  })

  test('an emptied wallet deletes the link', async () => {
    const b = browser()
    const link = { id: newId(), key: newKey() }
    await b.updater.make(link, false)
    b.setReport(null)
    b.updater.changed()
    await settle()
    expect(b.removed).toEqual([link])
    expect(b.link()).toBeNull()
    expect(b.writes).toHaveLength(1)
  })

  test("with no link, changes send nothing and nothing's stored", async () => {
    const b = browser()
    b.setReport('R2')
    b.updater.changed()
    b.updater.flush()
    b.updater.setSpending(true)
    await settle(60_000)
    expect(b.writes).toEqual([])
    expect(b.raw()).toBeNull()
  })

  test('leaving the page sends a waiting write at once, one that outlives the page', async () => {
    const b = browser()
    await b.updater.make({ id: newId(), key: newKey() }, false)
    b.setReport('R2')
    b.updater.changed()
    b.updater.flush()
    await settle(0)
    expect(b.writes.at(-1)).toMatchObject({ report: 'R2', keepalive: true })
    await settle()
    expect(b.writes).toHaveLength(2)
  })

  test('a saved link that is damaged reads as none', () => {
    const good: MyLink = {
      id: newId(),
      key: newKey(),
      spending: false,
      sent: null,
    }
    expect(parseLink(JSON.stringify(good))).toEqual(good)
    for (const raw of [
      null,
      'nope',
      '[]',
      JSON.stringify({ ...good, id: 'abc' }),
      JSON.stringify({ ...good, key: 'short' }),
    ])
      expect(parseLink(raw), String(raw)).toBeNull()
  })
})

describe("your link's report", () => {
  test("it carries the saved wallet's cards, picks, credit answers, memberships and point values", () => {
    let w = wallet('amex-platinum', 'citi-custom-cash')
    const change = updateInWallet(
      catalog,
      w,
      { id: 'amex-platinum', enrolled: ['resy'], skippedCredits: ['equinox'] },
      TODAY,
    )
    if (!change.ok) throw new Error(change.error)
    w = {
      ...change.wallet,
      memberships: ['amazon-prime'],
      valuations: { MR: 1.6 },
    }
    const report = ownReport(catalog, w, null, true)
    if (report === null) throw new Error('no report')
    const decoded = decodeReport(catalog, `w=${report}`)
    if (!decoded.ok) throw new Error(decoded.message)
    expect(decoded.link.lines).toBeNull()
    expect(decoded.link.input.memberships).toEqual(['amazon-prime'])
    expect(decoded.link.input.valuations).toEqual({ MR: 1.6 })
    const plat = decoded.link.input.cards.find((c) => c.id === 'amex-platinum')
    expect(plat?.used).toContain('resy')
    expect(plat?.skipped).toContain('equinox')
    expect(decoded.link.input.cards.map((c) => c.id)).toEqual([
      'amex-platinum',
      'citi-custom-cash',
    ])
  })

  test('spending goes in only when ticked, and only when it is the person’s own', () => {
    const w = wallet('amex-gold')
    const rows = [
      { what: 'Dining', monthly: 402 },
      { what: 'Groceries', monthly: 600 },
    ]
    expect(ownReport(catalog, w, rows, false)).not.toContain('///')
    const withSpend = ownReport(catalog, w, rows, true) ?? ''
    const decoded = decodeReport(catalog, `w=${withSpend}`)
    expect(decoded.ok && decoded.link.lines?.map((l) => l.monthly)).toEqual([
      400, 600,
    ])
    expect(spendingLines(catalog, null)).toBeNull()
  })

  test('a wallet with no card earnrate lists makes no report', () => {
    expect(ownReport(catalog, null, null, false)).toBeNull()
    const w = wallet('amex-gold')
    expect(ownReport(catalog, { ...w, cards: [] }, null, false)).toBeNull()
    expect(
      ownReport(
        catalog,
        { ...w, cards: [{ id: 'no-such-card', cap_usage: {}, activated: [] }] },
        null,
        false,
      ),
    ).toBeNull()
  })
})
