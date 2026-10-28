import type {
  ExcludedCard,
  Purchase,
  RankedCard,
  Recommendation,
} from '../engine/types.ts'

export type Style = (format: 'bold' | 'dim' | 'yellow', text: string) => string

export const plain: Style = (_format, text) => text

const TOP = 3

const pct = (n: number) => `${String(Number(n.toFixed(2)))}%`
const cents = (n: number) => `$${n.toFixed(2)}`
const amountText = (n: number) =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`

const label = (c: RankedCard | ExcludedCard) => c.checkoutLabel ?? c.cardName

function header(rec: Recommendation, purchase: Purchase): string {
  const m = rec.merchant
  const parts = [
    m.source === 'none'
      ? `"${m.resolvedName}" (not recognized)`
      : m.source === 'caller'
        ? `${m.resolvedName} (category given)`
        : m.source === 'llm'
          ? m.category === 'other'
            ? `"${m.resolvedName}" (Claude couldn't place it)`
            : `${m.resolvedName} (classified by Claude)`
          : m.resolvedName,
  ]
  if (purchase.amount !== null) parts.push(amountText(purchase.amount))
  if (m.channel) parts.push(m.channel === 'online' ? 'online' : 'in-store')
  return parts.join(' · ')
}

function cardLines(cards: RankedCard[], style: Style): string[] {
  const nameWidth = Math.max(...cards.map((c) => label(c).length))
  const pctWidth = Math.max(
    ...cards.map((c) => pct(c.effectiveReturnPct).length),
  )
  const lines: string[] = []
  cards.forEach((c, i) => {
    const earned = c.earned === null ? '' : `  ${cents(c.earned)}`
    lines.push(
      `  ${String(i + 1)}. ${label(c).padEnd(nameWidth)}  ${pct(c.effectiveReturnPct).padStart(pctWidth)}${earned}`,
    )
    for (const r of c.reasoning) lines.push(style('dim', `     ${r}`))
    for (const w of c.warnings) lines.push(style('yellow', `     ! ${w}`))
  })
  return lines
}

function excludedLines(excluded: ExcludedCard[]): string[] {
  const byReason = new Map<string, string[]>()
  for (const e of excluded) {
    byReason.set(e.reason, [...(byReason.get(e.reason) ?? []), label(e)])
  }
  return [...byReason].map(
    ([reason, names]) => `Can't use here: ${names.join(', ')}. ${reason}`,
  )
}

export function formatRecommendation(
  rec: Recommendation,
  purchase: Purchase,
  {
    all = false,
    style = plain,
    notices = [],
  }: { all?: boolean; style?: Style; notices?: string[] } = {},
): string {
  const lines = [header(rec, purchase), '']
  const top =
    rec.ranked.find((r) => r.cardId === rec.decision?.cardId) ?? rec.ranked[0]
  const noCard = `None of your cards work at ${rec.merchant.resolvedName}.`

  if (rec.decision && top) {
    const earned = top.earned === null ? '' : `, about ${cents(top.earned)}`
    const confidence = rec.decision.confidence
    const why = rec.bonus ? ' for its welcome bonus' : ''
    lines.push(
      `${style('bold', `Use ${label(top)}${why}: ${pct(top.effectiveReturnPct)} back${earned}.`)} ${confidence[0]?.toUpperCase() ?? ''}${confidence.slice(1)} confidence.`,
    )
    if (rec.bonus && rec.notes[0]) lines.push(rec.notes[0])
  } else {
    lines.push(style('bold', noCard))
  }

  const shown = all ? rec.ranked : rec.ranked.slice(0, TOP)
  if (shown.length > 0) lines.push('', ...cardLines(shown, style))
  const hidden = rec.ranked.length - shown.length
  if (hidden > 0) {
    lines.push(
      style(
        'dim',
        `  + ${String(hidden)} more ${hidden === 1 ? 'card' : 'cards'} (--all lists them)`,
      ),
    )
  }

  const notes = rec.bonus ? rec.notes.slice(1) : rec.notes
  const extras = [...notes, ...excludedLines(rec.excluded)]
  if (extras.length > 0) lines.push('', ...extras)

  const warnings = [...rec.warnings.filter((w) => w !== noCard), ...notices]
  if (warnings.length > 0) {
    lines.push('', ...warnings.map((w) => style('yellow', `! ${w}`)))
  }
  if (rec.sensitivity) lines.push('', rec.sensitivity)
  if (rec.assumptions.length > 0) {
    lines.push('', ...rec.assumptions.map((a) => style('dim', a)))
  }
  return `${lines.join('\n')}\n`
}
