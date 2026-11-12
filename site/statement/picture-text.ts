import { HALF_CENT } from '../../src/engine/compare.ts'
import {
  dollarsAndCents,
  listed,
  roundCents,
  wholeDollars,
} from '../../src/engine/text.ts'
import type { StatementAnalysis } from '../../src/import/analyze.ts'
import { monthSpan, yearlyPace } from './check.ts'

export type PictureText = {
  title: string
  subtitle: string
  figure: string
  caption: string
  pace: string | null
  rows: { label: string; amount: string; value: number; quiet: boolean }[]
  notes: string[]
  link: string
}

const plural = (n: number, one: string) =>
  `${String(n)} ${n === 1 ? one : `${one}s`}`

// Every word the picture holds. Totals only, so the picture can be posted:
// no store, no single purchase, no day finer than the month, no file name.
export function pictureText(
  analysis: StatementAnalysis,
  cardName: (cardId: string) => string,
  values: string | null,
): PictureText | null {
  const a = analysis
  if (a.purchases === 0) return null
  const gain = roundCents(a.best - a.earned)
  const differs = gain > HALF_CENT
  const pace = yearlyPace(a)
  const used = a.byCard.map((t) => cardName(t.cardId))
  return {
    title: 'My statement check',
    subtitle: `${monthSpan(a.from, a.to)} · ${plural(a.purchases, 'purchase')}`,
    figure: differs ? `${dollarsAndCents(gain)} more` : 'No difference',
    caption: differs
      ? 'with the best of my cards for each purchase'
      : 'I used the best of my cards for every purchase.',
    pace:
      pace === null
        ? null
        : `At this pace, about ${wholeDollars(pace)} a year.`,
    rows: [
      {
        label:
          used.length <= 2
            ? `Earned on ${listed(used)}`
            : 'Earned on the cards I used',
        amount: dollarsAndCents(a.earned),
        value: a.earned,
        quiet: true,
      },
      {
        label: 'With the best of my cards',
        amount: dollarsAndCents(a.best),
        value: a.best,
        quiet: false,
      },
    ],
    notes: [
      "Rewards rates only: statement credits and bonuses aren't counted.",
      ...(values ? [values] : []),
    ],
    link: 'earnrate.dev/statement',
  }
}
