import type { Exploration, ExploreEntry, Picks } from '../engine/explore.ts'
import type {
  CatalogSimulation,
  Simulation,
  WalletWhatIf,
} from '../engine/simulate.ts'
import { membershipNote, type MembershipCost } from '../engine/memberships.ts'
import { feeText, membershipName, money, pct } from '../engine/text.ts'
import type { Catalog } from '../schema/catalog.ts'

const wholeUsd = (n: number) => money(Math.round(n))

const membershipText = (memberships: MembershipCost[]) =>
  memberships
    .map(
      (m) => ` + ${wholeUsd(m.annualFee)} for ${m.name.replace(/^an? /, '')}`,
    )
    .join('')

const TOP_BEST = 10

export function formatExploration(r: Exploration, all: boolean): string {
  const m = r.merchant
  const title =
    m.source === 'category'
      ? m.resolvedName.toLowerCase()
      : m.source === 'none'
        ? `"${m.input}" (not recognized)`
        : m.resolvedName
  if (r.ranked.length === 0) return `No cards match at ${title}.\n`
  const shown = all ? r.ranked : r.ranked.slice(0, TOP_BEST)
  const width = Math.max(...shown.map((e) => e.cardName.length))
  const lines = [`Best cards for ${title}:`, '']
  shown.forEach((e: ExploreEntry, i) => {
    const earned = e.earned === null ? '' : `  ${money(e.earned)}`
    lines.push(
      `${String(i + 1).padStart(2)}. ${e.cardName.padEnd(width)}  ${pct(e.effectiveReturnPct).padStart(5)}${earned}  ${feeText(e)}`,
    )
    for (const c of e.conditions) lines.push(`    ${c}`)
    const upgrade = e.withMembership[0]
    if (upgrade)
      lines.push(
        `    With ${membershipName(upgrade.membership)}: ${pct(upgrade.effectiveReturnPct)}.`,
      )
    for (const w of e.warnings) lines.push(`    ! ${w}`)
  })
  if (r.ranked.length > shown.length)
    lines.push(
      `  + ${String(r.ranked.length - shown.length)} more (--all lists them)`,
    )
  for (const w of r.warnings) lines.push('', `! ${w}`)
  lines.push('', ...r.assumptions)
  return `${lines.join('\n')}\n`
}

function picksText(picks: Picks): string {
  const parts = Object.entries(picks).map(
    ([choice, options]) => `${choice}: ${options.join(', ')}`,
  )
  return parts.length === 0 ? '' : ` (picks ${parts.join('; ')})`
}

function cardNamer(catalog: Catalog) {
  return (id: string) => catalog.cards.find((c) => c.id === id)?.name ?? id
}

function splitText(sim: Simulation, name: (id: string) => string): string[] {
  const byCard = new Map<string, string[]>()
  for (const line of sim.lines) {
    const first = line.cards[0]
    if (first === undefined) continue
    byCard.set(first, [...(byCard.get(first) ?? []), line.label])
  }
  return [...byCard].map(([id, labels]) => `${labels.join(', ')} → ${name(id)}`)
}

const TOP_SIMULATED = 5

export function formatCatalogSimulation(
  r: CatalogSimulation,
  catalog: Catalog,
  all: boolean,
): string {
  const name = cardNamer(catalog)
  const first = r.singles[0]
  if (!first) return 'No cards match.\n'
  const top = all ? 20 : TOP_SIMULATED
  const lines = [
    `A year of this spending: ${wholeUsd(first.spend)}.`,
    '',
    'Best single cards (rewards minus annual fee, per year):',
  ]
  r.singles.slice(0, top).forEach((s, i) => {
    const card = s.cards[0]
    if (!card) return
    lines.push(
      `${String(i + 1).padStart(2)}. ${name(card.cardId)}  ${wholeUsd(s.net)}  (${wholeUsd(s.rewards)} rewards, ${wholeUsd(s.annualFees)} fee${membershipText(s.memberships)})${picksText(card.picks)}`,
    )
  })
  const pairs = r.pairs.slice(0, top)
  if (pairs.length > 0) {
    lines.push('', 'Best two-card pairs:')
    pairs.forEach((s, i) => {
      lines.push(
        `${String(i + 1).padStart(2)}. ${s.cards.map((c) => `${name(c.cardId)}${picksText(c.picks)}`).join(' + ')}  ${wholeUsd(s.net)}`,
      )
      if (s.alternatives.length > 0)
        lines.push(
          `    Same result with ${s.alternatives.map(name).join(' or ')} as the second card.`,
        )
      for (const split of splitText(s, name)) lines.push(`    ${split}`)
    })
    const bestPair = r.pairs[0]
    if (bestPair && bestPair.net <= first.net)
      lines.push(
        '',
        `One card is enough here: no pair beats ${name(first.cards[0]?.cardId ?? '')}.`,
      )
  }
  const notes = new Set([
    ...r.singles.slice(0, top).flatMap((s) => s.notes),
    ...pairs.flatMap((s) => s.notes),
  ])
  if (notes.size > 0) lines.push('', ...notes)
  lines.push(
    '',
    "Assumes each card's best picks, activations done each quarter, and no welcome bonuses.",
  )
  return `${lines.join('\n')}\n`
}

export function formatAdditions(
  r: WalletWhatIf,
  catalog: Catalog,
  all: boolean,
): string {
  const name = cardNamer(catalog)
  const lines = [
    `Your wallet earns about ${wholeUsd(r.current.rewards)} a year on this spending${r.current.annualFees > 0 ? `, with ${wholeUsd(r.current.annualFees)} in annual fees: ${wholeUsd(r.current.net)} after fees` : ''}.`,
  ]
  for (const split of splitText(r.current, name)) lines.push(`  ${split}`)
  const gains = r.additions.filter((a) => a.gain > 0)
  if (gains.length === 0) {
    lines.push('', 'No card would add more than its annual fee costs.')
  } else {
    lines.push(
      '',
      'Cards that would add the most (after their annual fee and any membership they need):',
    )
    gains.slice(0, all ? 20 : TOP_SIMULATED).forEach((a, i) => {
      lines.push(
        `${String(i + 1).padStart(2)}. ${name(a.cardId)}  +${wholeUsd(a.gain)} a year  (+${wholeUsd(a.extraRewards)} rewards, ${wholeUsd(a.annualFee)} fee${membershipText(a.simulation.memberships.filter((m) => m.cardIds.includes(a.cardId)))})${picksText(a.picks)}`,
      )
    })
  }
  const notes = new Set([
    ...r.current.notes,
    ...gains
      .slice(0, all ? 20 : TOP_SIMULATED)
      .flatMap((a) =>
        a.simulation.memberships.map((m) => membershipNote(catalog, m)),
      ),
  ])
  if (notes.size > 0) lines.push('', ...notes)
  lines.push(
    '',
    'Assumes your picks carry over, rotating categories get activated, and caps start fresh. Each kind of spending lists the card that earns the most on it over the whole year, so a one-quarter bonus may not show.',
  )
  return `${lines.join('\n')}\n`
}
