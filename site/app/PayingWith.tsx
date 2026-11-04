import type { PaymentMethod } from '../../src/schema/card.ts'
import { PAYMENT_PHRASES } from '../../src/engine/text.ts'

// Unknown unless the visitor picks one: a rate that needs Apple Pay never
// applies by assumption.
const CHOICES: { value: PaymentMethod | null; label: string }[] = [
  { value: null, label: 'Not sure' },
  { value: 'card', label: 'Card' },
  { value: 'apple-pay', label: 'Apple Pay' },
  { value: 'paypal', label: 'PayPal' },
]

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
      <legend>Paying with</legend>
      <div class="segments">
        {CHOICES.map((c) => (
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

export const payingNote = (payment: PaymentMethod | null) =>
  payment === null ? '' : ` · ${PAYMENT_PHRASES[payment]}`
