// Which link the share box hands out. Once earnrate.dev hasn't made a short
// link for a report, the box offers the link that isn't saved anywhere for
// it, and asks for a short one again only when the report changes.
import { shortUrl, type Saved } from './store.ts'

export type Attempt = Saved | 'unavailable'

export const NO_SHORT_LINK =
  "A short link can't be made right now. This link opens the same report, and isn't saved anywhere:"

export const longUrl = (origin: string, report: string) =>
  `${origin}/rate#w=${report}`

// The link for a report once a short one has been asked for.
export function linkFor(
  origin: string,
  report: string,
  attempt: Attempt,
): { url: string; short: boolean } {
  return attempt === 'unavailable'
    ? { url: longUrl(origin, report), short: false }
    : { url: shortUrl(origin, attempt.id), short: true }
}
