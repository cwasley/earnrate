import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import {
  checklist,
  checklistCalendar,
  checklistRows,
} from '../src/engine/checklist.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const catalog = { ...(await loadCatalog()), changes: [] }
const TODAY = '2026-11-01'

const wallet = WalletSchema.parse({
  cards: [
    { id: 'chase-freedom-flex' },
    { id: 'usbank-cash-plus' },
    {
      id: 'amex-blue-cash-preferred',
      cap_usage: { 'us-supermarkets': { period: '2026', spent: 5200 } },
      bonus: { opened: '2026-10-01', spent: 900 },
    },
  ],
})

describe('checklist', () => {
  const items = checklist(catalog, wallet, TODAY)
  const kinds = items.map((i) => `${i.kind}:${i.cardId}`)

  test('lists activations, picks, caps and welcome bonuses, soonest first', () => {
    expect(kinds).toEqual([
      'activate:chase-freedom-flex',
      'cap:amex-blue-cash-preferred',
      'pick:usbank-cash-plus',
      'bonus:amex-blue-cash-preferred',
      'enroll:amex-blue-cash-preferred',
    ])
    expect(items[0]).toMatchObject({ due: '2026-12-14' })
    expect(items[0]?.text).toMatch(/by Dec 14, 2026\.$/)
    expect(items[1]).toMatchObject({ due: '2026-12-31' })
    expect(items[1]?.text).toMatch(/\$800 left of \$6,000/)
    expect(items[2]?.text).toMatch(/5% and 2% categories for this quarter/)
    expect(items[3]?.text).toMatch(
      /\$2,100 to go by Apr 1, 2027, about \$\d+ a week\.$/,
    )
  })

  test('a choice named for its category is not followed by "categories"', () => {
    const custom = WalletSchema.parse({ cards: [{ id: 'citi-custom-cash' }] })
    const [pick] = checklist(catalog, custom, TODAY).filter(
      (i) => i.kind === 'pick',
    )
    expect(pick?.text).toMatch(
      /^Set Citi Custom Cash Card's top category for this month: Citi gives the bonus where you spend the most, and earnrate counts it only where you say\.$/,
    )
  })

  test('a done activation and current picks drop off', () => {
    const done = WalletSchema.parse({
      cards: [
        { id: 'chase-freedom-flex', activated: ['q4-2026-grocery'] },
        {
          id: 'usbank-cash-plus',
          chosen: {
            period: '2026-Q4',
            picks: {
              'five-percent': ['fast-food', 'ground-transportation'],
              'two-percent': ['grocery'],
            },
          },
        },
      ],
    })
    expect(checklist(catalog, done, TODAY)).toEqual([])
  })

  test('an activation whose deadline has passed drops off', () => {
    const flex = WalletSchema.parse({ cards: [{ id: 'chase-freedom-flex' }] })
    const later = checklist(catalog, flex, '2026-12-20')
    expect(later.map((i) => i.text).join(' ')).not.toMatch(/Dec 14, 2026/)
    for (const item of later)
      expect((item.due ?? '9999-12-31') >= '2026-12-20').toBe(true)
  })

  test("next quarter's activation says when the issuer opens it, and is due then", () => {
    const flex = WalletSchema.parse({
      cards: [{ id: 'chase-freedom-flex', activated: ['q4-2026-grocery'] }],
    })
    const next = checklist(catalog, flex, '2026-12-01').find(
      (i) => i.kind === 'activate',
    )
    expect(next?.text).toMatch(
      /starting Dec 15, 2026 \(it starts Jan 1, 2027\)\.$/,
    )
    expect(next?.due).toBe('2026-12-15')
    const open = checklist(catalog, flex, '2026-12-16').find(
      (i) => i.kind === 'activate',
    )
    expect(open?.text).not.toMatch(/starting/)
  })

  test('caps with room left, assumed picks and the next period', () => {
    const w = WalletSchema.parse({
      memberships: ['bofa-rewards-preferred-plus'],
      cards: [
        {
          id: 'amex-blue-cash-preferred',
          cap_usage: { 'us-supermarkets': { period: '2026', spent: 1000 } },
        },
        { id: 'bank-of-america-customized-cash-rewards' },
        {
          id: 'usbank-cash-plus',
          chosen: {
            period: '2026-Q4',
            picks: {
              'five-percent': ['fast-food', 'ground-transportation'],
              'two-percent': ['grocery'],
            },
          },
        },
      ],
    })
    const early = checklist(catalog, w, TODAY).map((i) => i.text)
    expect(early.join(' ')).not.toMatch(/left of \$6,000/)
    expect(early).toEqual([
      expect.stringMatching(/^Enroll in .*Disney\+, Hulu and ESPN credit/),
      expect.stringMatching(
        /3% pick is assumed to be gas stations and EV charging; set it/,
      ),
    ])
    const late = checklist(catalog, w, '2026-12-20').map((i) => i.text)
    expect(late[0]).toMatch(
      /categories for next quarter; this one ends Dec 31, 2026\./,
    )
  })

  test('a cardmember-year cap resets the day before the anniversary', () => {
    const ink = WalletSchema.parse({
      cards: [
        {
          id: 'chase-ink-business-cash',
          anniversary: '03-15',
          cap_usage: {
            'five-percent-combined': { period: '2026', spent: 25000 },
          },
        },
      ],
    })
    const [cap] = checklist(catalog, ink, '2027-01-10')
    expect(cap).toMatchObject({ kind: 'cap', due: '2027-03-14' })
    expect(cap?.text).toMatch(/cap is used up until Mar 14, 2027;/)
  })

  test('the calendar has an event for each dated action, not for caps', () => {
    const ics = checklistCalendar(items, '20261101T120000Z')
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261214')
    expect(ics).toContain('TRIGGER:-P2D')
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true)
  })
})

describe('spend milestones', () => {
  const ihg = (usage?: Record<string, { period: string; spent: number }>) =>
    WalletSchema.parse({
      cards: [
        {
          id: 'chase-ihg-one-rewards-premier',
          ...(usage ? { milestone_usage: usage } : {}),
        },
      ],
    })
  const milestones = (w: ReturnType<typeof ihg>) =>
    checklist(catalog, w, TODAY).filter((i) => i.kind === 'milestone')

  test('show up once at least 75% of the way, with the end of the year', () => {
    expect(
      milestones(ihg({ 'spend-15k': { period: '2026', spent: 11249 } })),
    ).toEqual([])
    const [item] = milestones(
      ihg({ 'spend-15k': { period: '2026', spent: 11250 } }),
    )
    expect(item).toMatchObject({ due: '2026-12-31' })
    expect(item?.text).toBe(
      'IHG One Rewards Premier Credit Card: $11,250 of $15,000 spent toward 15,000 bonus points, Platinum Elite status and 5 Elite Night Credits; $3,750 to go by Dec 31, 2026.',
    )
  })

  test("not once reached, when untracked, or for last year's spending", () => {
    for (const w of [
      ihg({ 'spend-15k': { period: '2026', spent: 15000 } }),
      ihg(),
      ihg({ 'spend-15k': { period: '2025', spent: 14000 } }),
    ])
      expect(milestones(w)).toEqual([])
  })
})

test('a first-year rate ending this quarter is on the list, one ending later is not', () => {
  const items = checklist(
    catalog,
    WalletSchema.parse({
      cards: [
        { id: 'discover-it-cash-back', opened: '2025-12-01' },
        {
          id: 'bank-of-america-customized-cash-rewards',
          opened: '2026-01-10',
        },
      ],
    }),
    TODAY,
  ).filter((i) => i.kind === 'intro')
  expect(items).toEqual([
    {
      kind: 'intro',
      cardId: 'discover-it-cash-back',
      text: "Discover it Cash Back Credit Card's first-year rate ends after Nov 30, 2026; from then on it earns its standard rates.",
      due: '2026-11-30',
    },
  ])
})

test('an activation over stores and services gives each its own preposition', () => {
  const items = checklist(
    catalog,
    WalletSchema.parse({ cards: [{ id: 'discover-it-cash-back' }] }),
    '2026-11-06',
  )
  expect(items.find((i) => i.kind === 'activate')?.text).toMatch(
    /bonus at restaurants, .*, and on home utilities, /,
  )
})

describe('rows for the site', () => {
  const amexWallet = WalletSchema.parse({
    cards: [
      { id: 'amex-gold', enrolled: ['dunkin'] },
      { id: 'amex-platinum' },
      { id: 'chase-freedom-flex' },
    ],
  })
  const items = checklistRows(catalog, amexWallet, TODAY, undefined, (id) =>
    id === 'amex-gold' ? 'Amex Gold' : id,
  )
  const row = (kind: string, cardId: string, ref?: string) =>
    items.find(
      (i) =>
        i.kind === kind &&
        i.cardId === cardId &&
        (ref === undefined || i.ref === ref),
    )?.row

  test('a credit to use gives its amount left and its date, without the year', () => {
    expect(row('credit', 'amex-gold', 'dunkin')).toEqual({
      title: "Use Dunkin' credit",
      card: 'Amex Gold',
      when: 'by Nov 30',
      amount: '$7 left',
      button: 'Mark used',
    })
  })

  test('long lists of credits are cut short', () => {
    expect(
      items
        .filter((i) => i.kind === 'enroll' && i.cardId === 'amex-platinum')
        .map((i) => i.row.title),
    ).toEqual([
      'Do you use the Uber, Uber One and 3 more credits?',
      'Enroll in Lululemon, Resy and 4 more credits',
    ])
    expect(row('enroll', 'amex-gold', 'uber-cash')?.button).toBe('Answer')
  })

  test('an activation names its categories and its deadline', () => {
    expect(row('activate', 'chase-freedom-flex')).toMatchObject({
      title: 'Activate bonus: grocery stores, restaurants and 1 more',
      when: 'by Dec 14',
      button: 'Activate',
    })
  })

  test('the checklist itself carries only the sentences', () => {
    const plain = checklist(catalog, amexWallet, TODAY)
    expect(plain.every((i) => !('row' in i))).toBe(true)
    expect(plain.map((i) => i.text)).toEqual(
      checklistRows(catalog, amexWallet, TODAY).map((i) => i.text),
    )
  })
})
