// A cheat sheet sent to someone else, written into the address after the #,
// which browsers never send to a server: `s=1/<date>/<cards>/<memberships>/
// <point values>`. Codes are /rate's (site/rate/link.ts). After a card's
// code, `.p` is a category pick and `.a` an activation. The date is the day
// the link was made, so picks and activations run out when they would have
// in the sender's own wallet. Memberships and point values go in only when
// they change the sheet. Whoever opens the link works the sheet out from it
// in their own browser.
import { cheatSheet } from '../../src/engine/cheat-sheet.ts'
import { choicePeriod, periodKey } from '../../src/engine/periods.ts'
import { num } from '../../src/engine/text.ts'
import { currencyValuation } from '../../src/engine/valuation.ts'
import type { Card } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Wallet, WalletCard } from '../../src/schema/wallet.ts'
import { MAX_CARDS } from '../report-policy.ts'
import { codeTables, optionKey, shortCode } from '../rate/link.ts'

export const SHEET_VERSION = '1'

export type SheetLink = { made: string; wallet: Wallet }

export type DecodedSheet =
  { ok: true; link: SheetLink } | { ok: false; message: string }

const DAMAGED =
  "This cheat sheet's link is damaged or cut short, so it can't be shown. Ask for the link again."
const NEWER =
  'This link was made by a newer version of earnrate.dev than this page. Reload the page to get the latest, then try the link again.'
const UNKNOWN = (what: string) =>
  `This link names ${what} earnrate doesn't list any more. Ask for a new link.`

class Refused extends Error {}

// The period a card's picks are filed under on `date`, as My wallet files
// them; null when its picks run on different schedules.
const pickPeriod = (card: Card, date: string) => {
  const period = choicePeriod(card)
  return period === null ? null : periodKey(period, date, null)
}

// The picks the engine uses on `date`, by choice: none from an earlier
// period.
function currentPicks(
  card: Card,
  held: WalletCard,
  date: string,
): Record<string, string[]> {
  const chosen = held.chosen
  if (!chosen) return {}
  return Object.fromEntries(
    card.choices.flatMap((choice) => {
      const current =
        choice.period === 'until_changed' ||
        chosen.period === periodKey(choice.period, date, null)
      const picks = (chosen.picks[choice.id] ?? []).filter(
        (o) => o in choice.options,
      )
      return current && picks.length > 0 ? [[choice.id, picks]] : []
    }),
  )
}

// Activations of rules that haven't ended by `date`.
const liveActivations = (card: Card, held: WalletCard, date: string) =>
  card.rules
    .filter(
      (r) =>
        r.requires?.activation === true &&
        held.activated.includes(r.id) &&
        (r.valid_to === undefined || r.valid_to >= date),
    )
    .map((r) => r.id)

const rowsOf = (catalog: Catalog, wallet: Wallet, date: string) =>
  JSON.stringify(
    cheatSheet(catalog, wallet, date).rows.map((r) => [
      r.cardId,
      r.effectiveReturnPct,
      r.note,
    ]),
  )

// The cards a link can carry: the ones earnrate knows, at most MAX_CARDS.
export const sendable = (catalog: Catalog, wallet: Wallet) => {
  const known = wallet.cards.filter((c) =>
    catalog.cards.some((x) => x.id === c.id),
  )
  return known.length > 0 && known.length <= MAX_CARDS
}

// The wallet a link carries: cards, their current picks and activations,
// and the memberships and point values that change the sheet.
export function sheetWallet(
  catalog: Catalog,
  wallet: Wallet,
  date: string,
): Wallet {
  const cards = wallet.cards.flatMap((held): WalletCard[] => {
    const card = catalog.cards.find((c) => c.id === held.id)
    if (!card) return []
    const picks = currentPicks(card, held, date)
    const period = pickPeriod(card, date)
    return [
      {
        id: card.id,
        cap_usage: {},
        activated: liveActivations(card, held, date),
        ...(period !== null && Object.keys(picks).length > 0
          ? { chosen: { period, picks } }
          : {}),
      },
    ]
  })
  const valuations = Object.fromEntries(
    Object.keys(wallet.valuations)
      .filter((id) => catalog.currencies.some((c) => c.id === id))
      .map((id) => [id, currencyValuation(catalog, wallet, id).centsPerUnit]),
  )
  const full: Wallet = {
    valuations,
    memberships: wallet.memberships.filter((m) =>
      catalog.memberships.some((x) => x.id === m),
    ),
    cards,
  }
  const base = rowsOf(catalog, full, date)
  const changes = (w: Wallet) => rowsOf(catalog, w, date) !== base
  return {
    valuations: Object.fromEntries(
      Object.entries(valuations).filter(([id]) => {
        const { [id]: _, ...rest } = valuations
        return changes({ ...full, valuations: rest })
      }),
    ),
    memberships: full.memberships.filter((m) =>
      changes({
        ...full,
        memberships: full.memberships.filter((x) => x !== m),
      }),
    ),
    cards,
  }
}

export function encodeSheet(
  catalog: Catalog,
  wallet: Wallet,
  date: string,
): string {
  const sent = sheetWallet(catalog, wallet, date)
  const cards = sent.cards.map((held) => {
    const card = catalog.cards.find((c) => c.id === held.id)
    const picks = (card?.choices ?? []).flatMap((choice) =>
      (held.chosen?.picks[choice.id] ?? []).map(
        (o) => `p${shortCode('option', optionKey(choice.id, o))}`,
      ),
    )
    const activated = held.activated.map(
      (id) => `a${shortCode('activation', id)}`,
    )
    return [shortCode('card', held.id), ...picks, ...activated].join('.')
  })
  const sections = [
    date,
    cards.join(','),
    sent.memberships.map((m) => shortCode('membership', m)).join(','),
    Object.entries(sent.valuations)
      .map(
        ([cur, v]) =>
          `${shortCode('currency', cur)}:${num(typeof v === 'number' ? v : (v.value ?? 0))}`,
      )
      .join(','),
  ]
  while (sections.at(-1) === '') sections.pop()
  return `s=${[SHEET_VERSION, ...sections].join('/')}`
}

// The `s=` part of a fragment ("#s=1/…" or "s=1/…"), or null without one.
export function sheetPart(fragment: string): string | null {
  const text = fragment.replace(/^#/, '')
  for (const part of text.split('&'))
    if (part.startsWith('s=')) return part.slice(2)
  return null
}

export function decodeSheet(catalog: Catalog, fragment: string): DecodedSheet {
  const part = sheetPart(fragment)
  if (part === null) return { ok: false, message: DAMAGED }
  try {
    return { ok: true, link: readSheet(catalog, decodeURIComponent(part)) }
  } catch (e) {
    return { ok: false, message: e instanceof Refused ? e.message : DAMAGED }
  }
}

const realDate = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d

function readSheet(catalog: Catalog, text: string): SheetLink {
  const parts = text.split('/')
  const [version, made = '', cardPart = '', memberPart = '', valuePart = ''] =
    parts
  if (version !== SHEET_VERSION) {
    if (version !== undefined && /^\d+$/.test(version) && Number(version) > 1)
      throw new Refused(NEWER)
    throw new Refused(DAMAGED)
  }
  if (parts.length > 5 || !realDate(made)) throw new Refused(DAMAGED)
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
  const cards = cardTokens.map((token): WalletCard => {
    const [cardCode = '', ...segments] = token.split('.')
    const id = lookup(tables.card, cardCode, 'a card')
    const card = catalog.cards.find((c) => c.id === id)
    if (!card) throw new Refused(UNKNOWN('a card'))
    const picks: Record<string, string[]> = {}
    const activated: string[] = []
    for (const segment of segments) {
      const m = /^([pa])([0-9a-z]{4})$/.exec(segment)
      if (!m) throw new Refused(DAMAGED)
      const [, kind = '', code = ''] = m
      if (kind === 'a') {
        const found = card.rules.filter(
          (r) =>
            r.requires?.activation === true &&
            shortCode('activation', r.id) === code,
        )
        const [only] = found
        if (!only || found.length > 1)
          throw new Refused(UNKNOWN('an activation'))
        if (activated.includes(only.id)) throw new Refused(DAMAGED)
        activated.push(only.id)
        continue
      }
      const found = card.choices.flatMap((choice) =>
        Object.keys(choice.options)
          .filter((o) => shortCode('option', optionKey(choice.id, o)) === code)
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
    const period = pickPeriod(card, made)
    if (Object.keys(picks).length > 0 && period === null)
      throw new Refused(DAMAGED)
    return {
      id,
      cap_usage: {},
      activated,
      ...(period !== null && Object.keys(picks).length > 0
        ? { chosen: { period, picks } }
        : {}),
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
  return { made, wallet: { valuations, memberships, cards } }
}

// Whether picks or activations the link carried have run out by `today`,
// so the sheet shows those cards at their usual rates.
export function ranOut(catalog: Catalog, link: SheetLink, today: string) {
  return link.wallet.cards.some((held) => {
    const card = catalog.cards.find((c) => c.id === held.id)
    if (!card) return false
    const picks = Object.values(held.chosen?.picks ?? {}).flat()
    return (
      Object.values(currentPicks(card, held, today)).flat().length <
        picks.length ||
      liveActivations(card, held, today).length < held.activated.length
    )
  })
}

export type SentSheet =
  | { kind: 'none' }
  | { kind: 'bad'; message: string }
  | { kind: 'sent'; link: SheetLink }

// What /sheet shows, from its address alone.
export function sentSheet(catalog: Catalog, fragment: string): SentSheet {
  if (sheetPart(fragment) === null) return { kind: 'none' }
  const decoded = decodeSheet(catalog, fragment)
  return decoded.ok
    ? { kind: 'sent', link: decoded.link }
    : { kind: 'bad', message: decoded.message }
}
