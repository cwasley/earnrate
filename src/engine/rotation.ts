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
