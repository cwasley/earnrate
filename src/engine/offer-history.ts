import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { OfferRecord, Release } from '../schema/changes.ts'
import { bonusDollars } from './bonus.ts'
import { offerCheckedOn, offerTerms } from './offers.ts'
import { addDays, inEffect } from './periods.ts'
import { currencyName, dateRange, roundCents, shortDate } from './text.ts'
import { currencyValuation } from './valuation.ts'

// A card's public welcome offers as earnrate recorded them: from the day it
// started recording the card's offer, through each issuer change, to the
// offer on the card file now. Only issuer changes move from one offer to
// the next. A correction fixes earnrate's own record, so the corrected
// terms stand for the whole period and the wrong ones never show; wording,
// quote and review entries don't touch the offer.

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isOfferField = (field: string | undefined) =>
  field === 'welcome_offer' || field?.startsWith('welcome_offer.') === true

// The minimal record the catalog keeps (loadCatalog), oldest first: the
// day each card's offer was first recorded and every issuer change to it.
export function offerRecords(releases: Release[]): OfferRecord[] {
  const offerStart = new Map<string, string>()
  const cardStart = new Map<string, string>()
  const changes: OfferRecord[] = []
  for (const release of releases.toReversed()) {
    for (const c of release.changes) {
      const date = c.date ?? release.date
      for (const card of c.cards ?? []) {
        if (c.cause === 'addition' && c.field === undefined)
          cardStart.set(card, cardStart.get(card) ?? date)
        if (c.cause === 'addition' && c.field === 'welcome_offer')
          offerStart.set(card, offerStart.get(card) ?? date)
        if (c.cause === 'issuer' && isOfferField(c.field)) {
          // An old offer the issuer dated ran through its last day.
          const ran =
            isRecord(c.was) && typeof c.was.valid_to === 'string'
              ? addDays(c.was.valid_to, 1)
              : ''
          const said = c.effective ?? c.detected ?? date
          const took = ran > said ? ran : said
          changes.push({
            card,
            from: took < date ? took : date,
            change: { field: c.field ?? '', was: c.was, now: c.now },
          })
        }
      }
    }
  }
  const starts = new Map([...cardStart, ...offerStart])
  return [
    ...[...starts].map(([card, from]) => ({ card, from })),
    ...changes,
  ].sort((a, b) => a.card.localeCompare(b.card))
}

export type OfferTermsKey = {
  points: number | null
  dollars: number | null
  spend: number
  months: number
  varies: boolean // "up to": the most the issuer shows
}

export type OfferPeriod = OfferTermsKey & {
  from: string
  to: string // the last day earnrate saw it (the last check, for the current one)
  current: boolean
  value: number // dollars at earnrate's default point value
}

export type OfferHistory = {
  cardId: string
  since: string // the day earnrate started recording the card's offer
  periods: OfferPeriod[] // oldest first; days with no offer are left out
  current: OfferPeriod | null
  highest: OfferPeriod[] // every period with the highest terms
}

type Terms = Record<string, unknown> | null

function termsOf(o: Terms): OfferTermsKey | null {
  if (o === null) return null
  const n = (v: unknown) => (typeof v === 'number' ? v : null)
  const spend = n(o.spend)
  const months = n(o.months)
  if (spend === null || months === null) return null
  if (n(o.points) === null && n(o.dollars) === null) return null
  return {
    points: n(o.points),
    dollars: n(o.dollars),
    spend,
    months,
    varies: o.varies === true,
  }
}

const sameTerms = (a: OfferTermsKey, b: OfferTermsKey) =>
  a.points === b.points &&
  a.dollars === b.dollars &&
  a.spend === b.spend &&
  a.months === b.months &&
  a.varies === b.varies

// Undoes one issuer change: the offer as it was before it.
function before(terms: Terms, field: string, was: unknown): Terms {
  if (field === 'welcome_offer') return isRecord(was) ? was : null
  const key = field.slice('welcome_offer.'.length).split('.')[0] ?? ''
  const rest = Object.entries(terms ?? {}).filter(([k]) => k !== key)
  return Object.fromEntries(
    was === null || was === undefined ? rest : [...rest, [key, was]],
  )
}

// Highest value first; then the lower spend, the longer window, and an
// offer everyone gets over an "up to" one.
export const offerRank = (a: OfferPeriod, b: OfferPeriod) =>
  b.value - a.value ||
  a.spend - b.spend ||
  b.months - a.months ||
  Number(a.varies) - Number(b.varies)

export function offerHistory(
  catalog: Catalog,
  card: Card,
  today: string,
): OfferHistory | null {
  const records = (catalog.offerRecords ?? []).filter((r) => r.card === card.id)
  const since = records.find((r) => r.change === undefined)?.from
  if (since === undefined) return null
  const cents = currencyValuation(
    catalog,
    { valuations: {} },
    card.currency,
  ).centsPerUnit
  const value = (t: OfferTermsKey) =>
    roundCents(
      bonusDollars(
        card,
        cents,
        t.points ?? undefined,
        t.dollars ?? undefined,
      ) ?? 0,
    )

  const offer = card.welcome_offer
  const ended = offer !== undefined && !inEffect(offer, today)
  const checked = offerCheckedOn(card)
  let terms: Terms = offer === undefined ? null : { ...offer }
  let to =
    ended && offer.valid_to !== undefined
      ? offer.valid_to
      : checked > today
        ? today
        : checked
  const backwards: Omit<OfferPeriod, 'value'>[] = []
  const add = (from: string, last: string, t: Terms, current: boolean) => {
    const key = termsOf(t)
    if (key === null || from > last) return
    backwards.push({ ...key, from, to: last, current })
  }
  let current = !ended
  for (const r of records
    .filter((r) => r.change !== undefined && r.from > since)
    .toReversed()) {
    const change = r.change
    if (change === undefined) continue
    add(r.from, to < r.from ? r.from : to, terms, current)
    terms = before(terms, change.field, change.was)
    to = addDays(r.from, -1)
    current = false
  }
  add(since, to < since ? since : to, terms, current)

  // Back-to-back periods with the same terms (an issuer change to the end
  // date or the fine print) read as one.
  const periods: OfferPeriod[] = []
  for (const p of backwards.toReversed()) {
    const last = periods.at(-1)
    if (last && sameTerms(last, p) && addDays(last.to, 1) === p.from) {
      last.to = p.to
      last.current = p.current
    } else periods.push({ ...p, value: value(p) })
  }
  if (periods.length === 0) return null
  const best = periods.toSorted(offerRank)[0]
  return {
    cardId: card.id,
    since,
    periods,
    current: periods.find((p) => p.current) ?? null,
    highest:
      best === undefined ? [] : periods.filter((p) => sameTerms(p, best)),
  }
}

export type OfferHigh = OfferTermsKey & {
  // One line for answers: the highest public offer earnrate has recorded
  // and how the current one compares.
  text: string
  since: string // the day earnrate started recording the card's offer
  only: boolean // earnrate has recorded no other offer for the card
  isCurrent: boolean // the current offer is the highest recorded
  value: number // dollars at earnrate's default point value
  seen: { from: string; to: string }[] // when it was the public offer
}

const lower = (text: string) => text.replace(/^Up to /, 'up to ')

export function periodTerms(catalog: Catalog, card: Card, p: OfferTermsKey) {
  return lower(
    offerTerms(
      {
        points: p.points,
        dollars: p.dollars,
        spend: p.spend,
        months: p.months,
        varies: p.varies,
      },
      currencyName(catalog, card.currency),
    ),
  )
}

const seenText = (periods: OfferPeriod[]) =>
  periods.map((p) => dateRange(p.from, p.to)).join(' and ')

type ShortOf = 'lower' | 'spend' | 'time' | 'up-to'

// How the current offer falls short of the highest.
function shortOf(now: OfferPeriod, high: OfferPeriod): ShortOf {
  if (now.value < high.value) return 'lower'
  if (now.spend > high.spend) return 'spend'
  if (now.months < high.months) return 'time'
  return 'up-to'
}

// "…; the current one is lower."
const CURRENT_IS: Record<ShortOf, string> = {
  lower: 'is lower',
  spend: 'needs more spending',
  time: 'gives less time',
  'up-to': 'is an "up to" offer',
}

// "Lower than the 180,000 … seen Oct 27 – Nov 15, 2026."
const COMPARED: Record<ShortOf, string> = {
  lower: 'Lower than',
  spend: 'It needs more spending than',
  time: 'It gives less time than',
  'up-to': 'At most',
}

export function offerHigh(
  catalog: Catalog,
  card: Card,
  today: string,
): OfferHigh | null {
  const history = offerHistory(catalog, card, today)
  const top = history?.highest.at(-1)
  if (!history || top === undefined) return null
  const now = history.current
  const only = history.periods.every((p) => sameTerms(p, top))
  const isCurrent = now !== null && sameTerms(now, top)
  const terms = periodTerms(catalog, card, top)
  const seen = seenText(history.highest)
  const lead = 'Highest public offer earnrate has recorded'
  const text =
    only && now !== null
      ? `earnrate has recorded only this public offer, since ${shortDate(history.since)}.`
      : only
        ? `The only public offer earnrate has recorded: ${terms} (${seen}); there's no public offer now.`
        : isCurrent
          ? `${lead}: this one, since ${shortDate(now.from)}.`
          : now === null
            ? `${lead}: ${terms} (${seen}); there's no public offer now.`
            : `${lead}: ${terms} (${seen}); the current one ${CURRENT_IS[shortOf(now, top)]}.`
  return {
    points: top.points,
    dollars: top.dollars,
    spend: top.spend,
    months: top.months,
    varies: top.varies,
    text,
    since: history.since,
    only,
    isCurrent,
    value: top.value,
    seen: history.highest.map((p) => ({ from: p.from, to: p.to })),
  }
}

// The card page's "Offer history": the current offer against the highest
// recorded, the earlier ones, and what the record can't see.
export type OfferHistoryText = {
  lead: string
  earlier: { from: string; to: string; text: string }[] // newest first
}

export const OFFER_HISTORY_CAVEAT =
  "earnrate checks each card's public offer on its issuer's page twice a week, so an offer that came and went between checks may be missing. Issuers show different offers to different people, sometimes on two visits to the same page, and the offer shown when you apply is the one you get. Offers sent by mail or email, through a referral or in a branch aren't recorded."

export function offerHistoryText(
  catalog: Catalog,
  card: Card,
  today: string,
): OfferHistoryText | null {
  const history = offerHistory(catalog, card, today)
  const top = history?.highest.at(-1)
  if (!history || top === undefined) return null
  const now = history.current
  const terms = (p: OfferPeriod) => periodTerms(catalog, card, p)
  const tracking = `since it started tracking this card on ${shortDate(history.since)}`
  const pastOnes = history.periods.filter((p) => !p.current).toReversed()
  const only = history.periods.every((p) => sameTerms(p, top))
  const isCurrent = now !== null && sameTerms(now, top)
  const highestPast = history.highest.filter((p) => !p.current)
  let lead: string
  let named: OfferPeriod[] = []
  if (now === null) {
    lead = `No public offer now. The highest earnrate has recorded ${tracking}: ${terms(top)}, seen ${seenText(highestPast)}.`
    named = highestPast
  } else if (only && pastOnes.length === 0) {
    lead = `This is the only public offer earnrate has recorded ${tracking}.`
  } else {
    const since = `It's been the public offer since ${shortDate(now.from)}`
    if (isCurrent) {
      lead = `${since}, the highest earnrate has recorded ${tracking}.`
    } else {
      lead = `${since}. ${COMPARED[shortOf(now, top)]} the ${terms(top)} seen ${seenText(highestPast)}.`
      named = highestPast
    }
  }
  const rest = pastOnes.filter((p) => !named.includes(p))
  return {
    lead,
    earlier:
      rest.length === 0
        ? []
        : pastOnes.map((p) => ({ from: p.from, to: p.to, text: terms(p) })),
  }
}
