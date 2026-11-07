import type { Exploration, ExploreEntry, Picks } from '../engine/explore.ts'
import type {
  CatalogSimulation,
  Simulation,
  WalletWhatIf,
} from '../engine/simulate.ts'
import {
  membershipName,
  membershipNote,
  type MembershipCost,
} from '../engine/memberships.ts'
import {
  capitalize,
  choiceName,
  CREDIT_GROUP,
  CREDITS_APART,
  ENROLL_FIRST,
  HELD_CREDITS_COUNTED,
  hostname,
  feeText,
  dollarsAndCents,
  pct,
  wholeDollars,
  words,
  listed,
} from '../engine/text.ts'
import type { Catalog } from '../schema/catalog.ts'

const membershipFees = (memberships: MembershipCost[]) =>
  memberships
    .map((m) => ` + ${wholeDollars(m.annualFee)} for ${m.name}`)
    .join('')

const TOP_BEST = 10

// " · $X if you'd use all its credits ($424 a year)"
const ifCredits = (credits: number, net: number, sign = '', its = 'its') =>
  credits > 0
    ? ` · ${sign}${wholeDollars(net)} if you'd use all ${its} credits (${wholeDollars(credits)} a year)`
    : ''

export function formatExploration(
  r: Exploration,
  catalog: Catalog,
  all: boolean,
): string {
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
  const lines = [
    ...(r.credits.length === 0
      ? []
      : [
          `${CREDIT_GROUP} at ${title}:`,
          '',
          ...r.credits.flatMap((c) => [
            `- ${c.cardName}: ${c.text}${c.enroll ? ` (${ENROLL_FIRST})` : ''}. ${capitalize(feeText(c))}.`,
            ...(c.evidence
              ? [`    "${c.evidence.quote}" (${hostname(c.evidence.url)})`]
              : []),
          ]),
          '',
        ]),
    `Best cards for ${title}${r.credits.length === 0 ? '' : ' by rate'}:`,
    '',
  ]
  shown.forEach((e: ExploreEntry, i) => {
    const earned = e.earned === null ? '' : `  ${dollarsAndCents(e.earned)}`
    lines.push(
      `${String(i + 1).padStart(2)}. ${e.cardName.padEnd(width)}  ${pct(e.effectiveReturnPct).padStart(5)}${earned}  ${feeText(e)}`,
    )
    for (const c of e.conditions) lines.push(`    ${c}`)
    const upgrade = e.withMembership[0]
    if (upgrade)
      lines.push(
        `    With ${membershipName(catalog, upgrade.membership)}: ${pct(upgrade.effectiveReturnPct)}.`,
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
    ([choice, options]) =>
      `${listed(options.map(words))} as its ${choiceName(choice)} ${options.length === 1 ? 'pick' : 'picks'}`,
  )
  return parts.length === 0 ? '' : ` (with ${parts.join('; ')})`
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
    `A year of this spending: ${wholeDollars(first.spend)}.`,
    '',
    'Best single cards (rewards minus annual fee, per year):',
  ]
  r.singles.slice(0, top).forEach((s, i) => {
    const card = s.cards[0]
    if (!card) return
    lines.push(
      `${String(i + 1).padStart(2)}. ${name(card.cardId)}  ${wholeDollars(s.net)}  (${wholeDollars(s.rewards)} rewards, ${wholeDollars(s.annualFees)} fee${membershipFees(s.memberships)})${ifCredits(s.otherCredits, s.netIfCreditsUsed)}${picksText(card.picks)}`,
    )
  })
  const pairs = r.pairs.slice(0, top)
  if (pairs.length > 0) {
    lines.push('', 'Best two-card pairs:')
    pairs.forEach((s, i) => {
      lines.push(
        `${String(i + 1).padStart(2)}. ${s.cards.map((c) => `${name(c.cardId)}${picksText(c.picks)}`).join(' + ')}  ${wholeDollars(s.net)}${ifCredits(s.otherCredits, s.netIfCreditsUsed, '', 'their')}`,
      )
      if (s.alternatives.length > 0)
        lines.push(
          `    Same result with ${listed(s.alternatives.map(name), 'or')} as the second card.`,
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
    `Assumes each card's best picks, activations done each quarter, and no welcome bonuses. ${CREDITS_APART}`,
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
    `Your wallet earns about ${wholeDollars(r.current.rewards)} a year on this spending${r.current.annualFees > 0 ? `, with ${wholeDollars(r.current.annualFees)} in annual fees${r.current.heldCredits > 0 ? ` and ${wholeDollars(r.current.heldCredits)} of credits you use` : ''}: ${wholeDollars(r.current.net)} after fees` : ''}.`,
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
        `${String(i + 1).padStart(2)}. ${name(a.cardId)}  +${wholeDollars(a.gain)} a year  (+${wholeDollars(a.extraRewards)} rewards, ${wholeDollars(a.annualFee)} fee${membershipFees(a.simulation.memberships.filter((m) => m.cardIds.includes(a.cardId)))})${ifCredits(a.credits, a.gainIfCreditsUsed, '+')}${picksText(a.picks)}`,
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
    `Assumes your picks carry over, rotating categories get activated, and caps start fresh. ${r.current.heldCredits > 0 ? `${HELD_CREDITS_COUNTED} ` : ''}${CREDITS_APART} Perks like lounge access aren't counted. Each kind of spending lists the card that earns the most on it over the whole year, so a one-quarter bonus may not show.`,
  )
  return `${lines.join('\n')}\n`
}
