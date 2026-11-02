import type { BonusBooking, CapBooking } from '../engine/record.ts'
import { money, NETWORK_NAMES, shortDate } from '../engine/text.ts'
import type { WalletSummary } from '../engine/wallet-summary.ts'

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
      if (cap.remaining !== null)
        lines.push(
          `  Cap on ${cap.label}: ${money(cap.spent)} of ${money(cap.amount)} used for ${cap.currentPeriod ?? ''} (cap key ${cap.key}).`,
        )
    if (c.anniversary !== null)
      lines.push(`  Account anniversary: ${c.anniversary}.`)
    const b = c.bonus
    if (b?.state === 'open' && b.spend !== null)
      lines.push(
        `  Welcome bonus: ${money(b.spent)} of ${money(b.spend)} spent, due ${b.deadline ?? ''}.`,
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
  return [...cards, memberships, values].join('\n')
}

export function formatBooking(
  amount: number,
  cardId: string,
  cap: CapBooking | null,
  bonus: BonusBooking | null,
): string {
  const messages: string[] = []
  if (cap) {
    const left = Math.max(0, cap.capAmount - cap.after)
    messages.push(
      `Recorded ${money(amount)} on ${cardId} against "${cap.capKey}": ${money(cap.before)} → ${money(cap.after)} of ${money(cap.capAmount)} for ${cap.period}, ${money(left)} left.`,
    )
  }
  if (bonus) {
    const left = Math.max(0, bonus.spend - bonus.after)
    messages.push(
      left === 0
        ? `Welcome bonus spend met on ${cardId}: ${money(bonus.after)} of ${money(bonus.spend)}.`
        : `Welcome bonus on ${cardId}: ${money(bonus.after)} of ${money(bonus.spend)} spent, ${money(left)} to go by ${bonus.deadline ?? 'the deadline'}.`,
    )
  }
  return messages.join(' ')
}
