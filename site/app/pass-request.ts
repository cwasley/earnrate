import type { Wallet } from '../../src/schema/wallet.ts'

// What the cheat-sheet pass needs, and all that's sent for it, from the
// site's form and the iPhone app alike: card ids, picks, activations,
// checkout labels, memberships and the date. Never amounts or searches. The
// signer (pass/) keeps nothing.

export const PASS_URL = 'https://pass.earnrate.dev/'

// Under the button, on the site and in the app. Both must say the same
// about what's sent.
export const PASS_NOTE =
  "For iPhone: this cheat sheet in Apple Wallet, good until the quarter ends. This sends the card names and picks (no amounts) to earnrate's server, which makes the pass and keeps nothing."
export const PASS_NOTE_IN_APP =
  "Puts this cheat sheet in Apple Wallet until the quarter ends. It sends the card names and picks (no amounts) to earnrate's server, which makes the pass and keeps nothing."

// The form's two fields: `wallet` (JSON) and `date` (the device's day).
export function passForm(
  wallet: Wallet,
  today: string,
): { wallet: string; date: string } {
  return {
    wallet: JSON.stringify({
      memberships: wallet.memberships,
      cards: wallet.cards.map((c) => ({
        id: c.id,
        checkout_label: c.checkout_label,
        chosen: c.chosen,
        activated: c.activated,
      })),
    }),
    date: today,
  }
}
