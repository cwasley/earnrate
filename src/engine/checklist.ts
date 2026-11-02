import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { daysBetween, periodEnd, periodKey } from './periods.ts'
import {
  CAP_PERIODS,
  choiceName,
  listed,
  money,
  shortDate,
  wholeDollars,
} from './text.ts'
import {
  activationsDue,
  optionName,
  walletSummary,
  type WalletSummary,
} from './wallet-summary.ts'

// Node-free: earnrate.dev builds the same list from its browser wallet.

export type ChecklistItem = {
  kind: 'activate' | 'pick' | 'cap' | 'bonus' | 'rotation'
  cardId: string
  text: string
  due: string | null // YYYY-MM-DD: the deadline, or when a cap resets
}

// What the wallet's cards need this period, soonest first: bonuses to
// activate, categories to pick, caps running low, welcome bonuses to finish,
// and rotating categories the issuer hasn't posted yet.
export function checklist(
  catalog: Catalog,
  wallet: Wallet,
  today: string,
  summary: WalletSummary = walletSummary(catalog, wallet, today),
  // A shorter card name than the issuer's full one, where the caller has it.
  shortName?: (cardId: string) => string,
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
          ? `, starting ${shortDate(a.from)}`
          : ''
      items.push({
        kind: 'activate',
        cardId: card.id,
        text: `Activate ${name}'s bonus on ${a.what}${starts}${a.activateBy === null ? '' : `, by ${shortDate(a.activateBy)}`}.`,
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
      const period =
        first.period === 'until_changed'
          ? null
          : periodKey(first.period, today, null)
      items.push({
        kind: 'pick',
        cardId: card.id,
        text: `Pick ${name}'s ${listed(unpicked.map((c) => choiceName(c.id)))} categories for this ${first.period.replace('_', ' ')}; until then they earn the base rate.`,
        due: period === null ? null : periodEnd(period),
      })
    } else {
      // Picks made for this period: near its end, a reminder to make the
      // next period's (Cash+ asks each quarter).
      const ending = card.choices.find(
        (c) => c.period !== 'until_changed' && !c.default && current,
      )
      const period =
        ending === undefined || ending.period === 'until_changed'
          ? null
          : periodKey(ending.period, today, null)
      const end = period === null ? null : periodEnd(period)
      if (ending && end !== null && daysBetween(today, end) <= 14)
        items.push({
          kind: 'pick',
          cardId: card.id,
          text: `Pick ${name}'s categories for next ${ending.period.replace('_', ' ')}; this one ends ${shortDate(end)}.`,
          due: end,
        })
    }

    // A pick earnrate assumes because none was saved: worth confirming.
    const assumed = card.choices.filter((c) => c.default && !picked(c.id))
    if (assumed.length > 0)
      items.push({
        kind: 'pick',
        cardId: card.id,
        text: `${name}'s ${listed(assumed.map((c) => choiceName(c.id)))} pick is assumed to be ${listed(assumed.flatMap((c) => (c.default ?? []).map((o) => optionName(catalog, card, c.id, o))))}; set it if you picked something else.`,
        due: null,
      })

    for (const cap of s.caps) {
      // Only caps nearly used up: the rest aren't something to do.
      if (cap.remaining === null || cap.remaining > cap.amount * 0.25) continue
      const resets =
        cap.currentPeriod === null ? null : periodEnd(cap.currentPeriod)
      items.push({
        kind: 'cap',
        cardId: card.id,
        text:
          cap.remaining === 0
            ? `${name}'s ${cap.label} cap is used up${resets === null ? '' : ` until ${shortDate(resets)}`}; another card may earn more there.`
            : `${name}: ${money(cap.remaining)} left of ${money(cap.amount)} ${CAP_PERIODS[cap.period]} at the bonus rate on ${cap.label}.`,
        due: resets,
      })
    }

    const b = s.bonus
    if (b?.state === 'open' && b.remaining !== null && b.deadline !== null) {
      const weeks = Math.max(1, (b.daysLeft ?? 7) / 7)
      items.push({
        kind: 'bonus',
        cardId: card.id,
        text: `${name}'s welcome bonus: ${money(b.remaining)} to go by ${shortDate(b.deadline)}, about ${wholeDollars(b.remaining / weeks)} a week.`,
        due: b.deadline,
      })
    }

    if (s.rotationGap !== null) {
      items.push({
        kind: 'rotation',
        cardId: card.id,
        text: `${name}'s ${s.rotationGap} categories aren't out yet; earnrate adds them once the issuer posts them.`,
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
// welcome-bonus deadlines), with a reminder two days before. Built on the
// device: nothing is sent anywhere.
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
  const next = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`)
    t.setUTCDate(t.getUTCDate() + 1)
    return t.toISOString().slice(0, 10)
  }
  const events = items
    .filter((i) => i.due !== null && i.kind !== 'cap' && i.kind !== 'rotation')
    .flatMap((i) => {
      const due = i.due ?? ''
      return [
        'BEGIN:VEVENT',
        `UID:${i.kind}-${i.cardId}-${due}@earnrate.dev`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${day(due)}`,
        `DTEND;VALUE=DATE:${day(next(due))}`,
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
