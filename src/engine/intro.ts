import type { Card, IntroRate } from '../schema/card.ts'
import type { WalletCard } from '../schema/wallet.ts'
import { addDays } from './periods.ts'

// Node-free: earnrate.dev ranks with it in the browser.

export type IntroWindow = {
  intro: IntroRate
  until: string // YYYY-MM-DD, its last day
}

// Never assumed: a card without a date is ranked at its standard rates.
export const openedOn = (held: WalletCard): string | null =>
  held.opened ?? held.bonus?.opened ?? null

// The opening day is day 1, so 365 days run through the day before the first
// anniversary.
export const introUntil = (intro: IntroRate, opened: string) =>
  addDays(opened, intro.days - 1)

// The card's intro rates in effect on `date`.
export function introWindows(
  card: Card,
  held: WalletCard,
  date: string,
): IntroWindow[] {
  const opened = openedOn(held)
  if (opened === null || date < opened) return []
  return card.intro_rates.flatMap((intro) => {
    const until = introUntil(intro, opened)
    return date <= until ? [{ intro, until }] : []
  })
}

// Whether an intro rate changes this rule's rate (null: the base rate). Past
// a cap only a whole-card intro applies.
export const introCovers = (
  intro: IntroRate,
  ruleId: string | null,
  pastCap = false,
) =>
  intro.rules === undefined ||
  (!pastCap && ruleId !== null && intro.rules.includes(ruleId))

export function withIntro(
  rate: number,
  ruleId: string | null,
  windows: IntroWindow[],
  pastCap = false,
): number {
  let out = rate
  for (const { intro } of windows) {
    if (!introCovers(intro, ruleId, pastCap)) continue
    out =
      intro.multiply !== undefined
        ? out * intro.multiply
        : out + (intro.add ?? 0)
  }
  return out
}
