// The visitor's own short report link. This browser keeps its id, its
// delete key, whether spending goes in it and the report last written, and
// rewrites the report when the saved wallet changes: a few seconds after
// the last change, one request at a time, and only when the report is
// different. An emptied wallet deletes the link.
import { ID, KEY } from '../report-ids.ts'
import type { Saved, Written } from '../rate/store.ts'

export const LINK_KEY = 'earnrate:report-link'

export type MyLink = Saved & {
  spending: boolean
  sent: string | null // the report the link holds, as far as this browser knows
}

export function parseLink(raw: string | null): MyLink | null {
  try {
    const v: unknown = raw === null ? null : JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const { id, key, spending, sent } = v as Partial<MyLink>
    if (typeof id !== 'string' || !ID.test(id)) return null
    if (typeof key !== 'string' || !KEY.test(key)) return null
    return {
      id,
      key,
      spending: spending === true,
      sent: typeof sent === 'string' ? sent : null,
    }
  } catch {
    return null
  }
}

export const STALE =
  "Your link couldn't be updated just now, so it still shows your wallet as it was."

// Wait this long after the last change, so a run of credit taps is one write.
export const SETTLE_MS = 3000
// After a refusal for being busy, or no answer. Then it waits for the next
// change, or the next visit.
export const RETRY_MS = [10_000, 30_000, 60_000, 120_000, 300_000]
// Failed writes in a row before the page says so.
const TROUBLE_AFTER = 3

export type LinkState = { link: MyLink | null; trouble: string | null }

export type LinkDeps = {
  load: () => MyLink | null
  store: (link: MyLink | null) => void
  // The saved wallet's report, or null when it holds no cards.
  current: (spending: boolean) => string | null
  write: (link: Saved, report: string, keepalive?: boolean) => Promise<Written>
  remove: (link: Saved) => Promise<boolean>
  later: (fn: () => void, ms: number) => unknown
  cancel: (timer: unknown) => void
}

export type LinkUpdater = ReturnType<typeof linkUpdater>

export function linkUpdater(deps: LinkDeps) {
  let timer: unknown = null
  let chain: Promise<unknown> = Promise.resolve()
  let queued = false
  let failures = 0
  let refused: string | null = null // a report the server won't take
  let trouble: string | null = null
  let deleting = false
  const listeners = new Set<(s: LinkState) => void>()

  const bare = (l: Saved): Saved => ({ id: l.id, key: l.key })
  const state = (): LinkState => ({ link: deps.load(), trouble })
  const tell = () => {
    const s = state()
    for (const fn of listeners) fn(s)
  }
  const setTrouble = (t: string | null) => {
    if (t === trouble) return
    trouble = t
    tell()
  }
  // One request at a time, in the order asked.
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => undefined)
    return next
  }
  const stop = () => {
    if (timer !== null) deps.cancel(timer)
    timer = null
  }
  const wait = (ms: number) => {
    stop()
    timer = deps.later(() => {
      timer = null
      void update()
    }, ms)
  }

  const send = async (keepalive: boolean): Promise<void> => {
    queued = false
    const link = deps.load()
    if (!link || deleting) return
    const report = deps.current(link.spending)
    if (report === null) {
      await drop(link)
      return
    }
    if (report === link.sent) {
      failures = 0
      setTrouble(null)
      return
    }
    if (report === refused) return
    const result = await deps.write(bare(link), report, keepalive)
    const now = deps.load()
    if (now?.id !== link.id) return
    if (result === 'ok') {
      failures = 0
      deps.store({ ...now, sent: report })
      setTrouble(null)
      tell()
      return
    }
    if (result === 'refused') {
      refused = report
      setTrouble(STALE)
      return
    }
    failures++
    if (failures >= TROUBLE_AFTER) setTrouble(STALE)
    const retry = RETRY_MS[failures - 1]
    if (retry !== undefined) wait(retry)
  }

  // Coalesced: a write already waiting picks up the latest wallet.
  const update = (keepalive = false): Promise<void> => {
    if (queued) return chain.then(() => undefined)
    queued = true
    return serial(() => send(keepalive))
  }

  const drop = async (link: Saved): Promise<boolean> => {
    stop()
    const ok = await deps.remove(bare(link))
    if (ok && deps.load()?.id === link.id) deps.store(null)
    if (ok) {
      refused = null
      failures = 0
      trouble = null
    }
    tell()
    return ok
  }

  // The saved wallet, or what goes in the link, changed.
  const changed = (): void => {
    if (deleting || deps.load() === null) return
    failures = 0
    wait(SETTLE_MS)
  }

  // The page is going away: a waiting write goes now, and outlives it.
  const flush = (): void => {
    if (timer === null) return
    stop()
    void update(true)
  }

  // The first write of a link the page just named. On any failure it's
  // forgotten, so it never updates a link that doesn't exist.
  const make = (link: Saved, spending: boolean): Promise<Written> => {
    const report = deps.current(spending)
    if (report === null) return Promise.resolve('refused')
    stop()
    refused = null
    failures = 0
    trouble = null
    deps.store({ ...link, spending, sent: null })
    tell()
    return serial(async () => {
      const result = await deps.write(bare(link), report)
      const now = deps.load()
      if (now?.id === link.id) {
        if (result === 'ok') deps.store({ ...now, sent: report })
        else deps.store(null)
      }
      tell()
      if (result === 'ok') changed()
      return result
    })
  }

  const setSpending = (on: boolean): void => {
    const link = deps.load()
    if (!link || link.spending === on) return
    deps.store({ ...link, spending: on })
    tell()
    changed()
  }

  // Waits for a write under way, so it can't make the link again after.
  const remove = (): Promise<boolean> => {
    const link = deps.load()
    if (!link) return Promise.resolve(true)
    stop()
    deleting = true
    return serial(async () => {
      try {
        return await drop(link)
      } finally {
        deleting = false
      }
    })
  }

  const subscribe = (fn: (s: LinkState) => void): (() => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }

  return {
    state,
    report: deps.current,
    subscribe,
    changed,
    flush,
    make,
    setSpending,
    remove,
  }
}
