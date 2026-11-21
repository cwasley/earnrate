import { longDate } from '../../src/engine/text.ts'

// The words on a cheat sheet's picture, shared by the site's canvas drawing
// and the iPhone app's. Only the sheet itself: no store, amount or name of
// the person.

export const SHEET_PICTURE_TITLE = 'My card cheat sheet'

export const sheetPictureSubtitle = (quarter: string) =>
  `${quarter} · the card to use for each purchase`

// A purchase none of the cards earn on, such as Costco without a Visa.
export const NO_CARD_OF_YOURS = 'None of your cards'

export const sheetPictureFooter = (date: string) => [
  `Rates from each issuer's own terms, as of ${longDate(date)}.`,
  'No affiliate links.',
]

export const SHEET_PICTURE_SITE = 'earnrate.dev'

export const sheetPictureFile = (quarter: string) =>
  `earnrate-cheat-sheet-${quarter.toLowerCase().replace(/\s+/g, '-')}.png`
