import {
  bonusEligibility,
  type MonthAsk,
} from '../../src/engine/repeat-bonus.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Wallet } from '../../src/schema/wallet.ts'

// What the issuer's repeat-bonus rule says about having had a card, for its
// row under Cards you've had, with the month it asks for; no text for a
// card with no offer, whose rule there's nothing to check against.
export function pastCardNote(
  catalog: Catalog,
  wallet: Wallet,
  id: string,
  today: string,
): { text: string | null; ask: MonthAsk | null } {
  if (wallet.cards.some((c) => c.id === id))
    return { text: "It's in your wallet now too.", ask: null }
  const again = bonusEligibility(catalog, wallet, id, today)
  if (again === null) return { text: null, ask: null }
  if (again.state === 'eligible')
    return {
      text: "You can earn its bonus again, by the issuer's rule.",
      ask: null,
    }
  return { text: again.text, ask: again.ask }
}
