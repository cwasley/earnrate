import type { Catalog } from '../schema/catalog.ts'
import { WalletCardSchema, type Wallet } from '../schema/wallet.ts'
import {
  feeWorthAnswer,
  feeWorthKit,
  TRANSFER_VALUES,
  type FeeWorthAnswer,
} from './fee-worth.ts'
import { headlineRates } from './wallet-summary.ts'

// A search weighs each card's fee only when it finds this many cards or
// fewer: the fee math simulates a year of spending at many amounts.
export const DETAILED_UP_TO = 3

export const DETAILS_LEFT_OUT = `Earning rates and whether an annual fee is worth it come with a search that finds ${String(DETAILED_UP_TO)} cards or fewer: search for the card by name.`

export type CardDetails = {
  earning: string[] // its rates now, best first, as the wallet list says them
  feeWorth: FeeWorthAnswer | null // null without an annual fee
}

// Rates count the saved memberships (and one the card itself needs); the
// fee math counts the saved point values and what the person says a held
// card's free night is worth to them, and is run again at transfer value
// for points that transfer, as the card page does, unless the wallet sets
// their value.
export function cardDetails(
  catalog: Catalog,
  ids: string[],
  saved: Wallet | null,
  today: string,
): CardDetails[] | null {
  if (ids.length > DETAILED_UP_TO) return null
  const valuations = saved?.valuations ?? {}
  const heldCards = saved?.cards ?? []
  const { feeWorth } = feeWorthKit(catalog, today, valuations, heldCards)
  let transferred: ReturnType<typeof feeWorthKit> | null = null
  return ids.map((id) => {
    const card = catalog.cards.find((c) => c.id === id)
    if (!card) throw new Error(`unknown card '${id}'`)
    const held =
      saved?.cards.find((c) => c.id === id) ?? WalletCardSchema.parse({ id })
    const wallet: Wallet = {
      valuations,
      memberships: saved?.memberships ?? [],
      cards: [held],
    }
    const worth = feeWorth(card)
    const cents = TRANSFER_VALUES[card.currency]
    const transfer =
      worth === null ||
      cents === undefined ||
      valuations[card.currency] !== undefined
        ? null
        : {
            worth: (transferred ??= feeWorthKit(
              catalog,
              today,
              { ...valuations, ...TRANSFER_VALUES },
              heldCards,
            )).feeWorth(card),
            cents,
          }
    return {
      earning: headlineRates(catalog, wallet, card, held, card.currency, today),
      feeWorth:
        worth === null
          ? null
          : feeWorthAnswer(catalog, worth, valuations, transfer),
    }
  })
}
