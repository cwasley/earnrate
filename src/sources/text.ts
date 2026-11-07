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
const ERROR_PAGES = [
  'Sorry, we are unable to load this page at this time',
  "We're sorry! This page is currently unavailable. Please try again later.",
]

export function errorPage(text: string): string | null {
  const page = normalizeText(text)
  return ERROR_PAGES.find((p) => page.includes(normalizeText(p))) ?? null
}

const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`
const UNREAD = new RegExp(
  `<!--[\\s\\S]*?-->|<(script|style|noscript)\\b${ATTRS}>([\\s\\S]*?)</\\1\\s*>`,
  'gi',
)
const INNERMOST_TEMPLATE = new RegExp(
  `<template\\b${ATTRS}>((?:(?!<template\\b)[\\s\\S])*?)</template\\s*>`,
  'gi',
)
const TAG = new RegExp(`</?[a-z][^\\s/>]*${ATTRS}>`, 'gi')
const ENTITY = /&(amp|lt|gt|quot|nbsp|#\d+|#x[\da-f]+);/gi
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  nbsp: '\u00a0',
}

const decode = (s: string) =>
  s.replace(ENTITY, (_, name: string) => {
    const named = NAMED[name.toLowerCase()]
    if (named !== undefined) return named
    const code =
      name[1] === 'x' || name[1] === 'X'
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10)
    return code <= 0x10ffff ? String.fromCodePoint(code) : ''
  })

// Splits Chromium's serialized DOM (`page.content()`) into the body's text
// (body.textContent, hidden sections included) and the script, template and
// noscript contents, which can hold copy the page no longer shows. The
// serializer escapes only &, <, >, " and no-break spaces in text.
export function splitPage(html: string): { text: string; data: string } {
  const data: string[] = []
  let s = html.replace(
    UNREAD,
    (_, tag: string | undefined, inner: string | undefined) => {
      if (tag !== undefined && tag.toLowerCase() !== 'style')
        data.push(inner ?? '')
      return ''
    },
  )
  for (let before = ''; before !== s;) {
    before = s
    s = s.replace(INNERMOST_TEMPLATE, (_, inner: string) => {
      data.push(decode(inner.replace(TAG, '')))
      return ''
    })
  }
  const body = /<body[\s>]/i.exec(s)
  if (body) s = s.slice(body.index)
  return { text: decode(s.replace(TAG, '')), data: data.join('\n') }
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
