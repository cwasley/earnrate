import { monthYear, wholeDollars } from '../../src/engine/text.ts'
import {
  pairBeats,
  type BestCards,
  type ReportStart,
} from '../../src/engine/wallet-report.ts'

// Who the report talks to: "you" on the page, "I" in the picture someone
// posts of their own report, and neither in a picture of a report someone
// else shared.
export type Voice = 'you' | 'I' | 'neutral'

// What follows the headline figure, which counts only the credits marked
// as used: "a year in rewards, after fees".
export function perYear(
  start: { counted: readonly unknown[] },
  voice: Voice = 'you',
): string {
  if (start.counted.length === 0)
    return ' a\u00a0year in rewards, after\u00a0fees'
  return voice === 'neutral'
    ? ' a\u00a0year in rewards and credits used, after\u00a0fees'
    : ` a\u00a0year in rewards and credits ${voice} use, after\u00a0fees`
}

// Under the figure while some credits aren't answered: what the cards
// would net with every one used. "Up to +$3,150 if you use every credit"
export function upToText(
  start: Pick<ReportStart, 'range'>,
  voice: Voice = 'you',
): string | null {
  if (start.range === null) return null
  const { low, high } = start.range
  const amount = `${low < 0 && high > 0 ? '+' : ''}${wholeDollars(high)}`
  return voice === 'neutral'
    ? `Up to ${amount} if every credit is\u00a0used`
    : `Up to ${amount} if ${voice} use every\u00a0credit`
}

export type CompareRow = { label: string; value: number | null; mine: boolean }

// The cards rated, the best two, and the best no-fee card with one rate, on
// one scale.
// A value is null while it's being worked out.
export function comparisonRows(
  start: ReportStart,
  best: BestCards | null,
  cardName: (cardId: string) => string,
  voice: Voice = 'you',
): CompareRow[] {
  const top = best === null ? null : pairBeats(best) ? best.pair : best.single
  return [
    {
      label:
        start.cards.length === 1
          ? cardName(start.cards[0]?.cardId ?? '')
          : voice === 'you'
            ? 'Your cards'
            : voice === 'I'
              ? 'My cards'
              : 'These cards',
      value: start.net,
      mine: true,
    },
    {
      label:
        top === null
          ? 'The best two cards'
          : top.cards.length === 2
            ? `Best two: ${top.cards.map((c) => cardName(c.cardId)).join(' + ')}`
            : `Best one: ${cardName(top.cards[0]?.cardId ?? '')}`,
      value: top?.net ?? null,
      mine: false,
    },
    ...(start.flat === null
      ? []
      : [
          {
            label: `${cardName(start.flat.cardId)} alone`,
            value: start.flat.net,
            mine: false,
          },
        ]),
  ]
}

export const countedNote = (voice: Voice = 'you') =>
  voice === 'you'
    ? 'Credits count only in your figure.'
    : voice === 'I'
      ? 'Credits count only in my figure.'
      : 'Credits count only in the first figure.'

export type RatePicture = {
  title: string
  subtitle: string
  cards: { cardId: string; name: string }[]
  figure: string
  per: string
  upTo: string | null
  rows: { label: string; amount: string; value: number; quiet: boolean }[]
  notes: string[]
  link: string
}

// Every word the report's picture holds: the headline and the comparison as
// the page shows them, in the first person, or neutral for a report someone
// else shared. Never an amount of spending, a point value, a card id, a
// credit's answer or a link.
export function ratePictureText(
  start: ReportStart,
  best: BestCards | null,
  cardName: (cardId: string) => string,
  today: string,
  voice: Exclude<Voice, 'you'> = 'I',
): RatePicture | null {
  if (start.empty || best === null) return null
  const rows = comparisonRows(start, best, cardName, voice)
  const n = start.cards.length
  const mine = voice === 'I'
  const cards =
    n === 1
      ? mine
        ? 'My card'
        : 'This card'
      : `${mine ? 'My' : 'These'} ${String(n)} cards`
  return {
    title: 'Rate my wallet',
    subtitle: `${cards} · ${monthYear(today)}`,
    cards: start.cards.map((c) => ({
      cardId: c.cardId,
      name: cardName(c.cardId),
    })),
    figure: wholeDollars(start.net),
    per: perYear(start, voice).trim(),
    upTo: upToText(start, voice),
    rows: rows.flatMap((r) =>
      r.value === null
        ? []
        : [
            {
              label: r.label,
              amount: wholeDollars(r.value),
              value: r.value,
              quiet: !r.mine,
            },
          ],
    ),
    notes: [
      ...(start.counted.length > 0 ? [countedNote(voice)] : []),
      `${start.typical ? 'On typical U.S. spending' : mine ? 'On my own spending' : 'On the cardholder’s spending'}. Credits count only once marked used.`,
    ],
    link: 'earnrate.dev/rate',
  }
}
