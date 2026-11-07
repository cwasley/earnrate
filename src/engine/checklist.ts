import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { addDays, currentPeriodEnd, daysBetween } from './periods.ts'
import {
  CAP_PERIODS,
  choiceName,
  askCreditText,
  enrollCreditText,
  introEndsText,
  listed,
  money,
  shortDate,
  renewalText,
  useCreditText,
  wholeDollars,
  possessive,
} from './text.ts'
import { milestonePays } from './milestones.ts'
import { renewalCheck, renewalDue, type Spending } from './renewal.ts'
import { creditLabel, optionName } from './rule-text.ts'
import {
  activationsDue,
  walletSummary,
  type WalletSummary,
} from './wallet-summary.ts'

// Node-free: earnrate.dev builds the same list from its browser wallet.

const issuerLabel = (catalog: Catalog, id: string) =>
  catalog.issuers.find((i) => i.id === id)?.name ?? id

export type ChecklistItem = {
  kind:
    | 'activate'
    | 'pick'
    | 'cap'
    | 'bonus'
    | 'milestone'
    | 'rotation'
    | 'intro'
    | 'credit'
    | 'enroll'
    | 'renewal'
  cardId: string
  // Tells apart a card's items of the same kind and date (two credits).
  ref?: string
  text: string
  due: string | null // YYYY-MM-DD: the deadline, or when a cap resets
}

// "5% and 2% categories", "top category": a choice already named for its
// category isn't followed by "categories" again.
function pickWhat(names: string[]): string {
  const [only] = names
  if (names.length === 1 && only !== undefined && / category$/.test(only))
    return only
  return `${listed(names)} categories`
}

// What the wallet's cards need this period, soonest first: bonuses to
// activate, categories to pick, caps running low, welcome bonuses to finish,
// merchant credits to enroll in or use, and rotating categories the issuer
// hasn't posted yet.
export function checklist(
  catalog: Catalog,
  wallet: Wallet,
  today: string,
  summary: WalletSummary = walletSummary(catalog, wallet, today),
  // A shorter card name than the issuer's full one, where the caller has it.
  shortName?: (cardId: string) => string,
  // For the renewal check; typical amounts when not given.
  spending?: Spending,
): ChecklistItem[] {
  const items: ChecklistItem[] = []
  for (const held of wallet.cards) {
    const card = catalog.cards.find((c) => c.id === held.id)
    const s = summary.cards.find((c) => c.cardId === held.id)
    if (!card || !s) continue
    const name = s.checkoutLabel ?? shortName?.(card.id) ?? s.cardName

    for (const a of activationsDue(catalog, card, held, today)) {
      const starts =
        a.from !== null && a.from > today
          ? ` (it starts ${shortDate(a.from)})`
          : ''
      items.push({
        kind: 'activate',
        cardId: card.id,
        text: `Activate ${possessive(name)} bonus ${a.where}${a.activateBy === null ? '' : ` by ${shortDate(a.activateBy)}`}${starts}.`,
        due:
          a.activateBy ?? (a.from !== null && a.from > today ? a.from : a.to),
      })
    }

    const picked = (id: string) => s.chosen?.picks[id] !== undefined
    const current = s.chosen?.current === true
    const unpicked = card.choices.filter(
      (c) =>
        !c.default &&
        !(current && picked(c.id)) &&
        c.period !== 'until_changed',
    )
    const [first] = unpicked
    if (first) {
      const due =
        first.period === 'until_changed'
          ? null
          : currentPeriodEnd(first.period, today, null)
      items.push({
        kind: 'pick',
        cardId: card.id,
        text: `Pick ${possessive(name)} ${pickWhat(unpicked.map((c) => choiceName(c.id)))} for this ${first.period.replace('_', ' ')}; until then they earn the base rate.`,
        due,
      })
    } else {
      // Picks made for this period: near its end, a reminder to make the
      // next period's (Cash+ asks each quarter).
      const ending = card.choices.find(
        (c) => c.period !== 'until_changed' && !c.default && current,
      )
      const end =
        ending === undefined || ending.period === 'until_changed'
          ? null
          : currentPeriodEnd(ending.period, today, null)
      if (ending && end !== null && daysBetween(today, end) <= 14)
        items.push({
          kind: 'pick',
          cardId: card.id,
          text: `Pick ${possessive(name)} categories for next ${ending.period.replace('_', ' ')}; this one ends ${shortDate(end)}.`,
          due: end,
        })
    }

    // A pick earnrate assumes because none was saved: worth confirming.
    const assumed = card.choices.filter((c) => c.default && !picked(c.id))
    if (assumed.length > 0)
      items.push({
        kind: 'pick',
        cardId: card.id,
        text: `${possessive(name)} ${listed(assumed.map((c) => choiceName(c.id)))} pick is assumed to be ${listed(assumed.flatMap((c) => (c.default ?? []).map((o) => optionName(catalog, card, c.id, o))))}; set it if you picked something else.`,
        due: null,
      })

    for (const cap of s.caps) {
      // Only caps nearly used up: the rest aren't something to do.
      if (cap.remaining === null || cap.remaining > cap.amount * 0.25) continue
      const resets = cap.until
      items.push({
        kind: 'cap',
        cardId: card.id,
        text:
          cap.remaining === 0
            ? `${possessive(name)} ${cap.label} cap is used up${resets === null ? '' : ` until ${shortDate(resets)}`}; another card may earn more there.`
            : `${name}: ${money(cap.remaining)} left of ${money(cap.amount)} ${CAP_PERIODS[cap.period]} at the bonus rate on ${cap.label}.`,
        due: resets,
      })
    }

    for (const m of s.milestones) {
      // Like caps: only once at least 75% of the way there.
      if (!m.tracked || m.spent < m.spend * 0.75 || m.spent >= m.spend) continue
      items.push({
        kind: 'milestone',
        cardId: card.id,
        text: `${name}: ${money(m.spent)} of ${wholeDollars(m.spend)} spent toward ${milestonePays(m)}; ${money(m.spend - m.spent)} to go${m.until === null ? '' : ` by ${shortDate(m.until)}`}.`,
        due: m.until,
      })
    }

    const toAsk = s.credits.filter(
      (c) => !c.enroll && !c.confirmed && !c.skipped,
    )
    if (toAsk.length > 0)
      items.push({
        kind: 'enroll',
        cardId: card.id,
        ref: toAsk.map((c) => c.id).join(','),
        text: askCreditText(
          name,
          toAsk.map((c) => {
            const credit = card.credits.find((x) => x.id === c.id)
            return credit ? creditLabel(catalog, credit) : c.name
          }),
        ),
        due: null,
      })
    const toEnroll = s.credits.filter((c) => !c.enrolled && !c.skipped)
    if (toEnroll.length > 0)
      items.push({
        kind: 'enroll',
        cardId: card.id,
        ref: toEnroll.map((c) => c.id).join(','),
        text: enrollCreditText(
          name,
          toEnroll.map((c) => c.name),
        ),
        due: null,
      })
    for (const c of s.credits) {
      if (!c.enrolled || c.skipped) continue
      // One that needs no enrolling shows once the cardholder uses it, so a
      // card's every credit isn't a to-do for someone who never shops there.
      if (c.left !== null && c.left > 0 && (c.enroll || c.tracked))
        items.push({
          kind: 'credit',
          cardId: card.id,
          ref: c.id,
          text: useCreditText(name, c, c.left),
          due: c.until,
        })
    }

    const b = s.bonus
    if (b?.state === 'open' && b.remaining !== null && b.deadline !== null) {
      const weeks = Math.max(1, (b.daysLeft ?? 7) / 7)
      items.push({
        kind: 'bonus',
        cardId: card.id,
        text: `${possessive(name)} welcome bonus: ${money(b.remaining)} to go by ${shortDate(b.deadline)}, about ${wholeDollars(b.remaining / weeks)} a week.`,
        due: b.deadline,
      })
    }

    const quarterEnd = currentPeriodEnd('quarter', today, null)
    if (
      s.intro?.state === 'active' &&
      s.intro.until !== null &&
      quarterEnd !== null &&
      s.intro.until <= quarterEnd
    )
      items.push({
        kind: 'intro',
        cardId: card.id,
        text: introEndsText(name, s.intro.days, s.intro.until),
        due: s.intro.until,
      })

    const due = (card.annual_fee ?? 0) > 0 ? renewalDue(held, today) : null
    if (due !== null) {
      const r = renewalCheck(catalog, wallet, card, due, spending)
      items.push({
        kind: 'renewal',
        cardId: card.id,
        text: renewalText(name, issuerLabel(catalog, card.issuer), r),
        due,
      })
    }

    if (s.rotationGap !== null) {
      items.push({
        kind: 'rotation',
        cardId: card.id,
        text: `${possessive(name)} ${s.rotationGap} categories aren't out yet; earnrate adds them once the issuer posts them.`,
        due: null,
      })
    }
  }
  return items.sort(
    (a, b) =>
      (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
      a.cardId.localeCompare(b.cardId),
  )
}

// An all-day calendar event for each dated action (activations, picks,
// welcome-bonus deadlines, credits to use), with a reminder two days before.
// Built on the device: nothing is sent anywhere.
export function checklistCalendar(
  items: ChecklistItem[],
  stamp: string, // YYYYMMDDTHHMMSSZ
): string {
  const escape = (t: string) =>
    t.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`)
  const fold = (line: string) => {
    const parts: string[] = []
    for (let i = 0; i < line.length; i += 73) parts.push(line.slice(i, i + 73))
    return parts.join('\r\n ')
  }
  const day = (d: string) => d.replace(/-/g, '')
  const events = items
    .filter((i) => i.due !== null && i.kind !== 'cap' && i.kind !== 'rotation')
    .flatMap((i) => {
      const due = i.due ?? ''
      return [
        'BEGIN:VEVENT',
        `UID:${i.kind}-${i.cardId}${i.ref === undefined ? '' : `-${i.ref}`}-${due}@earnrate.dev`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${day(due)}`,
        `DTEND;VALUE=DATE:${day(addDays(due, 1))}`,
        fold(`SUMMARY:${escape(i.text)}`),
        'BEGIN:VALARM',
        'TRIGGER:-P2D',
        'ACTION:DISPLAY',
        fold(`DESCRIPTION:${escape(i.text)}`),
        'END:VALARM',
        'END:VEVENT',
      ]
    })
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//earnrate//checklist//EN',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}
