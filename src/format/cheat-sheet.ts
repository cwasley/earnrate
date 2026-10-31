import type { CheatSheet } from '../engine/cheat-sheet.ts'

const pct = (n: number) => `${String(Number(n.toFixed(2)))}%`

export function formatCheatSheet(sheet: CheatSheet): string {
  const labelWidth = Math.max(...sheet.rows.map((r) => r.label.length))
  const cardWidth = Math.max(
    ...sheet.rows.map((r) => (r.cardName ?? 'none of your cards').length),
  )
  const lines = [
    sheet.scope === 'wallet'
      ? `Your cheat sheet for ${sheet.quarter}`
      : `The best card for each kind of purchase, ${sheet.quarter}`,
    '',
  ]
  for (const row of sheet.rows) {
    lines.push(
      `  ${row.label.padEnd(labelWidth)}  ${(row.cardName ?? 'none of your cards').padEnd(cardWidth)}  ${row.effectiveReturnPct === null ? '' : pct(row.effectiveReturnPct).padStart(5)}`.trimEnd(),
    )
    if (row.note)
      lines.push(
        `  ${' '.repeat(labelWidth)}  ${sheet.scope === 'wallet' ? '! ' : ''}${row.note}`,
      )
  }
  if (sheet.notes.length > 0) lines.push('', ...sheet.notes)
  return `${lines.join('\n')}\n`
}
