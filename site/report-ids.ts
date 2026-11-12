// A short report link's name and delete key, made by the page that makes
// the link, so the address exists the moment Copy link or Share is pressed.
// The Worker (reports.ts) checks both against these patterns.

export const REPORT_HEADER = 'x-earnrate-report'
export const ID_HEADER = 'x-earnrate-report-id'
export const DELETE_HEADER = 'x-earnrate-delete-key'

// No 0/o, 1/l/i: an id read aloud or retyped can't be mistaken.
export const ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
export const ID_LENGTH = 8
export const ID = new RegExp(`^[${ID_ALPHABET}]{${String(ID_LENGTH)}}$`)
// 24 random bytes, base64url without padding.
export const KEY = /^[A-Za-z0-9_-]{32}$/

function randomFrom(alphabet: string, length: number): string {
  const out: string[] = []
  // Rejection sampling, so each character is equally likely.
  const limit = 256 - (256 % alphabet.length)
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length)
        out.push(alphabet[b % alphabet.length] ?? '')
    }
  }
  return out.join('')
}

export const newId = () => randomFrom(ID_ALPHABET, ID_LENGTH)

export const newKey = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
