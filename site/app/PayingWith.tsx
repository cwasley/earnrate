import type { PaymentMethod } from '../../src/schema/card.ts'
import type { MerchantResolution } from '../../src/engine/types.ts'
import { shortName } from './format.ts'
import {
  PAYING_CHOICES,
  PAYING_WITH,
  payingHints,
  payingHintText,
} from './purchase-options.ts'

export { payingNote } from './purchase-options.ts'

export function PayingWith({
  payment,
  onChange,
  name,
}: {
  payment: PaymentMethod | null
  onChange: (payment: PaymentMethod | null) => void
  name: string // unique per form, so each group's radios stay separate
}) {
  return (
    <fieldset class="paying">
      <legend>{PAYING_WITH}</legend>
      <div class="segments">
        {PAYING_CHOICES.map((c) => (
          <label key={c.label} class={c.value === payment ? 'on' : undefined}>
            <input
              type="radio"
              name={name}
              checked={c.value === payment}
              onChange={() => onChange(c.value)}
            />
            {c.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

// Shown only when how you pay would change the best card; one tap sets it.
export function PayingHints({
  answer,
  onPick,
}: {
  answer: {
    merchant: MerchantResolution
    ifPaying: { cardId: string; payment: PaymentMethod; earn: string }[]
  }
  onPick: (payment: PaymentMethod) => void
}) {
  return (
    <>
      {payingHints(answer).map((p) => (
        <button
          type="button"
          class="paying-hint"
          key={p.payment}
          onClick={() => onPick(p.payment)}
        >
          {payingHintText(p.payment, shortName(p.cardId), p.earn)}
        </button>
      ))}
    </>
  )
}
