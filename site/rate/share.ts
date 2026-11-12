// Which link the share box hands out. The page names a short link itself,
// so its address is ready inside the tap that copies or shares it, and the
// report is saved after. A link that couldn't be saved is forgotten, and
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
