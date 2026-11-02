// earnrate never stores card numbers, on any surface. A card number is 13 to
// 19 digits; a phone number in a store's name is 10 or 11, so free text with
// a longer run is refused or not kept.
const digitsOnly = (text: string) => text.replace(/[\s.-]/g, '')

export const hasCardNumber = (text: string): boolean =>
  /\d{13,}/.test(digitsOnly(text))

// A checkout label may carry a last four, but never 8 or more digits.
export const labelHasCardNumber = (text: string): boolean =>
  /\d{8,}/.test(digitsOnly(text))

export const CARD_NUMBER_LABEL =
  'The checkout label looks like it has a card number in it. earnrate never stores card numbers; use a name like "Amex Gold".'

export const CARD_NUMBER_REDEMPTION =
  'The redemption note looks like it has a card number in it. earnrate never stores card numbers.'

// For wallets saved before the schema refused card numbers: drop the field
// instead of failing to load, since a wallet that can't load can't be fixed.
export function withoutCardNumbers(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const wallet = { ...raw }
  if (Array.isArray(wallet.cards))
    wallet.cards = wallet.cards.map((card: unknown) =>
      isRecord(card) && isCardNumber(card.checkout_label, labelHasCardNumber)
        ? omit(card, 'checkout_label')
        : card,
    )
  if (isRecord(wallet.valuations))
    wallet.valuations = Object.fromEntries(
      Object.entries(wallet.valuations).map(([currency, value]) => [
        currency,
        isRecord(value) && isCardNumber(value.redemption, hasCardNumber)
          ? omit(value, 'redemption')
          : value,
      ]),
    )
  return wallet
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCardNumber = (value: unknown, test: (text: string) => boolean) =>
  typeof value === 'string' && test(value)

const omit = (record: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
