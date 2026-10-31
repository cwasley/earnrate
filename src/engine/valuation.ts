import type { Catalog } from '../schema/catalog.ts'
import type { Card } from '../schema/card.ts'
import type { Wallet } from '../schema/wallet.ts'

export type Valuation = {
  currency: string
  centsPerUnit: number
  range: [number, number] | null
  pooledFrom: string | null // the card's own currency, when it pooled into another
}

export function currencyValuation(
  catalog: Catalog,
  wallet: Wallet,
  currencyId: string,
): Omit<Valuation, 'pooledFrom'> {
  const currency = catalog.currencies.find((c) => c.id === currencyId)
  if (!currency) throw new Error(`unknown currency '${currencyId}'`)

  let cents = currency.value_cents
  let range = currency.range ?? null
  const override = wallet.valuations[currencyId]
  if (typeof override === 'number') {
    cents = override
  } else if (override) {
    if (override.redemption !== undefined) {
      cents = currency.redemptions?.[override.redemption] ?? cents
    }
    if (override.value !== undefined) cents = override.value
    if (override.range) range = override.range
  }
  return { currency: currencyId, centsPerUnit: cents, range }
}

export function cardValuation(
  catalog: Catalog,
  wallet: Wallet,
  card: Card,
): Valuation {
  const held = new Set(wallet.cards.map((c) => c.id))
  const pool = card.pools_into
  if (pool && pool.when_wallet_has.some((id) => held.has(id))) {
    return {
      ...currencyValuation(catalog, wallet, pool.currency),
      pooledFrom: card.currency,
    }
  }
  return {
    ...currencyValuation(catalog, wallet, card.currency),
    pooledFrom: null,
  }
}
