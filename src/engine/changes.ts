import type { Card, Credit, Rule, WelcomeOfferSchema } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Change, ChangeSubject, Release } from '../schema/changes.ts'
import type { z } from 'zod'
import { offerTerms } from './offers.ts'
import { creditName, ruleWhat } from './rule-text.ts'
import {
  creditBack,
  currencyName,
  earnText,
  money,
  pct,
  possessive,
  shortCardName,
  shortDate,
} from './text.ts'

export type DatedChange = {
  version: string
  date: string // when it reached the data
  change: Change
}

// Newest first.
export function datedChanges(releases: Release[]): DatedChange[] {
  return releases
    .flatMap((r) =>
      r.changes.map((change) => ({
        version: r.version,
        date: change.date ?? r.date,
        change,
      })),
    )
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
}

export const issuerChanges = (releases: Release[]) =>
  datedChanges(releases).filter((d) => d.change.cause === 'issuer')

export function subjectOf(
  catalog: Catalog,
  kind: ChangeSubject,
  id: string,
): unknown {
  switch (kind) {
    case 'cards':
      return catalog.cards.find((c) => c.id === id)
    case 'merchants':
      return [...catalog.merchants.seed, ...catalog.merchants.overrides].find(
        (m) => m.id === id,
      )
    case 'categories':
      return catalog.categories.find((c) => c.id === id)
    case 'currencies':
      return catalog.currencies.find((c) => c.id === id)
    case 'memberships':
      return catalog.memberships.find((m) => m.id === id)
    case 'issuers':
      return catalog.issuers.find((i) => i.id === id)
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// `rules.amazon.rate` on a card: list items are found by their id.
export function fieldValue(subject: unknown, field: string | undefined) {
  if (field === undefined) return subject
  let value = subject
  for (const step of field.split('.')) {
    if (Array.isArray(value))
      value = value.find((item) => isRecord(item) && item.id === step)
    else if (isRecord(value)) value = value[step]
    else return undefined
  }
  return value
}

type Offer = z.output<typeof WelcomeOfferSchema>

const NO_SPEND = ' with no spending required'
// Mid-sentence: "up to 80,000 points".
const lower = (text: string) => text.replace(/^Up to /, 'up to ')

// Only the part that changed is said twice: "$150 → $200 with no spending
// required", "80,000 points after $3,000 … → after $2,000 …".
function offerChange(catalog: Catalog, card: Card, was: Offer, now: Offer) {
  const units = currencyName(catalog, card.currency)
  const terms = (o: Offer) => lower(offerTerms(o, units))
  const amount = (o: Offer) =>
    lower(offerTerms({ ...o, spend: 0, months: 1 }, units)).slice(
      0,
      -NO_SPEND.length,
    )
  const tail = (o: Offer) => terms(o).slice(amount(o).length)
  if (tail(was) === tail(now)) return `${amount(was)} → ${terms(now)}`
  if (amount(was) === amount(now)) return `${terms(was)} → ${tail(now).trim()}`
  return `${terms(was)} → ${terms(now)}`
}

const feeWords = (fee: unknown) =>
  typeof fee === 'number' ? (fee === 0 ? 'none' : money(fee)) : 'not on file'

// "Prime Visa's welcome offer: $150 → $200 with no spending required": one
// plain line for an issuer change, from its old and new values.
export function changeHeadline(catalog: Catalog, change: Change): string {
  const id = change.cards?.[0] ?? ''
  const card = catalog.cards.find((c) => c.id === id)
  if (!card || change.field === undefined)
    throw new Error(`no headline for a change to ${id}`)
  const name = possessive(card.short_name ?? shortCardName(card.name))
  const [kind, item] = change.field.split('.')
  const { was, now } = change
  switch (kind) {
    case 'welcome_offer':
      if (was === null) return `${name} new welcome offer: ${terms(now)}`
      if (now === null) return `${name} welcome offer ended: ${terms(was)}`
      return `${name} welcome offer: ${offerChange(catalog, card, was as Offer, now as Offer)}`
    case 'annual_fee':
    case 'first_year_fee':
      return `${name} ${kind === 'annual_fee' ? 'annual fee' : 'first-year fee'}: ${feeWords(was)} → ${feeWords(now)}`
    case 'foreign_transaction_fee': {
      const fee = (v: unknown) =>
        typeof v === 'number' ? (v === 0 ? 'none' : pct(v)) : 'not on file'
      return `${name} foreign transaction fee: ${fee(was)} → ${fee(now)}`
    }
    case 'applications_closed':
      return `${name} applications closed ${shortDate(String(now))}`
    case 'rules': {
      const rule = (card.rules.find((r) => r.id === item) ?? now ?? was) as Rule
      const rate = (v: unknown) =>
        v === null
          ? 'none'
          : earnText(
              catalog,
              typeof v === 'number' ? v : (v as Rule).rate,
              card.currency,
            )
      return `${name} rate ${ruleWhat(catalog, rule, card)}: ${rate(was)} → ${rate(now)}`
    }
    case 'credits': {
      const credit = (card.credits.find((c) => c.id === item) ??
        now ??
        was) as Credit
      const back = (v: unknown) =>
        v === null ? 'none' : creditBack(v as Credit)
      return `${name} ${creditName(catalog, credit)} credit: ${back(was)} → ${back(now)}`
    }
  }
  throw new Error(`no headline for an issuer change to ${change.field}`)

  function terms(o: unknown) {
    return lower(
      offerTerms(o as Offer, currencyName(catalog, card?.currency ?? '')),
    )
  }
}

export type Freshness = {
  issuerChanges: number
  since: string // the first release
  latestRelease: string
  latestVersion: string
  reviewedFrom: string // the oldest and newest last_verified
  reviewedTo: string
}

export function freshness(catalog: Catalog, releases: Release[]): Freshness {
  const verified = catalog.cards.map((c) => c.last_verified).sort()
  const first = releases.at(-1)
  const latest = releases[0]
  if (!first || !latest) throw new Error('no data releases')
  return {
    issuerChanges: issuerChanges(releases).length,
    since: first.date,
    latestRelease: latest.date,
    latestVersion: latest.version,
    reviewedFrom: verified[0] ?? '',
    reviewedTo: verified.at(-1) ?? '',
  }
}
