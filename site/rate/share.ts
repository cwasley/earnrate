// Which link the share box hands out. The page names a short link itself,
// so its address is ready inside the tap that copies or shares it, and the
// report is saved after. Once a short link couldn't be made for a report,
// the box hands out the link that isn't saved anywhere for it instead.
import type { LinkUpdater } from '../app/report-link.ts'
import type { Source } from './source.ts'
import { shortUrl, type Saved } from './store.ts'

export type Have = Saved | 'unavailable' | null

export const NO_SHORT_LINK =
  "A short link can't be made right now. This link opens the same report, and isn't saved anywhere:"

export const DEAD_LINK =
  "That short link couldn't be saved, so it won't open. This one opens the same report, and isn't saved anywhere:"

export const longUrl = (origin: string, report: string) =>
  `${origin}/rate#w=${report}`

export type Target = {
  url: string
  short: boolean
  fresh: Saved | null // named just now: its report still has to be saved
}

export function pickLink(
  origin: string,
  report: string,
  have: Have,
  name: () => Saved,
): Target {
  if (have === 'unavailable')
    return { url: longUrl(origin, report), short: false, fresh: null }
  if (have !== null)
    return { url: shortUrl(origin, have.id), short: true, fresh: null }
  const fresh = name()
  return { url: shortUrl(origin, fresh.id), short: true, fresh }
}

// Only the visitor's own saved wallet has a link this browser keeps and
// updates: cards tapped in, or a shared report, never do.
export function ownLink(source: Source, link: LinkUpdater): LinkUpdater | null {
  return source.kind === 'own' ? link : null
}
