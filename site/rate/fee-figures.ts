import { listed, roundCents, wholeDollars } from '../../src/engine/text.ts'
import type { FeeVerdict } from '../../src/engine/wallet-report.ts'

export type FeeFigure = { label: string; value: string }

// "+$129", "−$211", "$0"
const signed = (n: number) =>
  `${Math.round(n) > 0 ? '+' : ''}${wholeDollars(n)}`

// A card with an annual fee on /rate as figures, from the numbers behind
// `feeCardShort` and `feeCardCreditsShort`: what it adds, what that is
// after its fee, and what it would be with every credit used.
export function feeFigures(v: FeeVerdict): {
  figures: FeeFigure[]
  counting: string | null
} {
  const gross = v.net + v.fee
  const u = v.unsaid
  return {
    figures: [
      {
        label: v.alone
          ? v.against === null
            ? 'Earns'
            : `More than the ${v.against}`
          : 'Adds',
        value: wholeDollars(Math.max(0, gross)),
      },
      { label: 'After its fee', value: signed(v.net) },
      ...(u.yearly > 0
        ? [
            {
              label:
                u.nights > 0 ? 'Up to, with every credit' : 'With every credit',
              value: signed(roundCents(v.net + u.yearly)),
            },
          ]
        : []),
    ],
    counting:
      v.used.length === 0
        ? null
        : `Counts ${v.used.length <= 3 ? listed(v.used) : `${String(v.used.length)} credits`}.`,
  }
}
