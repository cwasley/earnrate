// The page's only requests: writing a report under a short link the page
// names (made when someone presses Copy link or Share, then updated by the
// browser that made it), reading one by its id, and deleting one with the
// key that made it. Nothing else goes with them: no cookie, and the id is
// the only thing a read sends.
import {
  DELETE_HEADER,
  ID_ALPHABET,
  ID_HEADER,
  ID_LENGTH,
  newId,
  newKey,
  REPORT_HEADER,
} from '../report-ids.ts'
import { FULL } from '../reports.ts'

export type Saved = { id: string; key: string }

const HEADERS = { [REPORT_HEADER]: '1' }

const ID = new RegExp(`^/r/([${ID_ALPHABET}]{${String(ID_LENGTH)}})/?$`)

// The id in /r/<id>, or null on any other address.
export function storedId(pathname: string): string | null {
  return ID.exec(pathname)?.[1] ?? null
}

export const shortUrl = (origin: string, id: string) => `${origin}/r/${id}`

export const newLink = (): Saved => ({ id: newId(), key: newKey() })

// How a write went: 'busy' and 'offline' may go through later; 'full' (the
// site's links for the day) and 'refused' won't for this report.
export type Written = 'ok' | 'busy' | 'full' | 'refused' | 'offline'

// `report` is the w= link's contents without the "w=". An unused id is
// made; a used one is replaced, with its key.
export async function writeReport(
  saved: Saved,
  report: string,
  keepalive = false,
): Promise<Written> {
  try {
    const res = await fetch('/r', {
      method: 'POST',
      credentials: 'omit',
      keepalive,
      headers: {
        ...HEADERS,
        [ID_HEADER]: saved.id,
        [DELETE_HEADER]: saved.key,
        'content-type': 'text/plain',
      },
      body: report,
    })
    if (res.ok) return 'ok'
    if (res.status === 429) return 'busy'
    if (res.status === 503)
      return (await res.text()) === FULL ? 'full' : 'offline'
    return res.status >= 500 ? 'offline' : 'refused'
  } catch {
    return 'offline'
  }
}

export type Loaded =
  { kind: 'found'; report: string } | { kind: 'gone' } | { kind: 'offline' }

export async function loadReport(id: string): Promise<Loaded> {
  try {
    const res = await fetch(`/r/${id}/data`, {
      credentials: 'omit',
      headers: HEADERS,
    })
    if (res.status === 404) return { kind: 'gone' }
    return res.ok
      ? { kind: 'found', report: await res.text() }
      : { kind: 'offline' }
  } catch {
    return { kind: 'offline' }
  }
}

export async function deleteReport(saved: Saved): Promise<boolean> {
  try {
    const res = await fetch(`/r/${saved.id}`, {
      method: 'DELETE',
      credentials: 'omit',
      headers: { ...HEADERS, [DELETE_HEADER]: saved.key },
    })
    return res.status === 204 || res.status === 404
  } catch {
    return false
  }
}
