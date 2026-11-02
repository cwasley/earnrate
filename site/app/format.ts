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

export const issuers = [...new Set(catalog.cards.map((c) => c.issuer))].sort(
  (a, b) => issuerName(a).localeCompare(issuerName(b)),
)
