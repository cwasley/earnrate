// Which link the share box hands out. The page names a short link itself,
// so its address is ready inside the tap that copies or shares it, and the
// report is saved after. A link that couldn't be made is forgotten, and
// the next tap names a new one.
import type { LinkUpdater } from '../app/report-link.ts'
import type { Source } from './source.ts'
import { shortUrl, type Saved, type Written } from './store.ts'

// Said after a tap that named a link which then couldn't be saved: its
// address may already be on the clipboard or sent, and it won't open.
export function notMade(result: Exclude<Written, 'ok'>): string {
  return result === 'full'
    ? "That link couldn't be made today, so it won't open. Try again tomorrow."
    : "That link couldn't be made just now, so it won't open. Try again in a minute."
}

// Said when a tap couldn't put the page's changes in a link that exists.
export const NOT_UPDATED =
  "That link couldn't be updated just now, so it still shows the report as it was. Try again in a minute."

export const DELETED =
  'Deleted. That link now says the report is gone, and nothing of it is kept.'

export const UNDELETED = "Couldn't delete the link: earnrate.dev didn't answer."

export type Target = {
  url: string
  fresh: Saved | null // named just now: its report still has to be saved
}

export function pickLink(
  origin: string,
  have: Saved | null,
  name: () => Saved,
): Target {
  if (have !== null) return { url: shortUrl(origin, have.id), fresh: null }
  const fresh = name()
  return { url: shortUrl(origin, fresh.id), fresh }
}

// Only the visitor's own saved wallet has a link this browser keeps and
// updates: cards tapped in, or a shared report, never do.
export function ownLink(source: Source, link: LinkUpdater): LinkUpdater | null {
  return source.kind === 'own' ? link : null
}

export type PageLinkDeps = {
  name: () => Saved
  write: (link: Saved, report: string) => Promise<Written>
  remove: (link: Saved) => Promise<boolean>
}

// What a tap's write said: null when the link holds the report.
export type Tapped = string | null

// Cards tapped in on /rate get one link for the page's session, kept only
// in its memory with its delete key. The first Copy link or Share names it;
// a later one after a change rewrites it with the key, as the visitor's own
// link is, so Delete my link leaves nothing behind. Writes go one at a time.
export function pageLink(deps: PageLinkDeps) {
  let link: Saved | null = null
  let made = false // the server has it
  let asked: string | null = null // the report last written, or on its way
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => undefined)
    return next
  }

  const tap = (
    origin: string,
    report: string,
  ): { url: string; done: Promise<Tapped> } => {
    link ??= deps.name()
    const saved = link
    const url = shortUrl(origin, saved.id)
    if (report === asked) return { url, done: Promise.resolve(null) }
    asked = report
    const done = serial(async (): Promise<Tapped> => {
      const update = made && link === saved
      const result = await deps.write(saved, report)
      if (result === 'ok') {
        if (link === null) link = saved
        if (link === saved) made = true
        // Named again after this one failed: this copy isn't wanted.
        else await deps.remove(saved)
        return null
      }
      if (asked === report) asked = null
      if (link === saved && !made) link = null
      return update ? NOT_UPDATED : notMade(result)
    })
    return { url, done }
  }

  const remove = (): Promise<boolean> => {
    const saved = link
    if (saved === null) return Promise.resolve(true)
    return serial(async () => {
      const ok = await deps.remove(saved)
      if (ok && link === saved) {
        link = null
        made = false
        asked = null
      }
      return ok
    })
  }

  return {
    current: (): Saved | null => link,
    // Whether the link has, or is getting, this report.
    holds: (report: string): boolean => link !== null && asked === report,
    tap,
    remove,
  }
}
