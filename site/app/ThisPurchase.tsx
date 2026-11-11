import type { PaymentMethod } from '../../src/schema/card.ts'
import { AbroadToggle } from './AbroadToggle.tsx'
import { PayingWith } from './PayingWith.tsx'

// How one purchase is made. At a store and My wallet share it for the visit;
// it isn't saved, so the next visit starts at "Not sure" in the U.S.
export type Purchase = { abroad: boolean; payment: PaymentMethod | null }

export const ANY_PURCHASE: Purchase = { abroad: false, payment: null }

export const purchaseCount = (p: Purchase): number =>
  (p.abroad ? 1 : 0) + (p.payment ? 1 : 0)

export function ThisPurchase({
  purchase,
  onChange,
  name,
}: {
  purchase: Purchase
  onChange: (p: Purchase) => void
  name: string
}) {
  return (
    <fieldset class="filter-group">
      <legend>This purchase</legend>
      <AbroadToggle
        abroad={purchase.abroad}
        onChange={(abroad) => onChange({ ...purchase, abroad })}
      />
      <PayingWith
        name={name}
        payment={purchase.payment}
        onChange={(payment) => onChange({ ...purchase, payment })}
      />
    </fieldset>
  )
}

export function PurchaseOptions({
  purchase,
  onChange,
}: {
  purchase: Purchase
  onChange: (p: Purchase) => void
}) {
  const active = purchaseCount(purchase)
  return (
    <details class="filters">
      <summary>
        How you're paying
        {active > 0 ? <span class="badge">{active}</span> : null}
      </summary>
      <div class="filter-panel">
        <ThisPurchase
          name="wallet-paying"
          purchase={purchase}
          onChange={onChange}
        />
      </div>
    </details>
  )
}
