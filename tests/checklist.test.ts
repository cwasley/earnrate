import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { checklist, checklistCalendar } from '../src/engine/checklist.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const catalog = await loadCatalog()
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
    ])
    expect(items[0]).toMatchObject({ due: '2026-12-14' })
    expect(items[0]?.text).toMatch(/by Dec 14, 2026\.$/)
    expect(items[1]?.text).toMatch(/\$800 left of \$6,000/)
    expect(items[2]?.text).toMatch(/5% and 2% categories for this quarter/)
    expect(items[3]?.text).toMatch(
      /\$2,100 to go by Apr 1, 2027, about \$\d+ a week\.$/,
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
      expect.stringMatching(
        /3% pick is assumed to be gas stations and EV charging; set it/,
      ),
    ])
    const late = checklist(catalog, w, '2026-12-20').map((i) => i.text)
    expect(late[0]).toMatch(
      /categories for next quarter; this one ends Dec 31, 2026\./,
    )
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
