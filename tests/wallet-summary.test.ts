import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { walletSummary } from '../src/engine/wallet-summary.ts'
import { formatWalletSummary } from '../src/format/wallet.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const catalog = await loadCatalog()

test('picks that carry over have no end date', () => {
  const wallet = WalletSchema.parse({
    cards: [
      {
        id: 'bank-of-america-customized-cash-rewards',
        chosen: {
          period: '2026',
          picks: { 'three-percent': ['online-shopping'] },
        },
      },
    ],
  })
  const later = walletSummary(catalog, wallet, '2027-03-01')
  expect(later.cards[0]?.chosen).toMatchObject({ current: true, until: null })
  expect(formatWalletSummary(later)).toMatch(
    /Picks: 3%: online shopping\. They stay until the user changes them\./,
  )
})

test('every bonus rate is listed, and an activated quarter says so', () => {
  const wallet = WalletSchema.parse({
    cards: [{ id: 'chase-freedom-flex', activated: ['q4-2026-grocery'] }],
  })
  const [flex] = walletSummary(catalog, wallet, '2026-11-01').cards
  const rates = flex?.rates.join('; ') ?? ''
  expect(rates).toMatch(
    /3% cash back at restaurants, drugstores and pharmacies/,
  )
  expect(rates).not.toMatch(/once activated/)
  expect(flex?.toActivate).toEqual([])
})

test('a capped rate says how much spending earns it', () => {
  const wallet = WalletSchema.parse({
    cards: [{ id: 'chase-freedom-flex', activated: ['q4-2026-dining'] }],
  })
  const [flex] = walletSummary(catalog, wallet, '2026-11-01').cards
  expect(flex?.rates).toContain(
    '7% cash back at restaurants (first $1,500 a quarter, combined)',
  )
})

test('long lists of one kind of store read as a group', () => {
  const wallet = WalletSchema.parse({
    cards: [{ id: 'chase-sapphire-preferred' }],
  })
  const [csp] = walletSummary(catalog, wallet, '2026-11-01').cards
  expect(csp?.rates.join('; ')).toMatch(/select streaming services/)
  expect(csp?.rates.join('; ')).not.toMatch(/Netflix/)
})

test('a quarter not yet activated gives its dates in words', () => {
  const wallet = WalletSchema.parse({ cards: [{ id: 'chase-freedom-flex' }] })
  const [flex] = walletSummary(catalog, wallet, '2026-11-01').cards
  expect(flex?.toActivate.join('; ')).toMatch(
    /\(Oct 1, 2026 to Dec 31, 2026, activate by Dec 14, 2026\)/,
  )
})

test('a lower tier a held membership replaces is left out', () => {
  const wallet = WalletSchema.parse({
    memberships: ['amazon-prime'],
    cards: [{ id: 'chase-prime-visa' }],
  })
  const [prime] = walletSummary(catalog, wallet, '2026-11-01').cards
  const rates = prime?.rates.join('; ') ?? ''
  expect(rates).toMatch(/^5% cash back at Amazon, /)
  expect(rates).not.toMatch(/3% cash back/)
})

test('rates share a line, travel bookings read in lower case', () => {
  const wallet = WalletSchema.parse({
    cards: [{ id: 'amex-gold' }, { id: 'sofi-unlimited-2' }],
  })
  const summary = walletSummary(catalog, wallet, '2026-11-01')
  expect(summary.cards[0]?.rates).toContain(
    '3x Amex Membership Rewards on flights booked directly or through Amex Travel',
  )
  expect(formatWalletSummary(summary)).toMatch(
    /\(sofi-unlimited-2\): Mastercard, SoFi Member Rewards at 1¢/,
  )
})

test('a BofA Rewards tier shows only its own rates', () => {
  const wallet = WalletSchema.parse({
    memberships: ['bofa-rewards-preferred-plus'],
    cards: [{ id: 'bank-of-america-customized-cash-rewards' }],
  })
  const [ccr] = walletSummary(catalog, wallet, '2026-11-01').cards
  expect(ccr?.rates).toEqual([
    '3.75% cash back on the category you pick (first $2,500 a quarter, combined)',
    '2.5% cash back at supermarkets and warehouse clubs (first $2,500 a quarter, combined)',
    '1.25% cash back on everything else',
  ])
})

test('spend milestones show their progress, or that they are not tracked', () => {
  const summary = walletSummary(
    catalog,
    WalletSchema.parse({
      cards: [
        {
          id: 'chase-ihg-one-rewards-premier',
          milestone_usage: { 'spend-15k': { period: '2026', spent: 11200 } },
        },
        { id: 'chase-ihg-one-rewards' },
      ],
    }),
    '2026-11-03',
  )
  const [premier, plain] = summary.cards
  expect(premier?.milestones.map((m) => m.text)).toEqual([
    '$11,200 of $15,000 this year for 15,000 bonus points, Platinum Elite status and 5 Elite Night Credits.',
    "$40,000 this year for Diamond Elite status; spending toward it isn't tracked yet.",
  ])
  expect(premier?.milestones[0]?.until).toBe('2026-12-31')
  expect(plain?.milestones[0]?.text).toBe(
    "$15,000 this year for 10,000 bonus points and Gold Elite status; spending toward it isn't tracked yet.",
  )
})

test('a cardmember-year cap ends the day before the anniversary, or asks for it', () => {
  const ink = (anniversary?: string) =>
    WalletSchema.parse({
      cards: [
        {
          id: 'chase-ink-business-cash',
          ...(anniversary === undefined ? {} : { anniversary }),
          cap_usage: {
            'five-percent-combined': { period: '2026', spent: 500 },
          },
        },
      ],
    })
  const known = walletSummary(catalog, ink('03-15'), '2026-11-01')
  expect(
    known.cards[0]?.caps.find((c) => c.key === 'five-percent-combined'),
  ).toMatchObject({ currentPeriod: '2026', until: '2027-03-14' })
  expect(formatWalletSummary(known)).toMatch(
    /\$500 of \$25,000 used this cardmember year, through Mar 14, 2027/,
  )
  const unknown = walletSummary(catalog, ink(), '2026-11-01')
  expect(unknown.cards[0]?.caps[0]).toMatchObject({
    currentPeriod: null,
    until: null,
  })
  expect(formatWalletSummary(unknown)).toMatch(
    /a cardmember year; give the card's anniversary to track it/,
  )
})

test('rates a membership unlocks are named, with only the top tier of a group', () => {
  const rates = (id: string, memberships: string[] = []) =>
    walletSummary(
      catalog,
      WalletSchema.parse({ memberships, cards: [{ id }] }),
      '2026-11-10',
    ).cards[0]?.rates ?? []
  expect(rates('td-bank-nordstrom-visa')).toContain(
    '2x Nordy Club points at Nordstrom with Nordy Club Ambassador or Icon status',
  )
  expect(
    rates('td-bank-nordstrom-visa', ['nordy-club-ambassador']),
  ).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/ with Nordy Club/)]),
  )
  const ccr = rates('bank-of-america-customized-cash-rewards')
  expect(ccr.filter((r) => r.includes(' with BofA'))).toEqual([
    '5.25% cash back on the category you pick with BofA Rewards Premier (first $2,500 a quarter, combined)',
    '3.5% cash back at supermarkets and warehouse clubs with BofA Rewards Premier (first $2,500 a quarter, combined)',
    '1.75% cash back on everything else with BofA Rewards Premier',
  ])
})
