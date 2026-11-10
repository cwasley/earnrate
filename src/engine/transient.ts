import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import {
  addToWallet,
  withMemberships,
  type CardInput,
} from './wallet-change.ts'

export const EMPTY_WALLET: Wallet = {
  valuations: {},
  memberships: [],
  cards: [],
}

export type NamedCards = {
  cards: CardInput[]
  memberships?: string[]
}

// A wallet for one answer, from cards the user named in the conversation.
// Nothing is saved; the same rules as adding cards to a saved wallet apply.
export function walletFromCards(
  catalog: Catalog,
  named: NamedCards,
  today: string,
): Wallet | string {
  let wallet: Wallet | null = null
  const ids = named.cards.map((c) => c.id)
  const twice = ids.find((id, i) => ids.indexOf(id) !== i)
  if (twice !== undefined)
    return `${twice} is listed twice in cards; name each card once.`
  for (const input of named.cards) {
    const change = addToWallet(catalog, wallet, input, today)
    if (!change.ok) return change.error
    wallet = change.wallet
  }
  if (!wallet) return 'Name at least one card.'
  if (named.memberships && named.memberships.length > 0) {
    const change = withMemberships(catalog, wallet, named.memberships)
    if (!change.ok) return change.error
    wallet = change.wallet
  }
  return wallet
}
