import type { CreditChoice } from '../../src/engine/credits.ts'
import { listed } from '../../src/engine/text.ts'
import { issuerName } from '../../src/format/card-text.ts'
import type { Catalog } from '../../src/schema/catalog.ts'

// "Enroll in Grubhub and Resy with American Express so they pay.": the
// credits marked used that pay only once enrolled. Null when there are none.
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
  return `Enroll in ${listed(names)} with ${issuerName(catalog, card.issuer)} so ${names.length === 1 ? 'it pays' : 'they pay'}.`
}
