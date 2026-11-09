import type { PaymentMethod } from '../../src/schema/card.ts'
import { capitalize, PAYMENT_PHRASES } from '../../src/engine/text.ts'
import type { MerchantResolution } from '../../src/engine/types.ts'
import { shortName } from './format.ts'

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

// Shown only when how you pay would change the best card; one tap sets it.
// An unidentified store can't say whether it takes Apple Pay or PayPal.
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
  if (answer.merchant.source === 'none') return null
  const hints = [
    ...new Map(answer.ifPaying.map((p) => [p.payment, p])).values(),
  ].slice(0, 2)
  return (
    <>
      {hints.map((p) => (
        <button
          type="button"
          class="paying-hint"
          key={p.payment}
          onClick={() => onPick(p.payment)}
        >
          {capitalize(PAYMENT_PHRASES[p.payment])}? {shortName(p.cardId)} earns{' '}
          {p.earn} here.
        </button>
      ))}
    </>
  )
}
