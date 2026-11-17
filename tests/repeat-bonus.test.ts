import { describe, expect, test } from 'vitest'
import { bonusEligibility } from '../src/engine/repeat-bonus.ts'
import { CardSchema } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const TODAY = '2026-11-17'

const card = (id: string, issuer: string, repeat?: object) =>
  CardSchema.parse({
    id,
    name: `${id} Card`,
    issuer,
    network: 'visa',
    currency: 'cash',
    last_verified: '2026-11-01',
    verified_by: 'test',
    source_urls: ['https://example.com/terms'],
    base_rate: 1,
    foreign_transaction_fee: 0,
    annual_fee: 0,
    welcome_offer: {
      dollars: 200,
      spend: 500,
      months: 3,
      ...(repeat ? { repeat } : {}),
    },
  })

const catalog = {
  cards: [
    card('sapphire', 'chase', { may: true }),
    card('gold', 'amex', { also: ['platinum'] }),
    card('platinum', 'amex', {}),
    card('sw-plus', 'chase', {
      after_months: 24,
      from: 'bonus',
      also: ['sw-premier'],
    }),
    card('sw-premier', 'chase', {
      after_months: 24,
      from: 'bonus',
      also: ['sw-plus'],
    }),
    card('active-cash', 'wells-fargo', {
      after_months: 48,
      from: 'opened',
      may: true,
    }),
    card('travel', 'bank-of-america', {
      after_months: 24,
      from: 'held',
      may: true,
    }),
    card('venture', 'capital-one', { after_months: 48, from: 'bonus' }),
    card('nfcu', 'navy-federal'),
  ],
  issuers: [
    { id: 'chase', name: 'Chase' },
    { id: 'amex', name: 'Amex' },
    { id: 'wells-fargo', name: 'Wells Fargo' },
    { id: 'bank-of-america', name: 'Bank of America' },
    { id: 'capital-one', name: 'Capital One' },
    { id: 'navy-federal', name: 'Navy Federal' },
  ],
} as unknown as Catalog

const wallet = (w: object) => WalletSchema.parse(w)
const check = (id: string, w: object) =>
  bonusEligibility(catalog, wallet(w), id, TODAY)

describe('repeat sign-up bonus rules', () => {
  test('no history with the card or its family says nothing', () => {
    expect(check('sapphire', {})).toBeNull()
    expect(check('sw-plus', { past_cards: [{ id: 'venture' }] })).toBeNull()
  })

  test('a once-per-card bonus is ruled out by any past card, hedged as the issuer hedges', () => {
    const r = check('sapphire', { past_cards: [{ id: 'sapphire' }] })
    expect(r?.state).toBe('once-used')
    expect(r?.text).toBe(
      "Chase says you may not get this bonus again, since you've had this card before.",
    )
  })

  test('a once rule counts the other cards it names, including one held now', () => {
    const r = check('gold', { cards: [{ id: 'platinum' }] })
    expect(r?.state).toBe('once-used')
    expect(r?.text).toBe(
      "Amex says you can't get this bonus if you have or have had platinum.",
    )
  })

  test('a family clock counts from the latest bonus on any card in it', () => {
    const r = check('sw-plus', {
      past_cards: [
        { id: 'sw-plus', bonus_received: '2023-02' },
        { id: 'sw-premier', bonus_received: '2025-03' },
      ],
    })
    expect(r).toMatchObject({ state: 'not-yet', from: '2027-03' })
    expect(r?.text).toBe(
      'Not before March 2027: Chase counts 24 months from your last bonus on this card or sw-premier. Yours posted in March 2025.',
    )
  })

  test('a bonus only known as met gives a "no earlier than" date', () => {
    const r = check('sw-premier', {
      cards: [
        {
          id: 'sw-plus',
          bonus: { opened: '2025-01-10', spent: 500, met: '2025-03' },
        },
      ],
    })
    expect(r).toMatchObject({ state: 'not-yet', from: '2027-03' })
    expect(r?.text).toBe(
      'Not before March 2027: Chase counts 24 months from your last bonus on this card or sw-plus. You reached its spending in March 2025, so it posted then or later.',
    )
  })

  test('the wait passed means eligible again', () => {
    const r = check('sw-plus', {
      past_cards: [{ id: 'sw-plus', bonus_received: '2024-10' }],
    })
    expect(r).toMatchObject({ state: 'eligible', from: '2026-10' })
    expect(r?.text).toBeNull()
  })

  test("a card that never paid a bonus doesn't start the clock", () => {
    expect(
      check('venture', {
        past_cards: [{ id: 'venture', bonus_received: false }],
      })?.state,
    ).toBe('eligible')
  })

  test('without the month, it asks for it', () => {
    const r = check('venture', { past_cards: [{ id: 'venture' }] })
    expect(r).toMatchObject({ state: 'needs-date', from: null })
    expect(r?.text).toBe(
      'Capital One counts 48 months from your last bonus on this card. Tell earnrate when yours posted to get a date.',
    )
    expect(r?.ask).toEqual({
      cardId: 'venture',
      held: false,
      pastIndex: 0,
      field: 'bonus_received',
    })
  })

  test("Wells Fargo's clock runs from the opening, held or not", () => {
    const r = check('active-cash', {
      past_cards: [{ id: 'active-cash', opened: '2025-06', closed: '2026-01' }],
    })
    expect(r).toMatchObject({ state: 'not-yet', from: '2029-06' })
    expect(r?.text).toBe(
      'Wells Fargo says you may not get it before June 2029: it counts 48 months from when you opened this card, in June 2025.',
    )
    expect(
      check('active-cash', {
        cards: [{ id: 'active-cash', opened: '2024-02-03' }],
      }),
    ).toMatchObject({ state: 'not-yet', from: '2028-02' })
  })

  test("Bank of America's runs from the last month the card was held", () => {
    expect(
      check('travel', {
        past_cards: [{ id: 'travel', closed: '2025-05' }],
      }),
    ).toMatchObject({ state: 'not-yet', from: '2027-05' })
    const held = check('travel', { cards: [{ id: 'travel' }] })
    expect(held?.state).toBe('not-yet')
    expect(held?.from).toBeNull()
    expect(held?.text).toBe(
      'Bank of America says you may not get this bonus while you have this card or for 24 months after you close it.',
    )
    expect(check('travel', { past_cards: [{ id: 'travel' }] })?.text).toBe(
      'Bank of America counts 24 months from when you last had this card. Tell earnrate when you closed it to get a date.',
    )
  })

  test('a card whose issuer states no rule says so', () => {
    const r = check('nfcu', { past_cards: [{ id: 'nfcu' }] })
    expect(r?.state).toBe('unstated')
    expect(r?.text).toBe(
      "Navy Federal's pages don't say whether you can get this bonus again after having the card.",
    )
  })

  test("the month a wait ends is hedged: it runs to the day, which earnrate doesn't know", () => {
    const r = check('sw-plus', {
      past_cards: [{ id: 'sw-plus', bonus_received: '2024-11' }],
    })
    expect(r).toMatchObject({ state: 'likely', from: '2026-11' })
    expect(r?.text).toBe(
      'Not until later in November 2026: Chase counts 24 months from your last bonus on this card or sw-premier. Yours posted in November 2024.',
    )
    expect(
      check('active-cash', {
        past_cards: [{ id: 'active-cash', opened: '2022-11' }],
      })?.text,
    ).toBe(
      'Wells Fargo says you may not get it until later in November 2026: it counts 48 months from when you opened this card, in November 2022.',
    )
  })

  test('a wait counted from the month the spend was reached is never a promise', () => {
    const held = (met: string) =>
      check('sw-premier', {
        cards: [
          {
            id: 'sw-plus',
            bonus: { opened: '2024-01-10', spent: 500, met },
          },
        ],
      })
    const passed = held('2024-03')
    expect(passed).toMatchObject({
      state: 'likely',
      from: '2026-03',
      earliest: true,
      ask: {
        cardId: 'sw-plus',
        held: true,
        pastIndex: null,
        field: 'bonus_received',
      },
    })
    expect(passed?.text).toBe(
      'Likely available again: Chase counts 24 months from your last bonus on this card or sw-plus. You reached its spending in March 2024, so it posted then or later. Tell earnrate when it posted to be sure.',
    )
    expect(held('2024-11')?.text).toMatch(
      /^Likely from about December 2026: Chase counts 24 months/,
    )
    const past = check('sw-plus', {
      past_cards: [{ id: 'sw-plus', bonus_met: '2023-05' }],
    })
    expect(past?.state).toBe('likely')
    expect(past?.ask).toMatchObject({ pastIndex: 0, held: false })
  })

  test("a family card's missing month is asked of that card", () => {
    const r = check('sw-premier', {
      past_cards: [
        { id: 'sw-premier', bonus_received: '2020-01' },
        { id: 'sw-plus' },
      ],
    })
    expect(r?.state).toBe('needs-date')
    expect(r?.ask).toEqual({
      cardId: 'sw-plus',
      held: false,
      pastIndex: 1,
      field: 'bonus_received',
    })
    expect(
      check('sw-plus', { cards: [{ id: 'sw-premier' }] })?.ask,
    ).toMatchObject({ cardId: 'sw-premier', held: true })
  })
})
