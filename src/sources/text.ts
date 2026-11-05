import { createHash } from 'node:crypto'

// Pages and stored quotes go through the same normalization, so markup
// artifacts (trademark symbols, footnote daggers, curly quotes, spacing) don't
// count as changes.
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[®™©‡†§*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s([.,;:!?)])/g, '$1')
    .trim()
}

// What an issuer serves instead of the page while it's rate-limiting or down.
// It comes with HTTP 200 and enough text to pass the length check, so without
// this it would be read as the page and its hashes written to the lock.
const ERROR_PAGES = ['Sorry, we are unable to load this page at this time']

export function errorPage(text: string): string | null {
  const page = normalizeText(text)
  return ERROR_PAGES.find((p) => page.includes(normalizeText(p))) ?? null
}

export function containsQuote(pageTexts: string[], quote: string): boolean {
  const needle = normalizeText(quote)
  return pageTexts.some((t) => normalizeText(t).includes(needle))
}

// A stated rate ("5%", "3X", "2 points per $1"). Taglines without a number
// change between page loads and are noise.
const EARNING =
  /\b\d+(\.\d+)?\s?(x|%)(?![a-z])|\b\d+(\.\d+)? (points?|miles?) (per|for every)\b/i
const NOT_EARNING =
  /\bAPR\b|annual percentage rate|balance transfer|cash advance/i

// Lines that state an earning rate. A new one is how a new perk (like the
// Amex–Airbnb partnership) first shows up on an issuer page.
export function earningLines(innerText: string): string[] {
  const lines = innerText
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 40 && l.length <= 400)
    .filter((l) => EARNING.test(l) && !NOT_EARNING.test(l))
  return [...new Set(lines)]
}

export function lineKey(line: string): string {
  return createHash('sha256')
    .update(normalizeText(line))
    .digest('hex')
    .slice(0, 16)
}

export function pageKey(url: string): string {
  return url.split('#')[0] ?? url
}
