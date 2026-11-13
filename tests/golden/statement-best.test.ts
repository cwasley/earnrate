import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../../src/data/load.ts'
import type { CardLine } from '../../src/import/analyze.ts'
import {
  bestCardsFor,
  FEE_MIN_DAYS,
  feeShare,
} from '../../src/import/best-cards.ts'
import { parseStatement } from '../../src/import/statement.ts'
import type { Wallet } from '../../src/schema/wallet.ts'

const catalog = await loadCatalog()

// Synthetic Amex activity: made-up purchases in Amex's columns.
const AMEX_HEADER =
  'Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category'

type Row = [date: string, description: string, amount: number, category: string]

const amexCsv = (rows: Row[]) =>
  [
    AMEX_HEADER,
    ...rows.map(
      ([date, description, amount, category]) =>
        `${date.slice(5, 7)}/${date.slice(8)}/${date.slice(0, 4)},${description},${amount.toFixed(2)},"",${description},"","","",UNITED STATES,'0',${category}`,
    ),
  ].join('\r\n')

const day = (start: string, plus: number) => {
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + plus)
  return d.toISOString().slice(0, 10)
}

const GROCERY = 'Merchandise & Supplies-Groceries'
const GAS = 'Transportation-Fuel'
const DINING = 'Restaurant-Restaurant'

const entries = (cardId: string, rows: Row[]): CardLine[] =>
  parseStatement(amexCsv(rows)).lines.map((line) => ({ cardId, line }))

const wallet = (cards: string[], memberships: string[] = []): Wallet => ({
  valuations: {},
  memberships,
  cards: cards.map((id) => ({ id, cap_usage: {}, activated: [] })),
})

// $7,000 at a supermarket over 40 days in the fourth quarter of 2026, plus
// a refund that earns nothing either way.
const SUPERMARKET: Row[] = [
  ...Array.from({ length: 14 }, (_, i): Row => [
    day('2026-10-01', i * 3),
    'KROGER #123',
    500,
    GROCERY,
  ]),
  ['2026-11-09', 'KROGER #123', -100, GROCERY],
]

const single = (r: ReturnType<typeof bestCardsFor>, id: string) =>
  r.singles.find((s) => s.cardIds[0] === id)

describe('the best cards for a statement file', () => {
  const file = entries('amex-gold', SUPERMARKET)
  const result = bestCardsFor(catalog, wallet(['amex-gold']), file)

  test('covers the days from the first line to the last', () => {
    expect(result).toMatchObject({
      from: '2026-10-01',
      to: '2026-11-09',
      days: 40,
    })
  })

  test("a capped rate earns up to its cap, then the card's rate after it", () => {
    // Blue Cash Preferred: 6% on the first $6,000 at US supermarkets a
    // calendar year, then 1%.
    expect(single(result, 'amex-blue-cash-preferred')?.earned).toBe(370)
  })

  test('a flat card earns its rate on every purchase; refunds earn nothing', () => {
    expect(single(result, 'citi-double-cash')?.earned).toBe(140)
  })

  test('a rotating quarter counts as activated, up to its quarterly cap', () => {
    // Freedom Flex's fourth quarter of 2026: 5% at grocery stores on the
    // first $1,500, then 1%.
    expect(single(result, 'chase-freedom-flex')?.earned).toBe(130)
  })

  test('the annual fee is prorated to the days the file covers', () => {
    const bcp = single(result, 'amex-blue-cash-preferred')
    expect(bcp?.annualFees).toBe(95)
    expect(bcp?.feeShare).toBe(10.41) // $95 × 40 / 365
    expect(bcp?.net).toBe(359.59)
    expect(feeShare(95, 40)).toBe(10.41)
  })

  test('cards rank by what they earned net of the prorated fee', () => {
    const nets = result.singles.map((s) => s.net)
    expect(nets).toEqual([...nets].sort((a, b) => b - a))
  })

  test('ranks personal cards still open to applications', () => {
    const ids = result.singles.map((s) => s.cardIds[0] ?? '')
    const cards = ids.map((id) => catalog.cards.find((c) => c.id === id))
    expect(cards.every((c) => c && !c.business && !c.applications_closed)).toBe(
      true,
    )
    expect(ids).toContain('amex-gold')
  })

  test('is the same every time', () => {
    expect(bestCardsFor(catalog, wallet(['amex-gold']), file)).toEqual(result)
  })
})

describe('a card that needs a membership', () => {
  const costco = 'citi-costco-anywhere-visa'

  test('is left out, and named apart, unless the file shows the membership', () => {
    const r = bestCardsFor(
      catalog,
      wallet(['amex-gold']),
      entries('amex-gold', SUPERMARKET),
    )
    expect(single(r, costco)).toBeUndefined()
    expect(r.membersOnly.find((m) => m.cardIds[0] === costco)).toMatchObject({
      membership: 'costco',
    })
  })

  test('is ranked when a purchase at Costco shows it', () => {
    const r = bestCardsFor(
      catalog,
      wallet(['amex-gold']),
      entries('amex-gold', [
        ...SUPERMARKET,
        [
          '2026-10-20',
          'COSTCO WHSE #0123',
          88.4,
          'Merchandise & Supplies-Wholesale Stores',
        ],
      ]),
    )
    expect(single(r, costco)).toBeDefined()
    expect(r.membersOnly.some((m) => m.cardIds[0] === costco)).toBe(false)
  })

  test('is ranked when the visitor says they have it', () => {
    const r = bestCardsFor(
      catalog,
      wallet(['amex-gold'], ['costco']),
      entries('amex-gold', SUPERMARKET),
    )
    expect(single(r, costco)).toBeDefined()
  })
})

describe('a card with a category to pick', () => {
  test('gets the pick that earns the most on these purchases', () => {
    // Customized Cash: 3% in the picked category, on the first $2,500 a
    // quarter across its 3% and 2% categories, then 1%.
    const dining = Array.from({ length: 10 }, (_, i): Row => [
      day('2026-10-02', i * 5),
      'TST* HARBOR NOODLE BAR',
      300,
      DINING,
    ])
    const r = bestCardsFor(
      catalog,
      wallet(['amex-gold']),
      entries('amex-gold', dining),
    )
    const cash = single(r, 'bank-of-america-customized-cash-rewards')
    expect(cash?.picks).toEqual({
      'bank-of-america-customized-cash-rewards': {
        'three-percent': ['dining'],
      },
    })
    expect(cash?.earned).toBe(80) // 3% of $2,500 + 1% of $500
  })
})

describe('the best two cards', () => {
  const mixed: Row[] = Array.from({ length: 12 }, (_, i): Row[] => [
    [day('2026-10-01', i * 3), 'KROGER #123', 180, GROCERY],
    [day('2026-10-02', i * 3), 'SHELL OIL 57444', 60, GAS],
    [day('2026-10-02', i * 3), 'TST* HARBOR NOODLE BAR', 45, DINING],
  ]).flat()
  const r = bestCardsFor(
    catalog,
    wallet(['amex-gold']),
    entries('amex-gold', mixed),
  )

  test('each purchase goes on whichever of the two earns more, with both fees', () => {
    expect(r.pair).not.toBeNull()
    const [a, b] = r.pair?.cardIds ?? []
    expect(a).not.toBe(b)
    expect(r.pair?.net).toBeGreaterThan(r.singles[0]?.net ?? Infinity)
    const fees = (r.pair?.cardIds ?? []).map(
      (id) => catalog.cards.find((c) => c.id === id)?.annual_fee ?? 0,
    )
    expect(fees).toHaveLength(2)
    expect(r.pair?.annualFees).toBe(fees.reduce((sum, f) => sum + f, 0))
  })

  test("is no less than either card's own result", () => {
    for (const id of r.pair?.cardIds ?? [])
      expect(r.pair?.earned).toBeGreaterThanOrEqual(single(r, id)?.earned ?? 0)
  })
})

describe('a purchase at a store earnrate has down as not taking a card', () => {
  // Costco's warehouses take only Visa: the file shows this one took the
  // Amex used, so Amex cards count there; a Mastercard doesn't.
  const r = bestCardsFor(
    catalog,
    wallet(['amex-gold'], ['costco']),
    entries('amex-gold', [
      [
        '2026-10-20',
        'COSTCO WHSE #0123',
        100,
        'Merchandise & Supplies-Wholesale Stores',
      ],
    ]),
  )

  test('counts on cards on the network the statement shows it took', () => {
    expect(single(r, 'amex-blue-cash-everyday')?.earned).toBeGreaterThan(0)
  })

  test("earns nothing on a card it doesn't take", () => {
    expect(single(r, 'citi-double-cash')?.earned).toBe(0)
  })
})

describe('fees on a short file', () => {
  test(`a file under ${String(FEE_MIN_DAYS)} days compares earnings alone`, () => {
    expect(feeShare(325, FEE_MIN_DAYS - 1)).toBe(0)
    expect(feeShare(325, 25)).toBe(0)
    expect(feeShare(365, FEE_MIN_DAYS)).toBe(FEE_MIN_DAYS)
  })
})
