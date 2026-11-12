// A shared report's inputs, written into the address after the #, which
// browsers never send to a server: `w=1/<cards>/<memberships>/<point
// values>/<spending>`. Cards, categories, memberships, currencies, pick
// options and statement credits go by a short code made from their id;
// stores by their id. After a card's code, `.p` is a pick, `.u` a credit
// marked as used and `.x` one marked as not used.
// Whoever opens the link rebuilds the report from it in their own browser.
import {
  categoryResolution,
  resolveMerchantById,
} from '../../src/merchants/resolve.ts'
import type { Picks } from '../../src/engine/explore.ts'
import type { ResolvedLine } from '../../src/engine/simulate.ts'
import { num } from '../../src/engine/text.ts'
import type { ReportInput } from '../../src/engine/wallet-report.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { ReportCodes } from '../report-check.ts'
import { MAX_CARDS, MAX_LINES, SPEND_STEP, spendOk } from '../report-policy.ts'

export const LINK_VERSION = '1'

export type ReportLink = {
  input: ReportInput
  lines: ResolvedLine[] | null // null: typical spending
}

export type Decoded =
  { ok: true; link: ReportLink } | { ok: false; message: string }

// Codes never change once a link carries them. If a new id's code is taken
// in its kind (tests/rate-link.test.ts fails), pin the new id to an unused
// code here, as "kind:id": "code"; never re-pin an id that's been shipped.
const PINNED: Record<string, string> = {}

type Kind =
  | 'card'
  | 'category'
  | 'membership'
  | 'currency'
  | 'option'
  | 'credit'
  | 'activation'

// FNV-1a, 32 bits, to four base-36 characters.
export function shortCode(kind: Kind, id: string): string {
  const pinned = PINNED[`${kind}:${id}`]
  if (pinned !== undefined) return pinned
  let h = 0x811c9dc5
  for (const ch of `${kind}:${id}`) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h % 36 ** 4).toString(36).padStart(4, '0')
}

export const optionKey = (choice: string, option: string) =>
  `${choice}/${option}`

// A card's statement credits and free nights share one id space.
export const creditIds = (card: Catalog['cards'][number]) => [
  ...card.credits.map((c) => c.id),
  ...card.free_nights.map((n) => n.id),
]

// Every code in use, by kind, to read a link back; a code two ids share in
// one kind reads as neither.
export function codeTables(catalog: Catalog) {
  const table = (kind: Kind, ids: string[]) => {
    const map = new Map<string, string | null>()
    for (const id of ids) {
      const c = shortCode(kind, id)
      map.set(c, map.has(c) && map.get(c) !== id ? null : id)
    }
    return map
  }
  return {
    card: table(
      'card',
      catalog.cards.map((c) => c.id),
    ),
    category: table(
      'category',
      catalog.categories.map((c) => c.id),
    ),
    membership: table(
      'membership',
      catalog.memberships.map((m) => m.id),
    ),
    currency: table(
      'currency',
      catalog.currencies.map((c) => c.id),
    ),
  }
}

// The codes the short-link Worker checks a report against.
export function reportCodes(catalog: Catalog): ReportCodes {
  const tables = codeTables(catalog)
  const codes = (map: Map<string, string | null>) =>
    [...map].flatMap(([c, id]) => (id === null ? [] : [c])).sort()
  const once = (all: string[]) =>
    all.filter((c, i, a) => a.indexOf(c) === a.lastIndexOf(c))
  const cards: ReportCodes['cards'] = {}
  for (const [code, id] of tables.card) {
    const card = catalog.cards.find((c) => c.id === id)
    if (!card) continue
    const options = once(
      card.choices.flatMap((choice) =>
        Object.keys(choice.options).map((o) =>
          shortCode('option', optionKey(choice.id, o)),
        ),
      ),
    )
    const p = card.choices.map((choice) => ({
      n: choice.pick,
      o: Object.keys(choice.options)
        .map((o) => shortCode('option', optionKey(choice.id, o)))
        .filter((c) => options.includes(c)),
    }))
    const c = once(creditIds(card).map((x) => shortCode('credit', x)))
    cards[code] = {
      ...(p.length > 0 ? { p } : {}),
      ...(c.length > 0 ? { c } : {}),
    }
  }
  return {
    cards,
    memberships: codes(tables.membership),
    currencies: codes(tables.currency),
    categories: codes(tables.category),
    merchants: [
      ...new Set(
        [...catalog.merchants.overrides, ...catalog.merchants.seed].map(
          (m) => m.id,
        ),
      ),
    ].sort(),
  }
}

const otherLabel = (name: string) =>
  `Other ${name.charAt(0).toLowerCase()}${name.slice(1)}`

// Spending rounded to the nearest $5 a month, as a link carries it; lines
// that round to nothing, or that earnrate doesn't know, are dropped.
const rounded = (monthly: number) =>
  Math.round(monthly / SPEND_STEP) * SPEND_STEP

export function roundedLines(lines: ResolvedLine[]): ResolvedLine[] {
  return lines
    .filter((l) => l.merchant.source !== 'none')
    .map((l) => ({ ...l, monthly: rounded(l.monthly) }))
    .filter((l) => l.monthly > 0)
}

function lineToken(catalog: Catalog, l: ResolvedLine): string | null {
  const dollars = String(rounded(l.monthly))
  const category = catalog.categories.find((c) => c.id === l.merchant.category)
  if (l.merchant.source === 'category') {
    if (!category) return null
    const kind = l.label === otherLabel(category.name) ? 'o' : 'c'
    return `${dollars}${kind}${shortCode('category', category.id)}`
  }
  const id = l.merchant.merchantId
  if (id === null) return null
  const as = catalog.categories.find(
    (c) => c.name === l.label && l.label !== l.merchant.resolvedName,
  )
  return `${dollars}m${id}${as ? `.${shortCode('category', as.id)}` : ''}`
}

export function encodeReport(catalog: Catalog, link: ReportLink): string {
  const cards = link.input.cards.map((c) => {
    const card = catalog.cards.find((x) => x.id === c.id)
    const options = (card?.choices ?? []).flatMap((choice) =>
      (c.picks[choice.id] ?? []).map((o) =>
        shortCode('option', optionKey(choice.id, o)),
      ),
    )
    const known = card ? creditIds(card) : []
    const marked = (prefix: string, ids: string[] | undefined) =>
      (ids ?? [])
        .filter((id) => known.includes(id))
        .map((id) => `${prefix}${shortCode('credit', id)}`)
    return [
      shortCode('card', c.id),
      ...options.map((o) => `p${o}`),
      ...marked('u', c.used),
      ...marked('x', c.skipped),
    ].join('.')
  })
  const sections = [
    cards.join(','),
    link.input.memberships.map((m) => shortCode('membership', m)).join(','),
    Object.entries(link.input.valuations)
      .map(([cur, cents]) => `${shortCode('currency', cur)}:${num(cents)}`)
      .join(','),
    link.lines === null
      ? ''
      : roundedLines(link.lines)
          .flatMap((l) => lineToken(catalog, l) ?? [])
          .join(','),
  ]
  while (sections.at(-1) === '') sections.pop()
  return `w=${[LINK_VERSION, ...sections].join('/')}`
}

const DAMAGED =
  "This link's report is damaged or cut short, so it can't be shown. Ask for the link again."
const NEWER =
  'This link was made by a newer version of earnrate.dev than this page. Reload the page to get the latest, then try the link again.'
const UNKNOWN = (what: string) =>
  `This link names ${what} earnrate doesn't list any more, so the report can't be shown as it was shared.`

class Refused extends Error {}

// The `w=` part of a fragment ("#w=1/…" or "w=1/…"), or null without one.
export function reportPart(fragment: string): string | null {
  const text = fragment.replace(/^#/, '')
  for (const part of text.split('&'))
    if (part.startsWith('w=')) return part.slice(2)
  return null
}

export function decodeReport(catalog: Catalog, fragment: string): Decoded {
  const part = reportPart(fragment)
  if (part === null) return { ok: false, message: DAMAGED }
  try {
    return { ok: true, link: readLink(catalog, decodeURIComponent(part)) }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Refused ? e.message : DAMAGED,
    }
  }
}

function readLink(catalog: Catalog, text: string): ReportLink {
  const [version, cardPart = '', memberPart = '', valuePart = '', spendPart] =
    text.split('/')
  if (version !== LINK_VERSION) {
    if (version !== undefined && /^\d+$/.test(version) && Number(version) > 1)
      throw new Refused(NEWER)
    throw new Refused(DAMAGED)
  }
  if (text.split('/').length > 5) throw new Refused(DAMAGED)
  const tables = codeTables(catalog)
  const list = (s: string) => (s === '' ? [] : s.split(','))
  const lookup = (map: Map<string, string | null>, c: string, what: string) => {
    if (!/^[0-9a-z]{4}$/.test(c)) throw new Refused(DAMAGED)
    const id = map.get(c)
    if (id === undefined || id === null) throw new Refused(UNKNOWN(what))
    return id
  }

  const cardTokens = list(cardPart)
  if (cardTokens.length === 0 || cardTokens.length > MAX_CARDS)
    throw new Refused(DAMAGED)
  const cards = cardTokens.map((token) => {
    const [cardCode = '', ...segments] = token.split('.')
    const id = lookup(tables.card, cardCode, 'a card')
    const card = catalog.cards.find((c) => c.id === id)
    if (!card) throw new Refused(UNKNOWN('a card'))
    const picks: Picks = {}
    const used: string[] = []
    const skipped: string[] = []
    for (const segment of segments) {
      const m = /^([pux])([0-9a-z]{4})$/.exec(segment)
      if (!m) throw new Refused(DAMAGED)
      const [, kind = '', oc = ''] = m
      if (kind !== 'p') {
        const found = creditIds(card).filter(
          (c) => shortCode('credit', c) === oc,
        )
        const [only] = found
        if (!only || found.length > 1)
          throw new Refused(UNKNOWN('a statement credit'))
        if (used.includes(only) || skipped.includes(only))
          throw new Refused(DAMAGED)
        ;(kind === 'u' ? used : skipped).push(only)
        continue
      }
      const found = card.choices.flatMap((choice) =>
        Object.keys(choice.options)
          .filter((o) => shortCode('option', optionKey(choice.id, o)) === oc)
          .map((o) => ({ choice, o })),
      )
      const [only] = found
      if (!only || found.length > 1)
        throw new Refused(UNKNOWN('a category pick'))
      const chosen = picks[only.choice.id] ?? []
      if (chosen.includes(only.o) || chosen.length >= only.choice.pick)
        throw new Refused(DAMAGED)
      picks[only.choice.id] = [...chosen, only.o]
    }
    return {
      id,
      picks,
      ...(used.length > 0 ? { used } : {}),
      ...(skipped.length > 0 ? { skipped } : {}),
    }
  })
  const ids = cards.map((c) => c.id)
  if (new Set(ids).size !== ids.length) throw new Refused(DAMAGED)

  const memberships = list(memberPart).map((c) =>
    lookup(tables.membership, c, 'a membership'),
  )
  if (new Set(memberships).size !== memberships.length)
    throw new Refused(DAMAGED)

  const valuations: Record<string, number> = {}
  for (const token of list(valuePart)) {
    const m = /^([0-9a-z]{4}):(\d{1,3}(?:\.\d{1,4})?)$/.exec(token)
    if (!m) throw new Refused(DAMAGED)
    const currency = lookup(tables.currency, m[1] ?? '', 'a points currency')
    const cents = Number(m[2])
    if (!(cents > 0 && cents <= 100) || currency in valuations)
      throw new Refused(DAMAGED)
    valuations[currency] = cents
  }

  const lines =
    spendPart === undefined
      ? null
      : list(spendPart).map((token) => readLine(catalog, tables, token))
  if (lines !== null && (lines.length === 0 || lines.length > MAX_LINES))
    throw new Refused(DAMAGED)
  return { input: { cards, memberships, valuations }, lines }
}

function readLine(
  catalog: Catalog,
  tables: ReturnType<typeof codeTables>,
  token: string,
): ResolvedLine {
  const m = /^(\d{1,7})([com])([a-z0-9-]+)(?:\.([0-9a-z]{4}))?$/.exec(token)
  if (!m) throw new Refused(DAMAGED)
  const monthly = Number(m[1])
  if (!spendOk(monthly)) throw new Refused(DAMAGED)
  const kind = m[2]
  const ref = m[3] ?? ''
  const categoryOf = (c: string) => {
    const id = tables.category.get(c)
    const category = catalog.categories.find((x) => x.id === id)
    if (!/^[0-9a-z]{4}$/.test(c)) throw new Refused(DAMAGED)
    if (!category) throw new Refused(UNKNOWN('a kind of spending'))
    return category
  }
  if (kind === 'c' || kind === 'o') {
    if (m[4] !== undefined) throw new Refused(DAMAGED)
    const category = categoryOf(ref)
    return {
      label: kind === 'o' ? otherLabel(category.name) : category.name,
      monthly,
      merchant: categoryResolution(catalog, category.id, null),
    }
  }
  const merchant = resolveMerchantById(catalog, ref, null)
  if (!merchant) throw new Refused(UNKNOWN('a store'))
  return {
    label: m[4] === undefined ? merchant.resolvedName : categoryOf(m[4]).name,
    monthly,
    merchant,
  }
}
