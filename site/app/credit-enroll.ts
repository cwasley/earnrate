import type { CreditChoice } from '../../src/engine/credits.ts'
import { listed } from '../../src/engine/text.ts'
import { issuerName } from '../../src/format/card-text.ts'
import type { Catalog } from '../../src/schema/catalog.ts'

// "Grubhub and Resy pay only once you've enrolled with American Express.":
// the credits marked used that pay only once enrolled. Marked used and
// enrolled are one mark, so it reminds rather than tells. Null when there
// are none.
export function enrollLine(
  catalog: Catalog,
  cardId: string,
  choices: CreditChoice[],
): string | null {
  const names = choices
    .filter((c) => c.enroll && c.answer === 'used')
    .map((c) => c.name)
  const card = catalog.cards.find((c) => c.id === cardId)
  if (names.length === 0 || !card) return null
  return `${listed(names)} ${names.length === 1 ? 'pays' : 'pay'} only once you've enrolled with ${issuerName(catalog, card.issuer)}.`
}
