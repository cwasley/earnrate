import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import {
  compareSources,
  formatReport,
  hasChanges,
  sourceUrls,
  type PageSnapshot,
  type SourcesLock,
} from '../src/sources/check.ts'
import {
  containsQuote,
  earningLines,
  lineKey,
  normalizeText,
} from '../src/sources/text.ts'

const realCatalog = await loadCatalog()
const card = realCatalog.cards.find((c) => c.id === 'sofi-unlimited-2')
if (!card) throw new Error('sofi card missing')
const catalog = { ...realCatalog, cards: [card] }
const [url] = [...sourceUrls(catalog).keys()]
if (url === undefined) throw new Error('no source url')

const quotes = card.evidence.map((e) => e.quote).join('. ')
const PAGE = `SoFi Unlimited 2% Credit Card\n${quotes}.\nVariable APR 19.99% to 29.99%.\nEarn 2% cash back on every purchase when you redeem into SoFi.`

const ok = (...texts: string[]): PageSnapshot => ({
  url,
  ok: true,
  loads: texts.map((t) => ({ innerText: t, textContent: t })),
})

describe('text', () => {
  test('normalization ignores trademark marks, curly quotes and spacing', () => {
    expect(normalizeText('Card Members’ 5X  Points ® on “flights” .')).toBe(
      'card members\' 5x points on "flights".',
    )
    expect(
      containsQuote(['Amex Travel App ™ . Earn more'], 'Amex Travel App.'),
    ).toBe(true)
  })

  test('earning lines skip APRs and short fragments', () => {
    const lines = earningLines(PAGE)
    expect(lines).toContain(
      'Earn 2% cash back on every purchase when you redeem into SoFi.',
    )
    expect(lines.join(' ')).not.toMatch(/APR/)
  })
})

describe('compareSources', () => {
  const baseline = (innerText: string): SourcesLock =>
    compareSources(
      catalog,
      new Map([[url, ok(innerText)]]),
      { version: 1, pages: {} },
      '2026-10-24',
    ).nextLock

  test('an unchanged page reports nothing', () => {
    const { report } = compareSources(
      catalog,
      new Map([[url, ok(PAGE)]]),
      baseline(PAGE),
      '2026-10-31',
    )
    expect(hasChanges(report)).toBe(false)
    expect(formatReport(report, '2026-10-31')).toMatch(
      /Every rule is still backed/,
    )
  })

  test('the lock stores hashes, not the issuer text', () => {
    const lock = baseline(PAGE)
    expect(JSON.stringify(lock)).not.toMatch(/cash back/)
    expect(lock.pages[url]?.lines).toContain(
      lineKey('Earn 2% cash back on every purchase when you redeem into SoFi.'),
    )
  })

  test('a quote that disappears flags its rule', () => {
    const first = card.evidence[0]
    if (!first) throw new Error('no evidence')
    const changed = PAGE.replace(first.quote, 'something else entirely')
    const { report } = compareSources(
      catalog,
      new Map([[url, ok(changed)]]),
      baseline(PAGE),
      '2026-10-31',
    )
    expect(report.missingEvidence).toEqual([
      expect.objectContaining({ cardId: 'sofi-unlimited-2', rule: first.rule }),
    ])
    expect(formatReport(report, '2026-10-31')).toMatch(/backing text is gone/)
  })

  test('a new earning line and a removed one are both reported', () => {
    const changed = PAGE.replace(
      'Earn 2% cash back on every purchase when you redeem into SoFi.',
      'Earn 3% cash back at restaurants through 12/31/27.',
    )
    const { report } = compareSources(
      catalog,
      new Map([[url, ok(changed)]]),
      baseline(PAGE),
      '2026-10-31',
    )
    expect(report.newLines).toEqual([
      { url, lines: ['Earn 3% cash back at restaurants through 12/31/27.'] },
    ])
    expect(report.removedLines).toEqual([{ url, count: 1 }])
  })

  test('copy that varies between loads is neither new nor removed', () => {
    const promo = 'Limited time: earn 10% back on select purchases this week.'
    const lock = baseline(PAGE)
    const withPromo = `${PAGE}\n${promo}`
    const firstOnly = compareSources(
      catalog,
      new Map([[url, ok(withPromo, PAGE)]]),
      lock,
      '2026-10-31',
    ).report
    expect(firstOnly.newLines).toEqual([])

    const shownOnce = PAGE.replace(
      'Earn 2% cash back on every purchase when you redeem into SoFi.',
      '',
    )
    const stillThere = compareSources(
      catalog,
      new Map([[url, ok(shownOnce, PAGE)]]),
      lock,
      '2026-10-31',
    ).report
    expect(stillThere.removedLines).toEqual([])
  })

  test("a page that can't be fetched is reported, not treated as changed", () => {
    const { report, nextLock } = compareSources(
      catalog,
      new Map([[url, { url, ok: false, reason: 'HTTP 403' }]]),
      baseline(PAGE),
      '2026-10-31',
    )
    expect(hasChanges(report)).toBe(false)
    expect(report.unreachable).toEqual([
      { url, reason: 'HTTP 403', cards: ['sofi-unlimited-2'] },
    ])
    expect(nextLock.pages[url]?.checked).toBe('2026-10-24')
  })

  test('pages that are no longer sources drop out of the lock', () => {
    const lock = baseline(PAGE)
    const stale: SourcesLock = {
      ...lock,
      pages: {
        ...lock.pages,
        'https://old.example.com/': { checked: '2026-01-01', lines: [] },
      },
    }
    const { nextLock } = compareSources(
      catalog,
      new Map([[url, ok(PAGE)]]),
      stale,
      '2026-10-31',
    )
    expect(Object.keys(nextLock.pages)).toEqual([url])
  })
})
