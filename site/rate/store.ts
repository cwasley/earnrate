// The page's only requests: saving a report as a short link when someone
// presses Copy link or Share, reading one by its id, and deleting one with
// the key that saved it. Nothing else goes with them: no cookie, and the id
// is the only thing a read sends.
import {
  DELETE_HEADER,
  ID_ALPHABET,
  ID_LENGTH,
  REPORT_HEADER,
} from '../reports.ts'

export type Saved = { id: string; key: string }

const HEADERS = { [REPORT_HEADER]: '1' }

const ID = new RegExp(`^/r/([${ID_ALPHABET}]{${String(ID_LENGTH)}})/?$`)

// The id in /r/<id>, or null on any other address.
export function storedId(pathname: string): string | null {
  return ID.exec(pathname)?.[1] ?? null
}

export const shortUrl = (origin: string, id: string) => `${origin}/r/${id}`

// `report` is the w= link's contents without the "w=". Null when no short
// link was made, whatever the reason: a limit, a refusal or no answer.
export async function saveReport(report: string): Promise<Saved | null> {
  try {
    const res = await fetch('/r', {
      method: 'POST',
      credentials: 'omit',
      headers: { ...HEADERS, 'content-type': 'text/plain' },
      body: report,
    })
    if (res.status !== 201) return null
    const saved = (await res.json()) as Partial<Saved>
    return typeof saved.id === 'string' && typeof saved.key === 'string'
      ? { id: saved.id, key: saved.key }
      : null
  } catch {
    return null
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
