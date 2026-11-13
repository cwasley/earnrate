import { listed, wholeDollars } from '../../src/engine/text.ts'
import type { CardShare } from '../../src/engine/wallet-report.ts'

export type FeeFigure = { label: string; value: string }

// A card with an annual fee on /rate as three figures that add up: what it
// earns in this wallet, its fee, and what it nets, which is its part of
// the headline figure (`cardShares`).
export function shareFigures(s: CardShare): FeeFigure[] {
  return [
    { label: 'Earns', value: wholeDollars(s.earned) },
    { label: 'Fee', value: wholeDollars(-s.fee) },
    { label: 'Nets', value: wholeDollars(s.net) },
  ]
}

// The credits counted in what it earns: "Counts Chase Travel."
export function countedText(names: string[]): string {
  if (names.length === 0) return ''
  return `Counts ${names.length <= 3 ? listed(names) : `${String(names.length)} credits`}.`
}
