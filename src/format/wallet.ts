import type { ChecklistItem } from '../engine/checklist.ts'
import type {
  BonusBooking,
  BookedPurchase,
  CapBooking,
  CreditBooking,
  MilestoneBooking,
} from '../engine/record.ts'
import {
  counts,
  creditAt,
  tracksUse,
  type CreditState,
} from '../engine/credits.ts'
import { pickedCategories } from '../engine/evaluate.ts'
import { choicePeriod, periodKey } from '../engine/periods.ts'
import type { MerchantResolution } from '../engine/types.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { cardText } from './card-text.ts'
import {
  CAP_PERIODS,
  introAdjective,
  introSince,
  money,
  NETWORK_NAMES,
  capNamed,
  periodPhrase,
  roundCents,
  shortDate,
  possessive,
  subscriptionPaidText,
} from '../engine/text.ts'
import {
  walletSummary,
  type PastCardSummary,
  type WalletSummary,
} from '../engine/wallet-summary.ts'

// "To do now", above the card details; nothing when all's done.
export function formatChecklist(items: ChecklistItem[]): string {
  return items.length === 0
    ? ''
    : `To do now:\n${items.map((i) => `- ${i.text}`).join('\n')}\n\n`
}

export function formatPastCards(past: PastCardSummary[]): string {
  return past
    .map((p) => {
      const known = [
        p.opened === null ? null : `opened ${p.opened}`,
        p.closed === null ? null : `closed ${p.closed}`,
        p.bonusReceived === 'none'
          ? 'no welcome bonus'
          : p.bonusReceived !== null
            ? `bonus posted ${p.bonusReceived}`
            : p.bonusMet !== null
              ? `bonus spending reached ${p.bonusMet}`
              : null,
      ].filter((t) => t !== null)
      const again =
        p.bonusAgain === null
          ? ''
          : p.bonusAgain.state === 'eligible'
            ? " Its bonus is available again under the issuer's rule."
            : ` ${p.bonusAgain.text ?? ''}`
      return `- ${p.cardName} (${p.cardId})${known.length > 0 ? `: ${known.join(', ')}` : ''}.${again}`
    })
    .join('\n')
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
          ? `  ${c.chosen.automatic ? 'Expected categories are' : 'Picks are'} for ${c.chosen.periodName}, which is over: ask for this period's ${c.chosen.automatic ? 'expected ones' : 'picks'}.`
          : c.chosen.until === null
            ? `  Picks: ${picks}. They stay until the user changes them.`
            : c.chosen.automatic
              ? `  Expected for ${c.chosen.periodName}${until}: ${picks}. The issuer applies the bonus where the most is spent; set the expected category again after that.`
              : `  Picks for ${c.chosen.periodName}${until}: ${picks}. Pick again after that.`,
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
          : `  Cap on ${cap.label}: ${money(Math.min(cap.spent, cap.amount))} of ${money(cap.amount)} used ${periodPhrase(cap.period, cap.currentPeriod ?? '')}${cap.until === null ? '' : `, through ${shortDate(cap.until)}`}${cap.spent > cap.amount ? `; the ${money(cap.spent - cap.amount)} past it earned ${cap.afterCap}` : ''} (cap key ${cap.key}).`,
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
  const history =
    summary.pastCards.length > 0
      ? [
          `Cards you've had, for issuers' repeat-bonus rules:\n${formatPastCards(summary.pastCards)}`,
        ]
      : []
  return [...cards, memberships, ...skipped, values, ...history].join('\n')
}

export function formatBooking(
  amount: number,
  name: string, // the card's short name
  cap: CapBooking | null,
  bonus: BonusBooking | null,
  milestones: MilestoneBooking[] = [],
  credit: CreditBooking | null = null,
  capLabel: string | null = null, // what the cap covers, in words
  afterCap: string | null = null, // what spending past it earns: "1% cash back"
  // How to count spending from before tracking began.
  addTotal = 'give the total so far (milestoneSpent)',
): string {
  const messages: string[] = []
  if (credit)
    messages.push(
      `Used ${money(roundCents(credit.after - credit.before))} of ${possessive(name)} ${credit.name} credit: ${money(credit.after)} of ${money(credit.amount)} ${periodPhrase(credit.periodKind, credit.period)}, ${money(roundCents(Math.max(0, credit.amount - credit.after)))} left.`,
    )
  if (cap) {
    const left = Math.max(0, cap.capAmount - cap.after)
    messages.push(
      `Recorded ${money(amount)} on ${name} toward ${capNamed('its', capLabel ?? cap.capKey)}: ${money(Math.min(cap.before, cap.capAmount))} → ${money(Math.min(cap.after, cap.capAmount))} of ${money(cap.capAmount)} ${periodPhrase(cap.periodKind, cap.period)}, ${money(left)} left${cap.after > cap.capAmount ? `; the ${money(cap.after - Math.max(cap.before, cap.capAmount))} past the cap earns ${afterCap ?? "the card's rate after it"}` : ''}.`,
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
          ? `Started tracking spend on ${name} this ${period} with this purchase: ${money(first.after)}. Spending on it earlier this ${period} isn't counted; ${addTotal} to include it.`
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

// A purchase from an earlier period than the picks on file can't be matched
// to that period's categories, so nothing is recorded.
export function stalePicksText(
  catalog: Catalog,
  wallet: Wallet,
  cardId: string,
  date: string,
): string | null {
  const card = catalog.cards.find((c) => c.id === cardId)
  const held = wallet.cards.find((c) => c.id === cardId)
  if (!card || !held) return null
  const { staleChoice } = pickedCategories(card, held, date)
  const period = choicePeriod(card)
  if (staleChoice === null || period === null) return null
  const key = periodKey(period, date, null) ?? ''
  return `Nothing was recorded: ${cardText(catalog).shortName(cardId)}'s category picks on file are ${periodPhrase(period, staleChoice)}, and this purchase is from ${periodPhrase(period, key).replace(/^for /, '')}, so it can't be matched to that period's picks or cap.`
}

// A subscription credit pays in full each period, so nothing is booked
// against it. Paying for one that needs no enrolling says the cardholder
// uses its credit, unless they said they don't (`mark`).
export function subscriptionCredit(
  catalog: Catalog,
  wallet: Wallet,
  cardId: string,
  merchant: MerchantResolution,
  date: string,
): { paying: CreditState | null; mark: boolean } {
  const held = wallet.cards.find((c) => c.id === cardId)
  const card = catalog.cards.find((c) => c.id === cardId)
  const paying =
    held && card ? creditAt(catalog, card, held, merchant, date) : null
  return {
    paying,
    mark:
      paying !== null &&
      held !== undefined &&
      !tracksUse(paying.credit) &&
      paying.credit.enroll !== true &&
      !paying.confirmed &&
      !(held.skipped_credits ?? []).includes(paying.credit.id),
  }
}

export function subscriptionText(
  name: string, // the card's short name
  paying: CreditState | null,
  marked: boolean,
): string | null {
  return paying && !tracksUse(paying.credit) && (marked || counts(paying))
    ? `${marked ? `Marked ${possessive(name)} ${paying.name} credit as one you use. ` : ''}${subscriptionPaidText(name, paying)}`
    : null
}

// What recording a purchase did, from the wallet as it was before; `saved`
// says where it went ("Saved in your saved wallet.") when something was.
export function recordedText(
  catalog: Catalog,
  wallet: Wallet,
  purchase: { cardId: string; amount: number; date: string },
  booked: Pick<BookedPurchase, 'cap' | 'bonus' | 'milestones' | 'credit'>,
  subscription: string | null,
  saved: string,
  addTotal?: string,
): { recorded: boolean; text: string } {
  const { cap, bonus, milestones, credit } = booked
  const shortName = cardText(catalog).shortName(purchase.cardId)
  if (cap || bonus || milestones.length > 0 || credit) {
    const capSummary = cap
      ? walletSummary(catalog, wallet, purchase.date)
          .cards.find((c) => c.cardId === purchase.cardId)
          ?.caps.find((c) => c.key === cap.capKey)
      : undefined
    return {
      recorded: true,
      text: `${formatBooking(purchase.amount, shortName, cap, bonus, milestones, credit, capSummary?.label ?? null, capSummary?.afterCap ?? null, addTotal)}${subscription === null ? '' : ` ${subscription}`} ${saved}`,
    }
  }
  return {
    recorded: false,
    text:
      stalePicksText(catalog, wallet, purchase.cardId, purchase.date) ??
      (subscription === null
        ? `Nothing to track: ${shortName} has no spending cap, open welcome bonus, spend bonus or enrolled statement credit for this purchase, so the wallet wasn't changed.`
        : `${subscription} The wallet wasn't changed.`),
  }
}
