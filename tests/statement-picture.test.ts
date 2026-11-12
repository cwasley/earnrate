import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { dollarsAndCents } from '../src/engine/text.ts'
import { resolveLine } from '../src/import/analyze.ts'
import {
  checkWallet,
  monthSpan,
  readStatement,
  runCheck,
} from '../site/statement/check.ts'
import {
  pictureText,
  type PictureText,
} from '../site/statement/picture-text.ts'
import { AMEX_CSV, CHASE_CSV } from './statement-fixtures.ts'

const catalog = await loadCatalog()
const amex = readStatement(AMEX_CSV)
const chase = readStatement(CHASE_CSV)
if (typeof amex === 'string' || typeof chase === 'string')
  throw new Error('fixtures')
const entries = [
  ...amex.lines.map((line) => ({ cardId: 'amex-platinum', line })),
  ...chase.lines.map((line) => ({ cardId: 'chase-sapphire-preferred', line })),
]
const names: Record<string, string> = {
  'amex-platinum': 'Amex Platinum',
  'chase-sapphire-preferred': 'Sapphire Preferred',
}
const cardName = (id: string) => names[id] ?? id

const everyWord = (text: PictureText) =>
  [
    text.title,
    text.subtitle,
    text.figure,
    text.caption,
    text.pace ?? '',
    ...text.rows.flatMap((r) => [r.label, r.amount]),
    ...text.notes,
    text.link,
  ].join('\n')

describe('the statement picture', () => {
  const wallet = checkWallet(
    null,
    ['amex-blue-cash-preferred', 'citi-double-cash'],
    ['amex-platinum', 'chase-sapphire-preferred'],
  )
  const check = runCheck(catalog, wallet, entries, '2026-11-11')
  const a = check.analysis
  const text = pictureText(a, cardName, 'Point values: Ultimate Rewards at 1¢.')
  if (!text) throw new Error('no picture')
  const words = everyWord(text)

  test('holds totals only: no store, purchase amount, day or file name', () => {
    const stores = new Set<string>()
    for (const { line } of entries) {
      stores.add(line.description)
      stores.add(resolveLine(catalog, line).name)
    }
    for (const m of a.missed) stores.add(m.merchant)
    for (const c of a.coding) stores.add(c.merchant)
    for (const n of a.notTaken) stores.add(n.merchant)
    for (const s of check.unknown) stores.add(s.name)
    expect(a.missed.length).toBeGreaterThan(0)
    for (const store of stores)
      expect(words.toLowerCase()).not.toContain(store.toLowerCase())
    for (const { line } of entries) {
      expect(words).not.toContain(dollarsAndCents(Math.abs(line.amount)))
      expect(words).not.toContain(Math.abs(line.amount).toFixed(2))
    }
    expect(words).not.toMatch(
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}\b/,
    )
    expect(words).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}/)
    expect(words.toLowerCase()).not.toMatch(/\.csv|activity/)
  })

  test("says what the page's headline says", () => {
    expect(text.title).toBe('My statement check')
    expect(text.subtitle).toBe(
      `Oct – Nov 2026 · ${String(a.purchases)} purchases`,
    )
    expect(text.figure).toBe(`${dollarsAndCents(a.best - a.earned)} more`)
    expect(text.pace).toMatch(/^At this pace, about \$[\d,]+ a year\.$/)
    expect(text.rows.map((r) => [r.label, r.amount])).toEqual([
      [
        'Earned on Amex Platinum and Sapphire Preferred',
        dollarsAndCents(a.earned),
      ],
      ['With the best of my cards', dollarsAndCents(a.best)],
    ])
    expect(text.notes).toContain('Point values: Ultimate Rewards at 1¢.')
    expect(text.link).toBe('earnrate.dev/statement')
  })

  test('with nothing to gain, says so', () => {
    const alone = runCheck(
      catalog,
      checkWallet(null, [], ['chase-sapphire-preferred']),
      entries.filter((e) => e.cardId === 'chase-sapphire-preferred'),
      '2026-11-11',
    ).analysis
    const same = pictureText(alone, cardName, null)
    expect(same?.figure).toBe('No difference')
    expect(same?.pace).toBeNull()
    expect(same?.rows[0]?.label).toBe('Earned on Sapphire Preferred')
  })

  test('there is no picture without a purchase', () => {
    const none = runCheck(catalog, wallet, [], '2026-11-11').analysis
    expect(pictureText(none, cardName, null)).toBeNull()
  })

  test('the period is named by its months', () => {
    expect(monthSpan('2026-10-02', '2026-10-26')).toBe('October 2026')
    expect(monthSpan('2026-10-02', '2026-11-01')).toBe('Oct – Nov 2026')
    expect(monthSpan('2025-12-20', '2026-01-05')).toBe('Dec 2025 – Jan 2026')
  })
})
