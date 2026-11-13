// The changes a card's Settings sends for its opening date and welcome
// bonus. Each sends only what the control changes: a bonus already saved
// keeps the spending recorded on it (perhaps in Claude, since the panel
// opened) when its date changes.
import type { CardInput } from '../../src/engine/wallet-change.ts'
import type { WalletCard } from '../../src/schema/wallet.ts'

type Change = Omit<CardInput, 'id'>

const dollars = (text: string) => Math.max(0, Number(text) || 0)

// `unsaved` is spending typed before there was a date to save the bonus with.
const newBonus = (date: string, unsaved: string) => ({
  opened: date,
  spent: dollars(unsaved),
})

export function trackingChange(
  held: WalletCard,
  on: boolean,
  opened: string,
  unsaved: string,
): Change | null {
  if (on && !held.bonus && opened !== '')
    return { bonus: newBonus(opened, unsaved) }
  if (!on && held.bonus) return { bonus: null }
  return null
}

// The card's date and its bonus's go in one change, so they never differ.
export function openedChange(
  held: WalletCard,
  date: string,
  {
    tracking,
    introRates,
    unsaved,
  }: { tracking: boolean; introRates: boolean; unsaved: string },
): Change | null {
  const forCard = introRates
    ? date !== ''
      ? { opened: date }
      : held.opened === undefined
        ? {}
        : { opened: null }
    : date !== '' && held.opened !== undefined
      ? { opened: date }
      : {}
  const forBonus =
    tracking && date !== ''
      ? { bonus: held.bonus ? { opened: date } : newBonus(date, unsaved) }
      : {}
  const change = { ...forCard, ...forBonus }
  return Object.keys(change).length > 0 ? change : null
}

export function spentChange(
  held: WalletCard,
  opened: string,
  text: string,
): Change | null {
  const date = held.bonus?.opened ?? opened
  return date === '' ? null : { bonus: { opened: date, spent: dollars(text) } }
}
