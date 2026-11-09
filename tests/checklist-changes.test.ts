import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { checklist } from '../src/engine/checklist.ts'
import { cardText } from '../src/format/card-text.ts'
import { ChangesFileSchema } from '../src/schema/changes.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const real = await loadCatalog()
const TODAY = '2026-12-01'

const releases = ChangesFileSchema.parse([
  {
    version: '2026.11.20',
    date: '2026-11-20',
    changes: [
      {
        cause: 'issuer',
        card: 'chase-sapphire-preferred',
        field: 'rules.dining',
        was: 2,
        now: 3,
        source:
          'https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred',
        effective: '2026-11-15',
        detected: '2026-11-18',
      },
      {
        cause: 'issuer',
        card: 'amex-gold',
        field: 'annual_fee',
        was: 250,
        now: 325,
        source:
          'https://www.americanexpress.com/us/credit-cards/card/gold-card/',
      },
      {
        cause: 'correction',
        card: 'chase-prime-visa',
        field: 'rules.amazon',
        summary: '5% at Audible.com with Prime.',
      },
      {
        cause: 'wording',
        card: 'chase-sapphire-preferred',
        field: 'rules.dining.note',
        summary: 'Reads "sit-down dining" in its note.',
      },
    ],
  },
  {
    version: '2026.11.10',
    date: '2026-11-10',
    changes: [
      {
        cause: 'correction',
        cards: ['citi-custom-cash', 'amex-business-gold'],
        field: 'choices',
        summary: 'The bonus categories are marked automatic.',
      },
      {
        cause: 'correction',
        card: 'chase-prime-visa',
        field: 'rules.whole-foods.geography',
        was: 'worldwide',
        now: 'us_only',
        summary: '5% at Whole Foods applies in the U.S. only.',
      },
      {
        cause: 'issuer',
        card: 'chase-prime-visa',
        field: 'welcome_offer',
        was: { dollars: 150, spend: 0, months: 1 },
        now: { dollars: 200, spend: 0, months: 1 },
        source:
          'https://creditcards.chase.com/cash-back-credit-cards/amazon-prime-rewards',
      },
      {
        cause: 'issuer',
        card: 'amex-gold',
        field: 'welcome_offer',
        was: { points: 60000, spend: 6000, months: 6 },
        now: { points: 100000, spend: 8000, months: 6, varies: true },
        source:
          'https://www.americanexpress.com/us/credit-cards/card/gold-card/',
      },
    ],
  },
  {
    version: '2026.09.01',
    date: '2026-09-01',
    changes: [
      {
        cause: 'issuer',
        card: 'chase-sapphire-preferred',
        field: 'annual_fee',
        was: 95,
        now: 95,
        source:
          'https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred',
      },
    ],
  },
])
const catalog = { ...real, changes: releases }
const { shortName } = cardText(catalog)

const todo = (cards: unknown[], today = TODAY) =>
  checklist(
    catalog,
    WalletSchema.parse({ cards }),
    today,
    undefined,
    shortName,
  ).filter((i) => i.kind === 'change')

describe('changes on the to-do list', () => {
  test("an issuer's change to a held card shows its old and new terms and source", () => {
    const [item, ...rest] = todo([{ id: 'chase-sapphire-preferred' }])
    expect(rest).toEqual([])
    expect(item).toMatchObject({
      cardId: 'chase-sapphire-preferred',
      due: null,
      url: 'https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred',
    })
    expect(item?.text).toBe(
      "Chase Sapphire Preferred's rate at restaurants: 2x Chase Ultimate Rewards → 3x Chase Ultimate Rewards. Chase made this change, effective Nov 15, 2026; earnrate's answers already use the new terms. Source: https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred",
    )
  })

  test("a card that isn't held gets nothing", () => {
    expect(todo([{ id: 'citi-double-cash' }])).toEqual([])
  })

  test('a wording change gets nothing', () => {
    const refs = todo([{ id: 'chase-sapphire-preferred' }]).map((i) => i.ref)
    expect(refs).toEqual(['2026.11.20:rules.dining'])
  })

  test('a change older than 60 days drops off', () => {
    expect(
      todo([{ id: 'chase-sapphire-preferred' }]).some((i) =>
        i.ref?.startsWith('2026.09.01'),
      ),
    ).toBe(false)
    expect(
      todo([{ id: 'chase-sapphire-preferred' }], '2026-10-31').map(
        (i) => i.ref,
      ),
    ).toEqual(['2026.09.01:annual_fee'])
    expect(todo([{ id: 'amex-gold' }], '2027-01-19')).toHaveLength(1)
    expect(todo([{ id: 'amex-gold' }], '2027-01-20')).toEqual([])
  })

  test('the 60 days count from when the change was detected, if known', () => {
    const sapphire = (today: string) =>
      todo([{ id: 'chase-sapphire-preferred' }], today).length
    expect(sapphire('2027-01-17')).toBe(1)
    expect(sapphire('2027-01-18')).toBe(0)
  })

  test('a change released after the day asked about is not shown yet', () => {
    const goldBonus = { id: 'amex-gold', bonus: { opened: '2026-11-01' } }
    expect(todo([goldBonus], '2026-11-19').map((i) => i.ref)).toEqual([
      '2026.11.10:welcome_offer',
    ])
    expect(todo([{ id: 'chase-sapphire-preferred' }], '2026-11-19')).toEqual([])
    expect(todo([{ id: 'chase-prime-visa' }], '2026-11-19')).toMatchObject([
      { ref: '2026.11.10:rules.whole-foods.geography' },
    ])
  })

  test("a correction says the mistake was earnrate's, naming only the held card and its issuer", () => {
    const [fix, ...rest] = todo([{ id: 'citi-custom-cash' }])
    expect(rest).toEqual([])
    expect(fix?.text).toBe(
      "earnrate fixed its own mistake about Citi Custom Cash (Citi didn't change anything): The bonus categories are marked automatic. Answers before Nov 10, 2026 used the old value.",
    )
    expect(fix?.url).toBeUndefined()
  })

  test("a card's corrections are one item, linking to its page's recent changes", () => {
    const fixes = todo([{ id: 'chase-prime-visa' }])
    expect(fixes).toEqual([
      {
        kind: 'change',
        cardId: 'chase-prime-visa',
        ref: 'corrections',
        text: "earnrate fixed 2 of its own mistakes about Prime Visa (Chase didn't change anything); answers already use the fixed terms. See what changed: https://earnrate.dev/cards/chase-prime-visa#recent-changes",
        url: 'https://earnrate.dev/cards/chase-prime-visa#recent-changes',
        due: null,
      },
    ])
  })

  test('newest first, after the time-sensitive items', () => {
    const items = checklist(
      catalog,
      WalletSchema.parse({
        cards: [
          { id: 'chase-prime-visa' },
          { id: 'amex-gold' },
          { id: 'chase-freedom-flex' },
        ],
      }),
      TODAY,
      undefined,
      shortName,
    )
    const firstChange = items.findIndex((i) => i.kind === 'change')
    expect(firstChange).toBeGreaterThan(0)
    expect(items.slice(firstChange).every((i) => i.kind === 'change')).toBe(
      true,
    )
    expect(items.slice(firstChange).map((i) => i.ref)).toEqual([
      '2026.11.20:annual_fee',
      'corrections',
    ])
  })

  test('a welcome offer change shows only for an open bonus tracked from the old offer', () => {
    const offer = (cards: unknown[]) =>
      todo(cards).find((i) => i.ref === '2026.11.10:welcome_offer')?.text
    expect(offer([{ id: 'chase-prime-visa' }])).toBeUndefined()
    expect(offer([{ id: 'amex-gold' }])).toBeUndefined()
    const gold = (bonus: object) => offer([{ id: 'amex-gold', bonus }])
    expect(gold({ opened: '2026-11-01', spent: 0 })).toBe(
      "Amex Gold's welcome offer: 60,000 Amex Membership Rewards after $6,000 in purchases within 6 months → up to 100,000 Amex Membership Rewards after $8,000 in purchases within 6 months. American Express changed it for new applicants; earnrate now tracks your welcome bonus at the new terms, so set yours if you got the old offer. Source: https://www.americanexpress.com/us/credit-cards/card/gold-card/",
    )
    expect(gold({ opened: '2026-11-01', spent: 9000 })).toBeUndefined()
    expect(
      gold({ opened: '2026-11-01', spent: 0, spend: 6000 }),
    ).toBeUndefined()
    expect(gold({ opened: '2026-11-15', spent: 0 })).toBeUndefined()
  })
})

test('corrections to several held cards share one line', () => {
  const wallet = WalletSchema.parse({
    cards: [{ id: 'chase-prime-visa' }, { id: 'amex-gold' }],
  })
  const fixes = checklist(real, wallet, real.changes?.[0]?.date ?? TODAY)
    .filter((i) => i.kind === 'change')
    .filter((i) => i.text.startsWith('earnrate fixed '))
  expect(fixes.map((i) => i.text)).toEqual([
    "earnrate fixed some of its own mistakes about Prime Visa and American Express Gold Card (their issuers didn't change anything); answers already use the fixed terms. Each card's page lists them under Recent changes.",
  ])
})

test("today's real record shows only issuer changes and corrections, for held cards", () => {
  const wallet = WalletSchema.parse({
    cards: (real.changes ?? [])
      .flatMap((r) => r.changes)
      .flatMap((c) => c.cards ?? [])
      .filter((id, i, all) => all.indexOf(id) === i)
      .map((id) => ({ id })),
  })
  const latest = real.changes?.[0]?.date ?? TODAY
  const items = checklist(real, wallet, latest).filter(
    (i) => i.kind === 'change',
  )
  expect(items.length).toBeGreaterThan(0)
  const fixed = items.filter((i) => i.text.startsWith('earnrate fixed '))
  expect(fixed).toHaveLength(1)
  expect(fixed[0]?.text).toMatch(/ more of your cards \(their issuers/)
  for (const i of items) {
    expect(wallet.cards.some((c) => c.id === i.cardId)).toBe(true)
    expect(i.ref).not.toMatch(/:welcome_offer$/)
    if (!fixed.includes(i))
      expect(i.text.endsWith(` Source: ${i.url ?? '-'}`)).toBe(true)
  }
})
