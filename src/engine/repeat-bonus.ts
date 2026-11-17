import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { listed, monthYear, shortCardName } from './text.ts'

// Whether the person can get a card's welcome bonus again, from the
// issuer's published repeat rule (`welcome_offer.repeat`) and the cards
// they hold or have had. Months only, YYYY-MM. Missing or approximate
// months never rule the person out: those come back as `needs-date` or
// `likely`, with a note, and the month that would settle it in `ask`.
export type BonusEligibility = {
  state:
    'eligible' | 'likely' | 'once-used' | 'not-yet' | 'needs-date' | 'unstated'
  // The month the wait ends, when it's known.
  from: string | null
  // `from` is only the earliest the wait can end: the clock started from
  // the month the spend was reached, and the bonus posts then or later.
  earliest: boolean
  // Null when eligible.
  text: string | null
  // The month the person can give to settle it, and where it goes.
  ask: MonthAsk | null
}

export type MonthAsk = {
  cardId: string
  // A card held now (its `bonus_received`), or the entry in `past_cards`.
  held: boolean
  pastIndex: number | null
  field: 'bonus_received' | 'opened' | 'closed'
}

type Record = {
  id: string
  held: boolean
  pastIndex: number | null
  opened: string | null
  closed: string | null
  received: string | false | null
  met: string | null
}

export function addMonthsTo(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) + n
  const year = Math.floor(total / 12)
  return `${String(year)}-${String((total % 12) + 1).padStart(2, '0')}`
}

const latest = (months: string[]) => months.toSorted().at(-1) ?? null
const monthWords = (month: string) => monthYear(`${month}-01`)

function records(wallet: Wallet, ids: Set<string>): Record[] {
  return [
    ...wallet.cards
      .filter((c) => ids.has(c.id))
      .map((c) => {
        const opened = c.opened ?? c.bonus?.opened ?? null
        return {
          id: c.id,
          held: true,
          pastIndex: null,
          opened: opened?.slice(0, 7) ?? null,
          closed: null,
          received: c.bonus_received ?? null,
          met: c.bonus?.met ?? null,
        }
      }),
    ...(wallet.past_cards ?? []).flatMap((c, i) =>
      ids.has(c.id)
        ? [
            {
              id: c.id,
              held: false,
              pastIndex: i,
              opened: c.opened ?? null,
              closed: c.closed ?? null,
              received: c.bonus_received ?? null,
              met: c.bonus_met ?? null,
            },
          ]
        : [],
    ),
  ]
}

const askFor = (r: Record, field: MonthAsk['field']): MonthAsk | null =>
  // A held card's opening is a full date, set with the card itself.
  r.held && field !== 'bonus_received'
    ? null
    : { cardId: r.id, held: r.held, pastIndex: r.pastIndex, field }

const plain = (
  state: BonusEligibility['state'],
  text: string | null,
): BonusEligibility => ({ state, from: null, earliest: false, text, ask: null })

export function bonusEligibility(
  catalog: Catalog,
  wallet: Wallet,
  cardId: string,
  today: string,
): BonusEligibility | null {
  const card = catalog.cards.find((c) => c.id === cardId)
  const offer = card?.welcome_offer
  if (!card || !offer) return null
  const repeat = offer.repeat
  const family = new Set([cardId, ...(repeat?.also ?? [])])
  const had = records(wallet, family)
  if (had.length === 0) return null

  const issuer =
    catalog.issuers.find((i) => i.id === card.issuer)?.name ?? card.issuer
  const name = (id: string) =>
    id === cardId ? 'this card' : cardName(catalog, id)
  if (!repeat)
    return plain(
      'unstated',
      `${issuer}'s pages don't say whether you can get this bonus again after having the card.`,
    )

  const may = repeat.may === true
  if (repeat.after_months === undefined || repeat.from === undefined) {
    const self = had.some((r) => r.id === cardId)
    const others = [...new Set(had.map((r) => r.id))].map(name)
    return plain(
      'once-used',
      self
        ? `${issuer} says you ${may ? 'may not' : "can't"} get this bonus again, since you've had this card before.`
        : `${issuer} says you ${may ? 'may not' : "can't"} get this bonus if you have or have had ${listed(others)}.`,
    )
  }

  const wait = repeat.after_months
  const scope = listed([...family].map(name), 'or')
  const thisMonth = today.slice(0, 7)
  // The wait runs to the day, so it's over only once its last month has
  // passed; during that month it ends on a day earnrate doesn't know.
  const result = (
    from: string,
    because: string,
    after = '',
  ): BonusEligibility =>
    from < thisMonth
      ? { state: 'eligible', from, earliest: false, text: null, ask: null }
      : from === thisMonth
        ? {
            state: 'likely',
            from,
            earliest: false,
            text: may
              ? `${issuer} says you may not get it until later in ${monthWords(from)}: it ${because}${after}`
              : `Not until later in ${monthWords(from)}: ${issuer} ${because}${after}`,
            ask: null,
          }
        : {
            state: 'not-yet',
            from,
            earliest: false,
            text: may
              ? `${issuer} says you may not get it before ${monthWords(from)}: it ${because}${after}`
              : `Not before ${monthWords(from)}: ${issuer} ${because}${after}`,
            ask: null,
          }
  const needs = (
    counts: string,
    ask: string,
    r: Record,
    field: MonthAsk['field'],
  ): BonusEligibility => ({
    state: 'needs-date',
    from: null,
    earliest: false,
    text: `${issuer} ${counts}. Tell earnrate ${ask} to get a date.`,
    ask: askFor(r, field),
  })

  switch (repeat.from) {
    case 'bonus': {
      const counts = `counts ${String(wait)} months from your last bonus on ${scope}`
      const paid = had.filter((r) => r.received !== false)
      const unknown = paid.find((r) => r.received === null && r.met === null)
      if (unknown)
        return needs(counts, 'when yours posted', unknown, 'bonus_received')
      const received = latest(
        paid.flatMap((r) =>
          typeof r.received === 'string' ? [r.received] : [],
        ),
      )
      const metOnly = paid.filter((r) => r.received === null && r.met)
      const met = latest(metOnly.map((r) => r.met as string))
      if (received === null && met === null) return plain('eligible', null)
      if (met === null || (received !== null && received >= met))
        return result(
          addMonthsTo(received as string, wait),
          counts,
          `. Yours posted in ${monthWords(received as string)}.`,
        )
      // Only the month the spend was reached is known: the bonus posted
      // then or later, so the wait ends no earlier than this.
      const from = addMonthsTo(met, wait)
      const reached = `You reached its spending in ${monthWords(met)}, so it posted then or later.`
      const r = metOnly.find((x) => x.met === met) as Record
      if (from > thisMonth)
        return {
          state: 'not-yet',
          from,
          earliest: true,
          text: may
            ? `${issuer} says you may not get it before ${monthWords(from)}: it ${counts}. ${reached}`
            : `Not before ${monthWords(from)}: ${issuer} ${counts}. ${reached}`,
          ask: askFor(r, 'bonus_received'),
        }
      const next = addMonthsTo(from, 1)
      return {
        state: 'likely',
        from,
        earliest: true,
        text: `${next <= thisMonth ? 'Likely available again' : `Likely from about ${monthWords(next)}`}: ${issuer} ${counts}. ${reached} Tell earnrate when it posted to be sure.`,
        ask: askFor(r, 'bonus_received'),
      }
    }
    case 'opened': {
      const counts = `counts ${String(wait)} months from when you opened ${scope}`
      const unknown = had.find((r) => r.opened === null)
      if (unknown) return needs(counts, 'when you opened it', unknown, 'opened')
      const last = latest(had.map((r) => r.opened as string)) as string
      return result(
        addMonthsTo(last, wait),
        counts,
        `, in ${monthWords(last)}.`,
      )
    }
    case 'held': {
      if (had.some((r) => r.held))
        return plain(
          'not-yet',
          `${issuer} says you ${may ? 'may not' : "can't"} get this bonus while you have ${scope} or for ${String(wait)} months after you close it.`,
        )
      const counts = `counts ${String(wait)} months from when you last had ${scope}`
      const unknown = had.find((r) => r.closed === null)
      if (unknown) return needs(counts, 'when you closed it', unknown, 'closed')
      const last = latest(had.map((r) => r.closed as string)) as string
      return result(
        addMonthsTo(last, wait),
        counts,
        `, in ${monthWords(last)}.`,
      )
    }
  }
}

const FIELD_OF = {
  bonus: 'bonus_received',
  opened: 'opened',
  held: 'closed',
} as const

// The months any issuer's repeat-bonus rule counts from for a card: its
// own rule's, and those of the cards whose rule counts it too (`also`).
export function repeatMonthFields(
  catalog: Catalog,
  cardId: string,
): MonthAsk['field'][] {
  const fields = new Set<MonthAsk['field']>()
  for (const card of catalog.cards) {
    const r = card.welcome_offer?.repeat
    if (r?.from === undefined) continue
    if (card.id === cardId || (r.also ?? []).includes(cardId))
      fields.add(FIELD_OF[r.from])
  }
  return [...fields]
}

// Whether having had a card matters to any card's offer: its own, or
// another card's repeat rule that counts it.
export const countsForRepeat = (catalog: Catalog, cardId: string): boolean =>
  catalog.cards.some(
    (c) =>
      (c.id === cardId && c.welcome_offer !== undefined) ||
      (c.welcome_offer?.repeat?.also ?? []).includes(cardId),
  )

function cardName(catalog: Catalog, id: string): string {
  const card: Card | undefined = catalog.cards.find((c) => c.id === id)
  return card ? shortCardName(card.name) : id
}

// A card's repeat-bonus rule in one sentence, for card pages, the rules
// page and search answers: the same words wherever it's shown.
export function repeatRuleText(catalog: Catalog, card: Card): string {
  const { label, detail } = repeatRuleParts(catalog, card)
  return label === null ? detail : `${label}: ${detail}`
}

// The rule's short label ("Once per card", "Not within 24 months"; null
// when the issuer states none) and the sentence after it. A wait is said
// as the restriction the issuer states, never as a promise after it, and
// keeps the issuer's "may not".
export function repeatRuleParts(
  catalog: Catalog,
  card: Card,
): { label: string | null; detail: string } {
  const issuer =
    catalog.issuers.find((i) => i.id === card.issuer)?.name ?? card.issuer
  const r = card.welcome_offer?.repeat
  if (!r)
    return {
      label: null,
      detail: `${issuer}'s pages don't say whether you can earn it again after having the card.`,
    }
  const others = (r.also ?? []).map((id) => cardName(catalog, id))
  const scope =
    others.length === 0 ? 'this card' : listed(['this card', ...others], 'or')
  if (r.after_months === undefined || r.from === undefined)
    return {
      label:
        others.length === 0
          ? 'Once per card'
          : `Once per card, counting ${listed(others)}`,
      detail: r.may
        ? `${issuer} says the bonus may not be available if you have or have had ${scope}.`
        : `${issuer} says the bonus isn't available if you have or have had ${scope}.`,
    }
  const from = {
    bonus: `your last bonus on ${scope}`,
    opened: `when you last opened ${scope}, even if it's closed`,
    held: `when you last had ${scope}`,
  }[r.from]
  return {
    label: `${r.may ? 'Maybe not' : 'Not'} within ${waitWords(r.after_months)}`,
    detail: `${issuer} counts from ${from}.`,
  }
}

export const waitWords = (months: number) =>
  months > 48 && months % 12 === 0
    ? `${String(months / 12)} years`
    : `${String(months)} months`
