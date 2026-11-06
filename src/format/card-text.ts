import type { Requirements } from '../engine/explore.ts'
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'

// Card names, fees and requirements as earnrate.dev and its static search
// pages show them. Node-free: the site bundles it.

import { membershipName, membershipText } from '../engine/memberships.ts'
import {
  capSentence,
  earnText,
  PICK_PERIODS,
  wholeDollars,
  words,
} from '../engine/text.ts'

// An issuer's name as people know it, from data/issuers.yaml.
export const issuerName = (catalog: Catalog, id: string) =>
  catalog.issuers.find((i) => i.id === id)?.name ?? id

export function cardText(catalog: Catalog) {
  const cards = new Map<string, Card>(catalog.cards.map((c) => [c.id, c]))

  function shortName(id: string): string {
    const name = cards.get(id)?.name ?? id
    return (
      name
        .replace(/^American Express /, 'Amex ')
        .replace(/^The Platinum Card from American Express$/, 'Amex Platinum')
        // "Card" is part of Apple Card's name, not a suffix.
        .replace(
          / (Visa Signature |Visa Infinite )?(Credit )?(?<!^Apple )Card$/,
          '',
        )
        .replace(/ Card by /, ' by ')
    )
  }

  function feeLabel(id: string): string {
    const card = cards.get(id)
    const m = card?.requires_membership
    const needs = m === undefined ? '' : `; needs ${membershipText(catalog, m)}`
    const fee = card?.annual_fee
    if (fee === undefined) return 'Annual fee not on file'
    if (fee === 0) return `No annual fee${needs}`
    const first = card?.first_year_fee
    if (first !== undefined && first !== fee)
      return `${wholeDollars(fee)} a year (${first === 0 ? 'waived' : wholeDollars(first)} the first year)${needs}`
    return `${wholeDollars(fee)} a year${needs}`
  }

  // `until` is the last day a time-limited rate applies, already formatted.
  function requirementLines(
    cardId: string,
    r: Requirements,
    until: string | null = null,
  ): string[] {
    const lines: string[] = []
    if (r.pick)
      lines.push(
        `Pick ${r.pick.options.map(words).join(' or ')} as a bonus category (${PICK_PERIODS[r.pick.period]})`,
      )
    if (r.activation !== null)
      lines.push(
        `Activate the bonus with ${issuerName(catalog, cards.get(cardId)?.issuer ?? '')} (free)`,
      )
    if (r.membership !== null)
      lines.push(`With ${membershipName(catalog, r.membership)}`)
    if (until !== null) lines.push(`This rate runs through ${until}`)
    if (r.cap)
      lines.push(
        capSentence(r.cap, earnText(catalog, r.cap.thenRate, r.cap.currency)),
      )
    return lines
  }

  const memberName = (id: string) => membershipName(catalog, id)

  return {
    cards,
    shortName,
    feeLabel,
    requirementLines,
    membershipName: memberName,
    issuerName: (id: string) => issuerName(catalog, id),
  }
}
