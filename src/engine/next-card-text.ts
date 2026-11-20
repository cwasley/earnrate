// Next cards and Best setups, in the words earnrate.dev's Best setups tab and
// the iPhone app's Next card tab both show. Node-free.
import type { Catalog } from '../schema/catalog.ts'
import type { CardFilters, Picks } from './explore.ts'
import { pickName } from './rule-text.ts'
import type { Simulation } from './simulate.ts'
import {
  CREDITS_APART,
  categoryPhrase,
  listed,
  shortDate,
  wholeDollars,
  words,
} from './text.ts'
import { OFFERS_MAY_DIFFER } from './offers.ts'

// Which cards an answer compares.
export const REWARD_KINDS: { id: CardFilters['kind']; label: string }[] = [
  { id: 'any', label: 'Cash back and points' },
  { id: 'cash', label: 'Cash back only' },
  { id: 'points', label: 'Points and miles only' },
]
export const NO_FEE_FILTER = 'No annual fee'
export const BUSINESS_FILTER = 'Business cards instead'

export const spendingBasisText = (typical: boolean, monthly: number) =>
  typical
    ? `On typical U.S. spending, about ${wholeDollars(monthly)} a month.`
    : `On your spending, ${wholeDollars(monthly)} a month.`

// A dollar figure that adds to something: "+$1,050", or "-$40".
export const signedDollars = (n: number) =>
  `${n > 0 ? '+' : ''}${wholeDollars(n)}`

// ---------------------------------------------------------------------------
// A new card: what each would add over its first two years.

export const NEXT_CARD_LEAD = {
  yours: 'What each card would add to your cards over its first two years.',
  every: 'What each card would earn over its first two years.',
}
export const TWO_YEARS_LEAD =
  "With each card's welcome bonus, if the minimum spend fits, less its fees."
export const NO_OFFER_AHEAD =
  "No card's first two years would add more than its fees cost."
export const TWO_YEARS_PER = '/2 yrs'
export const yearOneText = (n: number) => `${wholeDollars(n)} year one`
export const yearTwoText = (n: number) => `${wholeDollars(n)} year two`
export const HOW_RANKED = 'How this is ranked'

// "Offer ends Dec 31, 2026. Public offer as of Nov 18, 2026."
export const offerAsOfText = (o: {
  validTo: string | null
  lastVerified: string
}) =>
  `${o.validTo ? `Offer ends ${shortDate(o.validTo)}. ` : ''}Public offer as of ${shortDate(o.lastVerified)}.`

// The same, short, under a row's offer: "Offer as of Nov 18, 2026, ends
// Dec 31".
export const offerAsOfShortText = (o: {
  validTo: string | null
  lastVerified: string
}) =>
  `Offer as of ${shortDate(o.lastVerified)}${o.validTo ? `, ends ${shortDate(o.validTo)}` : ''}`

// Cards an issuer counts together for its repeat-bonus rule share one note,
// under the first of them; the others point to it.
export const sameRuleText = (name: string) =>
  `Same bonus rule as the ${name}, above.`

// "With a membership: Sam's Club Mastercard +$36, Costco Anywhere Visa +$29
// a year": cards that need one the wallet doesn't have, in one line.
export const withMembershipText = (items: string[], per: string) =>
  `With a membership: ${items.join(', ')} ${per}.`

export const showMoreText = (n: number) => `Show ${String(n)} more`

// ---------------------------------------------------------------------------
// Best setups: every card alone and in pairs.

export const BEST_SETUPS = 'Best setups'
export const BEST_SETUPS_WORKING = 'Comparing every card and pair'
export const BEST_SETUPS_LEAD =
  'Every card alone, and the best pairs, on a year of typical spending.'
export const SINGLE_CARD = 'Single card'
export const TWO_CARDS = 'Two cards'
export const PER_YEAR = '/yr'
export const HOW_CALCULATED = 'How this is calculated'
export const BONUS_UNLIKELY = 'bonus unlikely'
export const BONUS_OUT_OF_REACH = 'bonus out of reach'
export const BONUS_UNSURE = 'bonus may not apply'
export const SEE_CARD_DETAILS = 'See card details'
export const ADD_TO_MY_WALLET = 'Add to my wallet'

export const firstYearText = (n: number) => `${wholeDollars(n)} first year`

// A card's annual fee on a row: "$95/yr", "$0, then $95/yr" when the first
// year's is different, "No annual fee".
export function shortFeeText(card: {
  annual_fee?: number | undefined
  first_year_fee?: number | undefined
}): string {
  const fee = card.annual_fee
  if (fee === undefined) return 'Fee not on file'
  if (fee === 0) return NO_FEE_FILTER
  const first = card.first_year_fee
  const year = `${wholeDollars(fee)}${PER_YEAR}`
  return first === undefined || first === fee
    ? year
    : `${wholeDollars(first)}, then ${year}`
}
export const tiesText = (n: number) =>
  `${String(n)} more ${n === 1 ? 'ties' : 'tie'}`
export const feesText = (n: number) => `${wholeDollars(n)} in fees`
export const backBeforeFeeText = (n: number) =>
  `${wholeDollars(n)} back a year before the fee.`
export const backBeforeFeesText = (n: number) =>
  `${wholeDollars(n)} back a year before fees.`
export const welcomeOfferText = (terms: string) => `Welcome offer: ${terms}.`
export const noPairBeatsText = (name: string) =>
  `No pair beats the ${name} alone.`
export const sameResultText = (names: string[]) =>
  `Same result with ${listed(names, 'or')} instead.`

export const HOW_SETUPS = [
  'Rewards minus annual fees over the next 12 months, with caps filling and resetting as they would. Each card uses its best category picks, with any bonus activations done.',
  `Welcome offers pay once, so they don't change the order. A card's first-year figure adds its public offer if this spending, all on that card, reaches the minimum in time, and uses the first year's fee. Pairs leave offers out. ${OFFERS_MAY_DIFFER}`,
  CREDITS_APART,
]

// "Picks: grocery stores and gas stations".
export function picksText(
  catalog: Catalog,
  cardId: string,
  picks: Picks,
): string | null {
  const card = catalog.cards.find((c) => c.id === cardId)
  const all = Object.entries(picks).flatMap(([choice, options]) =>
    options.map((o) => (card ? pickName(catalog, card, choice, o) : words(o))),
  )
  return all.length === 0 ? null : `Picks: ${listed(all)}`
}

const OTHER = (catalog: Catalog) =>
  catalog.categories.find((c) => c.id === 'other')?.name

// Category names read mid-sentence in lower case; store names keep theirs.
function phrase(catalog: Catalog, label: string): string {
  const category = catalog.categories.find((c) => c.name === label)
  return category ? categoryPhrase(catalog, category.id) : label
}

// Each card in a setup with the spending lines it takes, "Everything else"
// last.
export function splitParts(
  catalog: Catalog,
  sim: Simulation,
): { id: string; covers: string }[] {
  const other = OTHER(catalog)
  const byCard = new Map<string, string[]>()
  for (const line of sim.lines) {
    const first = line.cards[0]
    if (first !== undefined)
      byCard.set(first, [...(byCard.get(first) ?? []), line.label])
  }
  return [...byCard].map(([id, labels]) => ({
    id,
    covers: listed(
      [...labels]
        .sort((a, b) => Number(a === other) - Number(b === other))
        .map((l) => phrase(catalog, l)),
    ),
  }))
}

// The pair's cards with what each covers; the one that takes "Everything
// else" covers the rest.
export function pairParts(
  catalog: Catalog,
  sim: Simulation,
): { id: string; covers: string }[] {
  const other = OTHER(catalog)
  const byCard = new Map<string, string[]>()
  for (const line of sim.lines) {
    const first = line.cards[0]
    if (first !== undefined)
      byCard.set(first, [...(byCard.get(first) ?? []), line.label])
  }
  return [...byCard]
    .map(([id, labels]) => ({
      id,
      covers:
        other !== undefined && labels.includes(other)
          ? 'the rest'
          : listed(labels.map((l) => phrase(catalog, l))),
    }))
    .sort(
      (a, b) =>
        Number(a.covers === 'the rest') - Number(b.covers === 'the rest'),
    )
}

// "Amex Gold for dining and groceries; Double Cash for the rest".
export const pairSplitText = (
  parts: { id: string; covers: string }[],
  shortName: (id: string) => string,
) => parts.map((p) => `${shortName(p.id)} for ${p.covers}`).join('; ')
