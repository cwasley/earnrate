import type { Card } from '../schema/card.ts'
import { periodKey } from './periods.ts'

// The period of the card's rotating categories that `date` falls in, when no
// rule in the data covers it yet; null when it's covered or the card doesn't
// rotate.
export function rotationGap(card: Card, date: string): string | null {
  for (const cap of card.caps) {
    if (!cap.rotating || cap.period === 'cardmember_year') continue
    const covered = card.rules.some(
      (r) =>
        r.cap === cap.id &&
        (r.valid_from ?? '') <= date &&
        date <= (r.valid_to ?? ''),
    )
    if (!covered) return periodKey(cap.period, date, null)
  }
  return null
}

// What answers say about a gap: "Freedom Flex's rotating categories for
// 2027-Q2 aren't in earnrate's data yet. ..."
export const rotationGapText = (name: string, gap: string) =>
  `${name}'s rotating categories for ${gap} aren't in earnrate's data yet. An earnrate update adds them once the issuer announces them.`
