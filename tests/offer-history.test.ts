import { describe, expect, test } from 'vitest'
import {
  offerHigh,
  offerHistory,
  offerHistoryText,
  offerRecords,
} from '../src/engine/offer-history.ts'
import { CardSchema } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { ChangesFileSchema } from '../src/schema/changes.ts'
import { dateRange } from '../src/engine/text.ts'

const TODAY = '2026-11-17'

const card = (id: string, welcome_offer?: object, extra: object = {}) =>
  CardSchema.parse({
    id,
    name: `${id} Card`,
    issuer: 'chase',
    network: 'visa',
    currency: id.startsWith('cash') ? 'cash' : 'hotel-points',
    last_verified: '2026-11-16',
    verified_by: 'test',
    source_urls: ['https://example.com/card'],
    base_rate: 1,
    foreign_transaction_fee: 0,
    annual_fee: 0,
    ...(welcome_offer ? { welcome_offer } : {}),
    ...extra,
  })

const release = (version: string, changes: object[]) => ({
  version,
  date: version.slice(0, 10).replaceAll('.', '-'),
  changes,
})

function catalogOf(cards: ReturnType<typeof card>[], releases: object[]) {
  return {
    cards,
    currencies: [
      { id: 'cash', name: 'cash back', value_cents: 1 },
      { id: 'hotel-points', name: 'Hotel points', value_cents: 0.5 },
    ],
    issuers: [{ id: 'chase', name: 'Chase' }],
    categories: [],
    memberships: [],
    merchants: { seed: [], overrides: [] },
    offerRecords: offerRecords(ChangesFileSchema.parse(releases)),
  } as unknown as Catalog
}

// Newest release first, as in data/changes.yaml.
const HOTEL_RELEASES = [
  release('2026.11.17', [
    {
      cause: 'issuer',
      card: 'hotel',
      field: 'welcome_offer',
      was: { points: 180000, spend: 3000, months: 3 },
      now: { points: 140000, spend: 3000, months: 3 },
      source: 'https://example.com/card',
      detected: '2026-11-16',
    },
  ]),
  release('2026.11.02', [
    {
      cause: 'wording',
      card: 'hotel',
      field: 'welcome_offer.note',
      summary: 'Clearer note.',
    },
  ]),
  release('2026.10.27', [
    {
      cause: 'addition',
      cards: ['hotel', 'cash-one'],
      field: 'welcome_offer',
      summary: 'Public welcome offers.',
    },
  ]),
  release('2026.10.24', [
    {
      cause: 'addition',
      cards: ['hotel', 'cash-one'],
      summary: 'First release.',
    },
  ]),
]

describe('offer history', () => {
  const hotel = card('hotel', { points: 140000, spend: 3000, months: 3 })
  const cashOne = card('cash-one', { dollars: 200, spend: 500, months: 3 })
  const catalog = catalogOf([hotel, cashOne], HOTEL_RELEASES)

  test('starts when the offer was first recorded and turns at each issuer change', () => {
    const h = offerHistory(catalog, hotel, TODAY)
    expect(h?.since).toBe('2026-10-27')
    expect(
      h?.periods.map((p) => [p.points, p.from, p.to, p.current, p.value]),
    ).toEqual([
      [180000, '2026-10-27', '2026-11-15', false, 900],
      [140000, '2026-11-16', '2026-11-16', true, 700],
    ])
  })

  test('the highest offer, when the current one is lower', () => {
    expect(offerHigh(catalog, hotel, TODAY)).toMatchObject({
      text: 'Highest public offer earnrate has recorded: 180,000 Hotel points after $3,000 in purchases within 3 months (Oct 27 – Nov 15, 2026); the current one is lower.',
      isCurrent: false,
      only: false,
      points: 180000,
      spend: 3000,
      months: 3,
      value: 900,
      seen: [{ from: '2026-10-27', to: '2026-11-15' }],
    })
    expect(offerHistoryText(catalog, hotel, TODAY)).toEqual({
      lead: "It's been the public offer since Nov 16, 2026. Lower than the 180,000 Hotel points after $3,000 in purchases within 3 months seen Oct 27 – Nov 15, 2026.",
      earlier: [],
    })
  })

  test('one recorded offer makes no claim about being the highest', () => {
    expect(offerHigh(catalog, cashOne, TODAY)?.text).toBe(
      'earnrate has recorded only this public offer, since Oct 27, 2026.',
    )
    expect(offerHistoryText(catalog, cashOne, TODAY)?.lead).toBe(
      'This is the only public offer earnrate has recorded since it started tracking this card on Oct 27, 2026.',
    )
  })

  test('a card added later starts from its own addition', () => {
    const late = card('cash-late', { dollars: 100, spend: 0, months: 1 })
    const c = catalogOf(
      [late],
      [
        release('2026.11.05', [
          { cause: 'addition', card: 'cash-late', summary: 'New card.' },
        ]),
      ],
    )
    expect(offerHistory(catalog, late, TODAY)).toBeNull()
    expect(offerHistory(c, late, TODAY)?.since).toBe('2026-11-05')
  })

  test("a correction's wrong value never shows as history", () => {
    const fixed = card('cash-fixed', { dollars: 300, spend: 1000, months: 3 })
    const c = catalogOf(
      [fixed],
      [
        release('2026.11.10', [
          {
            cause: 'correction',
            card: 'cash-fixed',
            field: 'welcome_offer',
            was: { dollars: 30, spend: 1000, months: 3 },
            now: { dollars: 300, spend: 1000, months: 3 },
            summary: 'A typo.',
          },
        ]),
        release('2026.10.27', [
          {
            cause: 'addition',
            card: 'cash-fixed',
            field: 'welcome_offer',
            summary: 'Offers.',
          },
        ]),
      ],
    )
    const h = offerHistory(c, fixed, TODAY)
    expect(h?.periods.map((p) => [p.dollars, p.from])).toEqual([
      [300, '2026-10-27'],
    ])
  })

  test('an issuer change uses its effective day, and a change to one term keeps the rest', () => {
    const up = card('cash-up', {
      dollars: 250,
      spend: 500,
      months: 3,
      varies: true,
    })
    const c = catalogOf(
      [up],
      [
        release('2026.11.12', [
          {
            cause: 'issuer',
            card: 'cash-up',
            field: 'welcome_offer.dollars',
            was: 200,
            now: 250,
            source: 'https://example.com/card',
            detected: '2026-11-11',
            effective: '2026-11-09',
          },
        ]),
        release('2026.10.27', [
          {
            cause: 'addition',
            card: 'cash-up',
            field: 'welcome_offer',
            summary: 'Offers.',
          },
        ]),
      ],
    )
    const h = offerHistory(c, up, TODAY)
    expect(h?.periods.map((p) => [p.dollars, p.varies, p.from, p.to])).toEqual([
      [200, true, '2026-10-27', '2026-11-08'],
      [250, true, '2026-11-09', '2026-11-16'],
    ])
    expect(offerHigh(c, up, TODAY)?.text).toBe(
      'Highest public offer earnrate has recorded: this one, since Nov 9, 2026.',
    )
    expect(offerHistoryText(c, up, TODAY)).toEqual({
      lead: "It's been the public offer since Nov 9, 2026, the highest earnrate has recorded since it started tracking this card on Oct 27, 2026.",
      earlier: [
        {
          from: '2026-10-27',
          to: '2026-11-08',
          text: 'up to $200 after $500 in purchases within 3 months',
        },
      ],
    })
  })

  test('an old offer with an end date ran through it', () => {
    const dated = card('cash-dated', { dollars: 300, spend: 1000, months: 3 })
    const c = catalogOf(
      [dated],
      [
        release('2026.11.05', [
          {
            cause: 'issuer',
            card: 'cash-dated',
            field: 'welcome_offer',
            was: {
              dollars: 250,
              spend: 1000,
              months: 3,
              valid_to: '2026-11-04',
            },
            now: { dollars: 300, spend: 1000, months: 3 },
            source: 'https://example.com/card',
            detected: '2026-11-05',
            effective: '2026-11-04',
          },
        ]),
        release('2026.10.27', [
          {
            cause: 'addition',
            card: 'cash-dated',
            field: 'welcome_offer',
            summary: 'Offers.',
          },
        ]),
      ],
    )
    expect(
      offerHistory(c, dated, TODAY)?.periods.map((p) => [
        p.dollars,
        p.from,
        p.to,
      ]),
    ).toEqual([
      [250, '2026-10-27', '2026-11-04'],
      [300, '2026-11-05', '2026-11-16'],
    ])
  })

  test('ties go to the lower spend, then the longer window, then an offer everyone gets', () => {
    const tied = card('cash-tied', { dollars: 200, spend: 500, months: 3 })
    const c = catalogOf(
      [tied],
      [
        release('2026.11.10', [
          {
            cause: 'issuer',
            card: 'cash-tied',
            field: 'welcome_offer',
            was: { dollars: 200, spend: 500, months: 6, varies: true },
            now: { dollars: 200, spend: 500, months: 3 },
            source: 'https://example.com/card',
          },
        ]),
        release('2026.11.01', [
          {
            cause: 'issuer',
            card: 'cash-tied',
            field: 'welcome_offer',
            was: { dollars: 200, spend: 1500, months: 6 },
            now: { dollars: 200, spend: 500, months: 6, varies: true },
            source: 'https://example.com/card',
          },
        ]),
        release('2026.10.27', [
          {
            cause: 'addition',
            card: 'cash-tied',
            field: 'welcome_offer',
            summary: 'Offers.',
          },
        ]),
      ],
    )
    const high = offerHigh(c, tied, TODAY)
    expect(high).toMatchObject({ spend: 500, months: 6, varies: true })
    expect(high?.text).toBe(
      'Highest public offer earnrate has recorded: up to $200 after $500 in purchases within 6 months (Nov 1 – Nov 9, 2026); the current one gives less time.',
    )
    expect(
      offerHistoryText(c, tied, TODAY)?.earlier.map((e) => e.from),
    ).toEqual(['2026-11-01', '2026-10-27'])
  })

  test('an offer that ended leaves its history', () => {
    const gone = card('cash-gone', {
      dollars: 150,
      spend: 500,
      months: 3,
      valid_to: '2026-11-10',
    })
    const c = catalogOf(
      [gone],
      [
        release('2026.10.27', [
          {
            cause: 'addition',
            card: 'cash-gone',
            field: 'welcome_offer',
            summary: 'Offers.',
          },
        ]),
      ],
    )
    expect(offerHistory(c, gone, TODAY)?.current).toBeNull()
    expect(offerHigh(c, gone, TODAY)?.text).toBe(
      "The only public offer earnrate has recorded: $150 after $500 in purchases within 3 months (Oct 27 – Nov 10, 2026); there's no public offer now.",
    )
    expect(offerHistoryText(c, gone, TODAY)?.lead).toBe(
      'No public offer now. The highest earnrate has recorded since it started tracking this card on Oct 27, 2026: $150 after $500 in purchases within 3 months, seen Oct 27 – Nov 10, 2026.',
    )
  })
})

test('date ranges say the year once when it is shared', () => {
  expect(dateRange('2026-10-27', '2026-11-15')).toBe('Oct 27 – Nov 15, 2026')
  expect(dateRange('2026-12-20', '2027-01-04')).toBe(
    'Dec 20, 2026 – Jan 4, 2027',
  )
  expect(dateRange('2026-11-03', '2026-11-03')).toBe('Nov 3, 2026')
})
