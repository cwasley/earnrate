import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { supportingQuote } from '../src/engine/quotes.ts'
import type { Card, Rule } from '../src/schema/card.ts'

const catalog = await loadCatalog()
const base = catalog.cards[0]
if (!base) throw new Error('no cards')

const url = 'https://example.com/terms'
const cardWith = (rule: Partial<Rule>, quotes: string[]): Card => ({
  ...base,
  rules: [
    {
      ...(base.rules[0] as Rule),
      id: 'bonus',
      match: {},
      rate: 5,
      ...rule,
    },
  ],
  evidence: quotes.map((quote) => ({ rule: 'bonus', url, quote })),
})

const pick = (card: Card, at: { merchantId?: string; category?: string }) =>
  supportingQuote(catalog, card, 'bonus', at)?.quote

describe('the quote backing a rule at a store', () => {
  test('prefers one naming the store, then one naming its category', () => {
    const card = cardWith({}, [
      'Utilities purchases include residential electricity and water service.',
      'purchases made online for internet, cable and satellite TV',
      'including any Comcast Xfinity bill',
    ])
    expect(pick(card, { category: 'tv_internet' })).toBe(
      'purchases made online for internet, cable and satellite TV',
    )
    expect(pick(card, { merchantId: 'comcast', category: 'tv_internet' })).toBe(
      'including any Comcast Xfinity bill',
    )
  })

  test('never cites what the rule leaves out for what it pays', () => {
    const card = cardWith(
      {
        match: { merchants: ['whole-foods'] },
        geography: 'us_only',
        named: { not_earning: ['instacart'] },
      },
      [
        'purchases of Whole Foods Market products through third-party sites such as Instacart',
        'purchases made at international Whole Foods Markets',
        'Gift cards are excluded.',
        'including any physical Whole Foods Market locations in the United States',
      ],
    )
    expect(pick(card, { merchantId: 'whole-foods' })).toBe(
      'including any physical Whole Foods Market locations in the United States',
    )
  })

  test("skips a list of what the rule's note says doesn't count", () => {
    const card = cardWith(
      {
        note: 'Tickets at movie theaters and sports promoters. Golf courses, country clubs and collegiate sporting events don’t count.',
      },
      [
        'golf courses, country clubs, collegiate sporting events',
        'Ticket purchases made at movie theaters, sports promoters',
      ],
    )
    expect(pick(card, { category: 'entertainment' })).toBe(
      'Ticket purchases made at movie theaters, sports promoters',
    )
  })

  test('keeps the first quote when every quote leaves something out', () => {
    const card = cardWith({}, [
      'Excludes gift cards.',
      'Does not include fees.',
    ])
    expect(pick(card, {})).toBe('Excludes gift cards.')
  })
})
