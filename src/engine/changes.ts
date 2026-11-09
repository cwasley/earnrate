import type { Card, Credit, Rule, WelcomeOfferSchema } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Change, ChangeSubject, Release } from '../schema/changes.ts'
import type { z } from 'zod'
import { offerTerms } from './offers.ts'
import { creditName, rulePreposition, ruleWhat } from './rule-text.ts'
import {
  creditBack,
  currencyName,
  earnText,
  listed,
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

// What a cardholder's to-do list tells them about: an issuer changing a
// card's terms, or earnrate fixing its own mistake about a card.
export const holderNews = (c: Change) =>
  (c.cause === 'issuer' || c.cause === 'correction') && c.cards !== undefined

// The releases cut down to those changes, for the catalog the engine runs on.
export function holderReleases(releases: Release[]): Release[] {
  return releases.flatMap((r) => {
    const changes = r.changes.filter(holderNews)
    return changes.length === 0 ? [] : [{ ...r, changes }]
  })
}

// The day a cardholder could first have heard of it.
export const changeSeen = (d: DatedChange) => d.change.detected ?? d.date

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
      return `${name} rate ${rulePreposition(catalog, [rule])} ${ruleWhat(catalog, rule, card)}: ${rate(was)} → ${rate(now)}`
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

const sentence = (t: string) => (/[.!?]["')]?$/.test(t) ? t : `${t}.`)

// How long a change stays on a cardholder's to-do list.
export const HOLDER_NEWS_DAYS = 60

// The card page's "Recent changes", which lists earnrate's recent
// corrections too, so a to-do line can link there.
export const RECENT_CHANGES_ID = 'recent-changes'
export const cardChangesUrl = (cardId: string) =>
  `https://earnrate.dev/cards/${cardId}#${RECENT_CHANGES_ID}`

const issuerOf = (catalog: Catalog, cardId: string) => {
  const card = catalog.cards.find((c) => c.id === cardId)
  return catalog.issuers.find((i) => i.id === card?.issuer)?.name ?? ''
}

const sourceText = (url: string | undefined) =>
  url === undefined ? '' : ` Source: ${url}`

// A to-do line about an issuer's change to a held card: the old and new
// terms and the issuer's page. A welcome offer's is only for a bonus being
// tracked from the published offer, whose tracking now uses the new terms.
export function holderChangeText(catalog: Catalog, d: DatedChange): string {
  const { change } = d
  const issuer = issuerOf(catalog, change.cards?.[0] ?? '')
  const source = sourceText(change.source)
  const headline = sentence(changeHeadline(catalog, change))
  const effective =
    change.effective === undefined
      ? ''
      : `, effective ${shortDate(change.effective)}`
  const kind = change.field?.split('.')[0]
  if (kind === 'welcome_offer')
    return `${headline} ${issuer} changed it for new applicants${effective}; earnrate now tracks your welcome bonus at the new terms, so set yours if you got the old offer.${source}`
  if (kind === 'applications_closed') return `${headline}${source}`
  return `${headline} ${issuer} made this change${effective}; earnrate's answers already use the new terms.${source}`
}

// One to-do line for earnrate's recent corrections to a held card, newest
// first: one is said in full, more are counted with a link to the card page.
export function holderFixesText(
  catalog: Catalog,
  cardId: string,
  name: string, // as the to-do list names the card
  fixes: DatedChange[],
): { text: string; url?: string } {
  const issuer = issuerOf(catalog, cardId)
  const [only] = fixes
  if (fixes.length === 1 && only !== undefined) {
    const url = only.change.source
    return {
      text: `earnrate fixed its own mistake about ${name} (${issuer} didn't change anything): ${sentence(only.change.summary ?? '')} Answers before ${shortDate(only.date)} used the old value.${sourceText(url)}`,
      ...(url === undefined ? {} : { url }),
    }
  }
  const url = cardChangesUrl(cardId)
  return {
    text: `earnrate fixed ${String(fixes.length)} of its own mistakes about ${name} (${issuer} didn't change anything); answers already use the fixed terms. See what changed: ${url}`,
    url,
  }
}

// One to-do line for earnrate's recent corrections across several held
// cards: none of them asks anything of the user, so they share a line.
export const holderFixesAcrossText = (names: string[]) =>
  `earnrate fixed some of its own mistakes about ${listed(names.length > 4 ? [...names.slice(0, 3), `${String(names.length - 3)} more of your cards`] : names)} (their issuers didn't change anything); answers already use the fixed terms. Asking about a card shows what changed, and so does its page on earnrate.dev, under Recent changes.`

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
