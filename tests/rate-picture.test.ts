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
  bestNote,
  breakdownText,
  feeCardCreditsShort,
  feeCardLead,
  feeCardShort,
  flatNote,
  gapText,
  nextText,
  reportBest,
  reportFeeCards,
  reportGaps,
  reportNext,
  reportNotes,
  reportStart,
  type ReportInput,
} from '../src/engine/wallet-report.ts'
import {
  comparisonRows,
  countedNote,
  perYear,
  ratePictureText,
  upToText,
  type RatePicture,
} from '../site/rate/picture-text.ts'
import { feeFigures } from '../site/rate/fee-figures.ts'
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
    t.upTo ?? '',
    ...t.rows.flatMap((r) => [r.label, r.amount]),
    ...t.notes,
    t.link,
  ].join('\n')

describe("the report's picture", () => {
  test('with credits unanswered, leads with the figure without them and says what every one would add', () => {
    const { start, best, text } = picture(input(), typical)
    expect(start.range).not.toBeNull()
    expect(text.figure).toBe(wholeDollars(start.net))
    expect(text.figure).not.toMatch(/ to /)
    expect(text.per).toBe('a\u00a0year in rewards, after\u00a0fees')
    const high = wholeDollars(start.range?.high ?? NaN)
    expect(text.upTo).toBe(
      `Up to ${start.net < 0 ? '+' : ''}${high} if I use every\u00a0credit`,
    )
    expect(upToText(start)).toBe(
      `Up to ${start.net < 0 ? '+' : ''}${high} if you use every\u00a0credit`,
    )
    expect(upToText(start, 'neutral')).toMatch(/if every credit is\u00a0used$/)
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
    expect(text.figure).toBe(wholeDollars(start.net))
    expect(text.upTo).toBeNull()
    expect(text.per).toBe(
      'a\u00a0year in rewards and credits I use, after\u00a0fees',
    )
    expect(text.notes).toEqual([
      'On my own spending. Credits count only in my figure, once marked used.',
    ])
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
      const start = reportStart(catalog, given, TODAY, spending, 'neutral')
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
        upToText(start, 'neutral') ?? '',
        countedNote('neutral'),
        ...comparisonRows(start, best, name, 'neutral').map((r) => r.label),
        breakdownText(catalog, start, 'neutral'),
        bestNote(catalog, start, best),
        flatNote(start),
        nextText(catalog, reportNext(catalog, given, TODAY, spending)),
        ...fees.flatMap((v) => [
          feeCardLead(catalog, { ...v, paysForItself: false }, 'neutral'),
          v.verdict,
          v.credits,
          feeCardShort(catalog, v, 'neutral'),
          feeCardCreditsShort(v, 'neutral'),
          feeCardCreditsShort(
            { ...v, unsaid: { ...v.unsaid, yearly: 0 }, unvaluedNight: true },
            'neutral',
          ),
        ]),
        ...gaps.map((g) => gapText(catalog, g, 'neutral')),
        ...reportNotes(catalog, start, 'test', 'neutral'),
      ]
      for (const w of words) expect(w).not.toMatch(you)
      if (given.cards.some((c) => (c.used ?? []).length > 0)) {
        const counted = reportNotes(
          catalog,
          reportStart(catalog, given, TODAY, spending),
          'test',
        )
        expect(counted.join(' ')).toMatch(/credits you use \(/)
        expect(
          reportNotes(catalog, start, 'test', 'neutral').join(' '),
        ).toMatch(/credits marked as used \(/)
      }
      const own_ = reportFeeCards(catalog, given, TODAY, spending)
      expect(own_.map((v) => v.verdict).join(' ')).toMatch(you)
    }
    const start = reportStart(catalog, answered(own), TODAY, own)
    expect(breakdownText(catalog, start, 'neutral')).toMatch(/in credits used/)
    expect(breakdownText(catalog, start)).toMatch(/in credits you use/)
  })

  test('a card with a fee is three figures: what it adds, after its fee, and with every credit', () => {
    const fees = reportFeeCards(catalog, input(), TODAY, typical)
    const gold = fees.find((v) => v.cardId === 'amex-gold')
    if (!gold) throw new Error('no Gold')
    const { figures } = feeFigures(gold)
    expect(figures.map((f) => f.label)).toEqual([
      'Adds',
      'After its fee',
      'With every credit',
    ])
    expect(figures[0]?.value).toBe(wholeDollars(gold.net + gold.fee))
    expect(figures[1]?.value.replace('+', '')).toBe(wholeDollars(gold.net))
    expect(figures[2]?.value.replace('+', '')).toBe(
      wholeDollars(gold.net + gold.unsaid.yearly),
    )
    const answered_ = reportFeeCards(catalog, answered(own), TODAY, own)
    for (const v of answered_) {
      const f = feeFigures(v)
      expect(f.figures).toHaveLength(2)
      if (v.used.length > 0) expect(f.counting).toMatch(/^Counts /)
    }
  })
})
