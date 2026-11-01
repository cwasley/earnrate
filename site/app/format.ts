import { catalog } from 'virtual:catalog'
import { cardText, issuerName } from '../../src/format/card-text.ts'

export { issuerName, usd, words } from '../../src/format/card-text.ts'
export { pct } from '../../src/engine/text.ts'

export const { cards, shortName, feeLabel, requirementLines, membershipName } =
  cardText(catalog)

export const issuers = [...new Set(catalog.cards.map((c) => c.issuer))].sort(
  (a, b) => issuerName(a).localeCompare(issuerName(b)),
)

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
