import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import type { Spending } from '../src/engine/renewal.ts'
import {
  resolveSpendLines,
  spendLineFor,
  typicalSpendLines,
} from '../src/engine/simulate.ts'
import { wholeDollars } from '../src/engine/text.ts'
import {
  breakdownText,
  feeCardLead,
  gapText,
  netFigure,
  reportBest,
  reportFeeCards,
  reportGaps,
  reportNotes,
  reportStart,
  type ReportInput,
} from '../src/engine/wallet-report.ts'
import {
  comparisonRows,
  countedNote,
  perYear,
  ratePictureText,
  type RatePicture,
} from '../site/rate/picture-text.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()
const name = (id: string) => catalog.cards.find((c) => c.id === id)?.name ?? id

const typical: Spending = { lines: typicalSpendLines(catalog), typical: true }
const own: Spending = {
  lines: resolveSpendLines(catalog, [
    spendLineFor(catalog, 'Groceries', 615),
    spendLineFor(catalog, 'Dining', 335),
    spendLineFor(catalog, 'Amazon', 145),
  ]),
  typical: false,
}

const input = (): ReportInput => ({
  cards: [
    { id: 'amex-platinum', picks: {} },
    { id: 'amex-gold', picks: {} },
    { id: 'chase-freedom-flex', picks: {} },
  ],
  memberships: [],
  valuations: { 'amex-mr': 1.7 },
})

// Every credit answered: each card's first one used, the rest not.
function answered(spending: Spending): ReportInput {
  const given = input()
  const open = reportStart(catalog, given, TODAY, spending)
  return {
    ...given,
    cards: given.cards.map((c) => {
      const [first, ...rest] =
        open.creditChoices
          .find((x) => x.cardId === c.id)
          ?.choices.map((x) => x.id) ?? []
      return first === undefined ? c : { ...c, used: [first], skipped: rest }
    }),
  }
}

function picture(given: ReportInput, spending: Spending) {
  const start = reportStart(catalog, given, TODAY, spending)
  const best = reportBest(catalog, given, TODAY, spending)
  const text = ratePictureText(start, best, name, TODAY)
  if (!text) throw new Error('no picture')
  return { start, best, text }
}

const everyWord = (t: RatePicture) =>
  [
    t.title,
    t.subtitle,
    ...t.cards.map((c) => c.name),
    t.figure,
    t.per,
    ...t.rows.flatMap((r) => [r.label, r.amount]),
    ...t.notes,
    t.link,
  ].join('\n')

describe("the report's picture", () => {
  test('with credits unanswered, shows the range the page shows', () => {
    const { start, best, text } = picture(input(), typical)
    expect(start.range).not.toBeNull()
    expect(text.figure).toBe(netFigure(start))
    expect(text.figure).toMatch(/ to /)
    expect(text.per).toBe(
      'a\u00a0year after fees, depending on which credits I\u00a0use',
    )
    expect(perYear(start)).toContain('which credits you\u00a0use')
    const page = comparisonRows(start, best, name)
    expect(text.rows.map((r) => r.amount)).toEqual(
      page.map((r) => wholeDollars(r.value ?? NaN)),
    )
    expect(text.rows[0]?.label).toBe('My cards')
    expect(page[0]?.label).toBe('Your cards')
    expect(text.notes.at(-1)).toBe(
      'On typical U.S. spending. Credits count only once marked used.',
    )
  })

  test('with every credit answered, shows the one number the page shows', () => {
    const { start, text } = picture(answered(own), own)
    expect(start.range).toBeNull()
    expect(text.figure).toBe(netFigure(start))
    expect(text.figure).not.toMatch(/ to /)
    expect(text.per).toBe(
      'a\u00a0year in rewards and credits I use, after\u00a0fees',
    )
    expect(text.notes).toContain(
      'My figure counts the credits I use; the other two count none.',
    )
    expect(text.notes.at(-1)).toMatch(/^On my own spending\./)
  })

  test("a picture of someone else's report never says my or I", () => {
    for (const [given, spending] of [
      [input(), typical],
      [answered(own), own],
    ] as const) {
      const start = reportStart(catalog, given, TODAY, spending)
      const best = reportBest(catalog, given, TODAY, spending)
      const text = ratePictureText(start, best, name, TODAY, 'neutral')
      if (!text) throw new Error('no picture')
      const words = everyWord(text).replace(/^Rate my wallet$/m, '')
      expect(words).not.toMatch(/\b(my|I|me|mine)\b/i)
      expect(text.subtitle).toMatch(/^These 3 cards · /)
      expect(text.rows[0]?.label).toBe('These cards')
    }
    const { start, best } = picture(answered(own), own)
    const text = ratePictureText(start, best, name, TODAY, 'neutral')
    expect(text?.per).toBe('a year in rewards and credits used, after fees')
    expect(text?.notes.at(-1)).toMatch(/^On the cardholder’s spending\./)
  })

  test('never holds spending, point values, card ids, credit answers or a link id', () => {
    const { start: open } = picture(input(), own)
    const choices = open.creditChoices.flatMap((c) => c.choices)
    for (const given of [input(), answered(own)]) {
      const { start, text } = picture(given, own)
      const words = everyWord(text)
      for (const l of start.lines) {
        expect(words).not.toContain(wholeDollars(l.monthly))
      }
      expect(words).not.toContain(wholeDollars(start.monthly))
      expect(words).not.toMatch(/[\d.]+¢|1\.7/)
      expect(words).not.toMatch(/a month|monthly/i)
      for (const c of given.cards) expect(words).not.toContain(c.id)
      for (const c of choices) expect(words).not.toContain(c.name)
      expect(words).not.toMatch(/\/r\/|#w=|https?:/)
      expect(text.link).toBe('earnrate.dev/rate')
    }
  })

  test('waits for the best cards, and needs a card', () => {
    const start = reportStart(catalog, input(), TODAY, typical)
    expect(ratePictureText(start, null, name, TODAY)).toBeNull()
    const none = { cards: [], memberships: [], valuations: {} }
    const empty = reportStart(catalog, none, TODAY, typical)
    expect(
      ratePictureText(
        empty,
        reportBest(catalog, none, TODAY, typical),
        name,
        TODAY,
      ),
    ).toBeNull()
  })

  test("a shared report's own sentences say these cards, never you or your", () => {
    const you = /\b(you|your|yours|you'd)\b/i
    for (const [given, spending] of [
      [input(), typical],
      [answered(own), own],
    ] as const) {
      const start = reportStart(catalog, given, TODAY, spending)
      const best = reportBest(catalog, given, TODAY, spending)
      const fees = reportFeeCards(
        catalog,
        given,
        TODAY,
        spending,
        undefined,
        'neutral',
      )
      const gaps = reportGaps(
        catalog,
        given,
        TODAY,
        spending,
        start.simulation,
        null,
      )
      expect(fees.length).toBeGreaterThan(0)
      expect(gaps.length).toBeGreaterThan(0)
      const words = [
        perYear(start, 'neutral'),
        countedNote('neutral'),
        ...comparisonRows(start, best, name, 'neutral').map((r) => r.label),
        breakdownText(catalog, start, 'neutral'),
        ...fees.flatMap((v) => [
          feeCardLead(catalog, { ...v, paysForItself: false }, 'neutral'),
          v.verdict,
          v.credits,
        ]),
        ...gaps.map((g) => gapText(catalog, g, 'neutral')),
        reportNotes(catalog, start, 'test', 'neutral')[0] ?? '',
      ]
      for (const w of words) expect(w).not.toMatch(you)
      const own_ = reportFeeCards(catalog, given, TODAY, spending)
      expect(own_.map((v) => v.verdict).join(' ')).toMatch(you)
    }
    const start = reportStart(catalog, answered(own), TODAY, own)
    expect(breakdownText(catalog, start, 'neutral')).toMatch(/in credits used/)
    expect(breakdownText(catalog, start)).toMatch(/in credits you use/)
  })
})
