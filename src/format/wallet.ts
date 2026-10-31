import type { BonusBooking, CapBooking } from '../engine/record.ts'
import { money } from '../engine/text.ts'
import type { WalletSummary } from '../engine/wallet-summary.ts'

const NETWORKS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  store: 'store card',
}

const words = (id: string) => id.replace(/[-_.]/g, ' ')

export function formatWalletSummary(summary: WalletSummary): string {
  const cards = summary.cards.map((c) => {
    const lines = [
      `- ${c.checkoutLabel ?? c.cardName} (${c.cardId}): ${NETWORKS[c.network] ?? c.network}, ${c.currency} at ${String(c.centsPerUnit)}¢. Data checked ${c.lastVerified}${c.dataIsStale ? ' (old; check the issuer)' : ''}.`,
    ]
    if (c.onlyAt) lines.push(`  Works only at ${c.onlyAt.join(', ')}.`)
    if (c.chosen) {
      const picks = Object.entries(c.chosen.picks)
        .map(
          ([choice, options]) =>
            `${words(choice)}: ${options.map(words).join(', ')}`,
        )
        .join('; ')
      lines.push(
        c.chosen.current
          ? `  Picks for ${c.chosen.period}: ${picks}. They need choosing again when the period ends.`
          : `  Picks are for ${c.chosen.period}, which is over: ask for this period's picks.`,
      )
    }
    if (c.activated.length > 0)
      lines.push(`  Activated: ${c.activated.join(', ')}.`)
    if (c.rotationGap !== null)
      lines.push(
        `  Rotating categories for ${c.rotationGap} aren't in earnrate yet.`,
      )
    for (const cap of c.caps)
      if (cap.remaining !== null)
        lines.push(
          `  Cap ${cap.key}: ${money(cap.spent)} of ${money(cap.amount)} used for ${cap.currentPeriod ?? ''}.`,
        )
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
      ? `Memberships: ${summary.memberships.join(', ')}.`
      : 'Memberships: none saved.'
  return [...cards, memberships].join('\n')
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
