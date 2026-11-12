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
  netFigure,
  reportBest,
  reportStart,
  type ReportInput,
} from '../src/engine/wallet-report.ts'
import {
  comparisonRows,
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
})
