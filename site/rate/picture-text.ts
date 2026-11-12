import { monthYear, wholeDollars } from '../../src/engine/text.ts'
import {
  netFigure,
  pairBeats,
  type BestCards,
  type ReportStart,
} from '../../src/engine/wallet-report.ts'

// Who the report talks to: "you" on the page, "I" in the picture someone
// posts of their own report.
export type Voice = 'you' | 'I'

// What follows the headline figure: "a year after fees, depending on which
// credits you use".
export function perYear(
  start: Pick<ReportStart, 'range' | 'counted'>,
  voice: Voice = 'you',
): string {
  if (start.range !== null)
    return ` a\u00a0year after fees, depending on which credits ${voice}\u00a0use`
  return start.counted.length > 0
    ? ` a\u00a0year in rewards and credits ${voice} use, after\u00a0fees`
    : ' a\u00a0year in rewards, after\u00a0fees'
}

export type CompareRow = { label: string; value: number | null; mine: boolean }

// The cards rated, the best two, and the one flat-rate card, on one scale.
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
            : 'My cards',
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
    ? 'Your figure counts the credits you use; the other two count none.'
    : 'My figure counts the credits I use; the other two count none.'

export type RatePicture = {
  title: string
  subtitle: string
  cards: { cardId: string; name: string }[]
  figure: string
  per: string
  rows: { label: string; amount: string; value: number; quiet: boolean }[]
  notes: string[]
  link: string
}

// Every word the report's picture holds: the headline and the comparison as
// the page shows them, in the first person. Never an amount of spending,
// a point value, a card id, a credit's answer or a link.
export function ratePictureText(
  start: ReportStart,
  best: BestCards | null,
  cardName: (cardId: string) => string,
  today: string,
): RatePicture | null {
  if (start.empty || best === null) return null
  const rows = comparisonRows(start, best, cardName, 'I')
  const n = start.cards.length
  return {
    title: 'Rate my wallet',
    subtitle: `${n === 1 ? 'My card' : `My ${String(n)} cards`} · ${monthYear(today)}`,
    cards: start.cards.map((c) => ({
      cardId: c.cardId,
      name: cardName(c.cardId),
    })),
    figure: netFigure(start),
    per: perYear(start, 'I').trim(),
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
      ...(start.counted.length > 0 ? [countedNote('I')] : []),
      `${start.typical ? 'On typical U.S. spending' : 'On my own spending'}. Credits count only once marked used.`,
    ],
    link: 'earnrate.dev/rate',
  }
}
