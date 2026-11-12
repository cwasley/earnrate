import { catalog } from 'virtual:catalog'
import { cardText } from '../../src/format/card-text.ts'

export { pct, wholeDollars, words } from '../../src/engine/text.ts'

export const {
  cards,
  shortName,
  feeLabel,
  requirementLines,
  membershipName,
  issuerName,
} = cardText(catalog)

// The card's own short name where its data gives one ("Capital One
// Venture X"), for places with room for little more than a word or two.
export const shortestName = (id: string) =>
  cards.get(id)?.short_name ?? shortName(id)

export const cardCount = (n: number) => `${String(n)} card${n === 1 ? '' : 's'}`

export const issuers = [...new Set(catalog.cards.map((c) => c.issuer))].sort(
  (a, b) => issuerName(a).localeCompare(issuerName(b)),
)
