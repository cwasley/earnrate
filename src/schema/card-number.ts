// earnrate never stores card numbers, on any surface. A card number is 13 to
// 19 digits; a phone number in a store's name is 10 or 11, so free text with
// a longer run is refused or not kept.
export const hasCardNumber = (text: string): boolean =>
  /\d{13,}/.test(text.replace(/[\s.-]/g, ''))

// A checkout label may carry a last four, but never 8 or more digits.
export const labelHasCardNumber = (text: string): boolean =>
  /\d{8,}/.test(text.replace(/[\s-]/g, ''))

export const CARD_NUMBER_LABEL =
  'The checkout label looks like it has a card number in it. earnrate never stores card numbers; use a name like "Amex Gold".'
