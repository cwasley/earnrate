import { describe, expect, test } from 'vitest'
import { catalogProblems } from '../src/data/integrity.ts'
import { loadCatalog } from '../src/data/load.ts'
import { cardDetails } from '../src/engine/card-details.ts'
import {
  keepOrReplace,
  keepOrReplaceText,
} from '../src/engine/keep-or-replace.ts'
import { compareOffers } from '../src/engine/offers.ts'
import { cardInfo } from '../src/engine/setup.ts'
import {
  yearlyPointsAmount,
  yearlyPointsLine,
  yearlyPointsText,
} from '../src/engine/yearly-points.ts'
import { formatCardInfo } from '../src/format/cards.ts'
import { YearlyPointsSchema } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const catalog = await loadCatalog()
const TODAY = '2026-11-13'
const VX = 'capital-one-venture-x'

const cardOf = (c: Catalog, id: string) => {
  const card = c.cards.find((x) => x.id === id)
  if (!card) throw new Error(`no ${id}`)
  return card
}

describe('the schema', () => {
  test('takes a fixed amount or a percent of purchases or points, one at a time', () => {
    const parse = (y: object) => YearlyPointsSchema.safeParse(y).success
    expect(parse({ id: 'a', points: 10000 })).toBe(true)
    expect(parse({ id: 'a', percent: 10, of: 'purchases' })).toBe(true)
    expect(parse({ id: 'a', percent: 10, of: 'points' })).toBe(true)
    expect(parse({ id: 'a', points: 10000, percent: 10, of: 'points' })).toBe(
      false,
    )
    expect(parse({ id: 'a', percent: 10 })).toBe(false)
    expect(parse({ id: 'a', points: 10000, of: 'points' })).toBe(false)
    expect(parse({ id: 'a' })).toBe(false)
  })

  test('the integrity check wants a quote that states the amount', () => {
    const card = cardOf(catalog, VX)
    const unquoted: Catalog = {
      ...catalog,
      cards: catalog.cards.map((c) =>
        c.id === VX
          ? {
              ...card,
              evidence: card.evidence.map((e) =>
                e.rule === 'anniversary-miles'
                  ? {
                      ...e,
                      quote: 'bonus miles after your anniversary each year',
                    }
                  : e,
              ),
            }
          : c,
      ),
    }
    expect(catalogProblems(catalog)).toEqual([])
    expect(catalogProblems(unquoted)).toContain(
      `card ${VX} anniversary-miles: no evidence quote states its amount`,
    )
  })
})

describe('the amount', () => {
  const year = { spend: 20000, points: 30000 }
  test('a fixed amount is the same whatever the card took', () => {
    expect(yearlyPointsAmount({ id: 'a', points: 10000 }, year)).toBe(10000)
  })
  test('a percentage is of the purchases or of the points they earned', () => {
    expect(
      yearlyPointsAmount({ id: 'a', percent: 10, of: 'purchases' }, year),
    ).toBe(2000)
    expect(
      yearlyPointsAmount({ id: 'a', percent: 10, of: 'points' }, year),
    ).toBe(3000)
  })
  test('the words', () => {
    expect(
      yearlyPointsText({ id: 'a', points: 10000 }, 'Capital One miles'),
    ).toBe('10,000 Capital One miles every year')
    expect(
      yearlyPointsLine(
        { id: 'a', percent: 10, of: 'purchases' },
        'Chase Ultimate Rewards',
        1,
      ),
    ).toBe(
      "Chase Ultimate Rewards equal to 10% of the year's purchases, every year (about $1 for each $1,000 spent at 1¢ a point)",
    )
  })
})

describe("Claude's card answers name them", () => {
  test('card search, with their value at the saved point value', () => {
    const wallet = WalletSchema.parse({ valuations: { C1: 1.5 }, cards: [] })
    const info = cardInfo(catalog, cardOf(catalog, VX), wallet, TODAY)
    expect(info.yearlyPoints).toEqual([
      {
        id: 'anniversary-miles',
        points: 10000,
        percent: null,
        of: null,
        value: 150,
        text: '10,000 Capital One miles every year (about $150 at 1.5¢ a point)',
      },
    ])
    expect(formatCardInfo(catalog, info)).toContain(
      'yearly points anniversary-miles: 10,000 Capital One miles every year (about $150 at 1.5¢ a point), with nothing to enroll in',
    )
  })

  test("the fee math counts them and says so, beside the card's credit", () => {
    const [details] = cardDetails(catalog, [VX], null, TODAY) ?? []
    expect(details?.feeWorth?.text).toContain(
      "If you'd use its statement credit ($300 a year at Capital One Travel), it and its 10,000 Capital One miles every year are worth more than its $395 fee, so it comes out ahead at any amount.",
    )
    expect(details?.feeWorth?.text).toContain(
      'the regular annual fee; its 10,000 Capital One miles every year; no welcome bonus',
    )
  })

  test('keep-or-replace says it counts them', () => {
    const wallet = WalletSchema.parse({ cards: [{ id: VX }] })
    const k = keepOrReplace(catalog, wallet, VX, TODAY)
    if (!k) throw new Error('no answer')
    expect(keepOrReplaceText(catalog, k)).toContain(
      "Counts the Capital One Venture X Rewards' 10,000 Capital One miles every year.",
    )
  })
})

test('a welcome-offer comparison counts them from year two, after the first anniversary', () => {
  const plain: Catalog = {
    ...catalog,
    cards: catalog.cards.map((c) =>
      c.id === VX ? { ...c, yearly_points: [] } : c,
    ),
  }
  const wallet = WalletSchema.parse({ cards: [] })
  const filters = {
    kind: 'any' as const,
    business: false,
    noAnnualFee: false,
    includeHeld: false,
    only: [VX],
  }
  const plan = (c: Catalog) =>
    compareOffers(c, wallet, filters, TODAY).offers.find((o) => o.cardId === VX)
      ?.plan
  const withPoints = plan(catalog)
  const without = plan(plain)
  expect(withPoints?.yearOne).toBe(without?.yearOne)
  expect(withPoints?.yearTwo).toBe((without?.yearTwo ?? NaN) + 100)
  expect(
    compareOffers(catalog, wallet, filters, TODAY).notes.join(' '),
  ).toContain(
    'and points a card gives every year from year two, after its first anniversary',
  )
})
