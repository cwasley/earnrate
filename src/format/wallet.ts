import type { BonusBooking, CapBooking } from '../engine/record.ts'
import { money } from '../engine/text.ts'
import type { WalletSummary } from '../engine/wallet-summary.ts'

export function formatWalletSummary(summary: WalletSummary): string {
  return summary.cards
    .map((c) => {
      const caps = c.caps
        .filter((cap) => cap.remaining !== null)
        .map(
          (cap) =>
            `${cap.key} ${money(cap.spent)} of ${money(cap.amount)} used for ${cap.currentPeriod ?? ''}`,
        )
      const chosen = c.chosen
        ? `; chosen categories for ${c.chosen.period}${c.chosen.current ? '' : ' (out of date)'}`
        : ''
      const onlyAt = c.onlyAt ? `; works only at ${c.onlyAt.join(', ')}` : ''
      const rotation =
        c.rotationGap === null
          ? ''
          : `; rotating categories for ${c.rotationGap} not in earnrate yet`
      const b = c.bonus
      const bonus =
        b?.state === 'open' && b.spend !== null
          ? `; welcome bonus ${money(b.spent)} of ${money(b.spend)} spent, due ${b.deadline ?? ''}`
          : b
            ? `; welcome bonus ${b.state}`
            : ''
      return `- ${c.checkoutLabel ?? c.cardName} (${c.cardId}): ${c.currency} at ${String(c.centsPerUnit)}¢${caps.length > 0 ? `; ${caps.join(', ')}` : ''}${chosen}${rotation}${onlyAt}${bonus}`
    })
    .join('\n')
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
