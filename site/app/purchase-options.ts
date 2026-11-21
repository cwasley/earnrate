import { capitalize, PAYMENT_PHRASES } from '../../src/engine/text.ts'
import type { MerchantResolution } from '../../src/engine/types.ts'
import type { PaymentMethod } from '../../src/schema/card.ts'

// How one purchase is made, in the words the site and the iPhone app share.
// Node- and DOM-free, so the app's engine bundle can use it.

export const THIS_PURCHASE = 'This purchase'
export const PAYING_WITH = 'Paying with'

// Unknown unless the visitor picks one: a rate that needs Apple Pay never
// applies by assumption.
export const PAYING_CHOICES: { value: PaymentMethod | null; label: string }[] =
  [
    { value: null, label: 'Not sure' },
    { value: 'card', label: 'Card' },
    { value: 'apple-pay', label: 'Apple Pay' },
    { value: 'paypal', label: 'PayPal' },
  ]

export const payingNote = (payment: PaymentMethod | null) =>
  payment === null ? '' : ` · ${PAYMENT_PHRASES[payment]}`

// The engine tells only the U.S. from everywhere else, so the page asks just
// that and never names a country.
export const ABROAD_LABEL = 'Paying outside the U.S.'
export const ABROAD_WORDS = 'outside the U.S.'
export const ABROAD_NOTE = ` · ${ABROAD_WORDS}`

// "With Apple Pay? Amex Gold earns 4x here."
export const payingHintText = (
  payment: PaymentMethod,
  name: string,
  earn: string,
) => `${capitalize(PAYMENT_PHRASES[payment])}? ${name} earns ${earn} here.`

// Shown only when how you pay would change the best card, one per way of
// paying and two at most. An unidentified store can't say whether it takes
// Apple Pay or PayPal.
export function payingHints(answer: {
  merchant: Pick<MerchantResolution, 'source'>
  ifPaying: { cardId: string; payment: PaymentMethod; earn: string }[]
}): { cardId: string; payment: PaymentMethod; earn: string }[] {
  if (answer.merchant.source === 'none') return []
  return [
    ...new Map(answer.ifPaying.map((p) => [p.payment, p])).values(),
  ].slice(0, 2)
}
