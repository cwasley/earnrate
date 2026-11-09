import type { ChecklistItem } from '../engine/checklist.ts'
import type {
  BonusBooking,
  CapBooking,
  CreditBooking,
  MilestoneBooking,
} from '../engine/record.ts'
import {
  CAP_PERIODS,
  introAdjective,
  introSince,
  money,
  NETWORK_NAMES,
  periodPhrase,
  roundCents,
  shortDate,
  possessive,
} from '../engine/text.ts'
import type { WalletSummary } from '../engine/wallet-summary.ts'

// "To do now", above the card details; nothing when all's done.
export function formatChecklist(items: ChecklistItem[]): string {
  return items.length === 0
    ? ''
    : `To do now:\n${items.map((i) => `- ${i.text}`).join('\n')}\n\n`
}

export function formatWalletSummary(summary: WalletSummary): string {
  const cards = summary.cards.map((c) => {
    const label = c.checkoutLabel
      ? `, shown at checkout as "${c.checkoutLabel}"`
      : ''
    const lines = [
      `- ${c.cardName} (${c.cardId})${label}: ${NETWORK_NAMES[c.network] ?? c.network}, ${c.currencyName} at ${String(c.centsPerUnit)}¢. Data checked ${c.lastVerified}${c.dataIsStale ? ' (old; check the issuer)' : ''}.`,
      `  Earns: ${c.rates.join('; ')}.`,
    ]
    if (c.onlyAt) lines.push(`  Works only at ${c.onlyAt.join(', ')}.`)
    if (c.chosen) {
      const picks = Object.entries(c.chosen.pickNames)
        .map(([choice, names]) => `${choice}: ${names.join(', ')}`)
        .join('; ')
      const until = c.chosen.until
        ? `, through ${shortDate(c.chosen.until)}`
        : ''
      lines.push(
        !c.chosen.current
          ? `  Picks are for ${c.chosen.period}, which is over: ask for this period's picks.`
          : c.chosen.until === null
            ? `  Picks: ${picks}. They stay until the user changes them.`
            : `  Picks for ${c.chosen.period}${until}: ${picks}. Pick again after that.`,
      )
    }
    if (c.toActivate.length > 0)
      lines.push(
        `  Not activated yet: ${c.toActivate.join('; ')}. Activating once with the issuer covers each group.`,
      )
    if (c.rotationGap !== null)
      lines.push(
        `  Rotating categories for ${c.rotationGap} aren't in earnrate yet.`,
      )
    for (const cap of c.caps)
      lines.push(
        cap.remaining === null
          ? `  Cap on ${cap.label}: ${money(cap.amount)} ${CAP_PERIODS[cap.period]}; give the card's anniversary to track it (cap key ${cap.key}).`
          : `  Cap on ${cap.label}: ${money(cap.spent)} of ${money(cap.amount)} used ${periodPhrase(cap.period, cap.currentPeriod ?? '')}${cap.until === null ? '' : `, through ${shortDate(cap.until)}`} (cap key ${cap.key}).`,
      )
    for (const m of c.milestones)
      lines.push(`  Spend bonus (${m.id}): ${m.text}`)
    for (const credit of c.credits)
      lines.push(`  Credit (${credit.id}): ${credit.text}`)
    for (const night of c.freeNights)
      lines.push(`  Free night (${night.id}): ${night.text}`)
    if (c.usedCreditsText !== null) lines.push(`  ${c.usedCreditsText}`)
    if (c.anniversary !== null)
      lines.push(`  Account anniversary: ${c.anniversary}.`)
    if (c.intro?.state === 'active' && c.intro.until !== null)
      lines.push(
        `  Opened ${c.opened ?? ''}: ${introAdjective(c.intro.days)} rates through ${shortDate(c.intro.until)}.`,
      )
    else if (c.intro?.state === 'no-date')
      lines.push(
        `  Has ${introAdjective(c.intro.days)} rates for new accounts; give its opening date if it opened ${introSince(c.intro.days)}.`,
      )
    else if (c.opened !== null) lines.push(`  Opened ${shortDate(c.opened)}.`)
    const b = c.bonus
    if (b?.state === 'open' && b.spend !== null)
      lines.push(
        `  Welcome bonus: ${money(b.spent)} of ${money(b.spend)} spent, due ${b.deadline === null ? 'by its deadline' : shortDate(b.deadline)}.`,
      )
    else if (b) lines.push(`  Welcome bonus: ${b.state}.`)
    return lines.join('\n')
  })
  const memberships =
    summary.memberships.length > 0
      ? `Memberships: ${summary.memberships.map((id, i) => `${summary.membershipNames[i] ?? id} (${id})`).join(', ')}.`
      : 'Memberships: none saved.'
  const values =
    summary.pointValues.length > 0
      ? `Point values in the wallet: ${summary.pointValues.map((v) => `${v.name} at ${String(v.centsPerUnit)}¢${v.redemption === null ? '' : ` (redeemed ${v.redemption})`}`).join(', ')}. Others use earnrate's defaults.`
      : "Point values: earnrate's defaults."
  const skipped =
    summary.skippedIssuers.length > 0
      ? [
          `Next-card answers leave out: ${summary.skippedIssuers.map((i) => `${i.name} (${i.id})`).join(', ')}.`,
        ]
      : []
  return [...cards, memberships, ...skipped, values].join('\n')
}

// "its U.S. supermarkets cap"; a label that's a phrase of its own ("the
// category you spend the most in each month") goes after the noun.
const capPhrase = (label: string) =>
  /^the /.test(label) ? `its cap on ${label}` : `its ${label} cap`

export function formatBooking(
  amount: number,
  name: string, // the card's short name
  cap: CapBooking | null,
  bonus: BonusBooking | null,
  milestones: MilestoneBooking[] = [],
  credit: CreditBooking | null = null,
  capLabel: string | null = null, // what the cap covers, in words
): string {
  const messages: string[] = []
  if (credit)
    messages.push(
      `Used ${money(roundCents(credit.after - credit.before))} of ${possessive(name)} ${credit.name} credit: ${money(credit.after)} of ${money(credit.amount)} ${periodPhrase(credit.periodKind, credit.period)}, ${money(roundCents(Math.max(0, credit.amount - credit.after)))} left.`,
    )
  if (cap) {
    const left = Math.max(0, cap.capAmount - cap.after)
    messages.push(
      `Recorded ${money(amount)} on ${name} toward ${capPhrase(capLabel ?? cap.capKey)}: ${money(cap.before)} → ${money(cap.after)} of ${money(cap.capAmount)} ${periodPhrase(cap.periodKind, cap.period)}, ${money(left)} left.`,
    )
  }
  if (bonus) {
    const left = Math.max(0, bonus.spend - bonus.after)
    messages.push(
      left === 0
        ? `Welcome bonus spend met on ${name}: ${money(bonus.after)} of ${money(bonus.spend)}.`
        : `Welcome bonus on ${name}: ${money(bonus.after)} of ${money(bonus.spend)} spent, ${money(left)} to go by ${bonus.deadline === null ? 'the deadline' : shortDate(bonus.deadline)}.`,
    )
  }
  // Every milestone counts the same purchases, so one line covers them.
  const first = milestones[0]
  if (first) {
    const reached = milestones.filter(
      (m) => m.before < m.spend && m.after >= m.spend,
    )
    const next = milestones.find((m) => m.after < m.spend)
    const period =
      first.periodKind === 'cardmember_year' ? 'cardmember year' : 'year'
    messages.push(
      [
        first.started
          ? `Started tracking spend on ${name} this ${period} with this purchase: ${money(first.after)}. Spending on it earlier this ${period} isn't counted; give the total so far (milestoneSpent) to include it.`
          : `Spend on ${name} this ${period}: ${money(first.after)}.`,
        ...reached.map(
          (m) => `That reaches its ${money(m.spend)} spend bonus.`,
        ),
        ...(next && !first.started
          ? [
              `${money(next.spend - next.after)} to go for the ${money(next.spend)} spend bonus.`,
            ]
          : []),
      ].join(' '),
    )
  }
  return messages.join(' ')
}
