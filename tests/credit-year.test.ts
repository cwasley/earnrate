import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { FileWalletStore } from '../src/data/file-store.ts'
import { loadCatalog } from '../src/data/load.ts'
import {
  allCreditsYear,
  creditAt,
  creditPerYear,
  creditStates,
  usedCreditsYear,
} from '../src/engine/credits.ts'
import { checklist } from '../src/engine/checklist.ts'
import { cardInfo } from '../src/engine/setup.ts'
import { ALL_PERSONAL_CARDS } from '../src/engine/explore.ts'
import { effectiveMemberships } from '../src/engine/memberships.ts'
import { recommend } from '../src/engine/recommend.ts'
import {
  resolveSpendLines,
  simulateCatalog,
  simulateWallet,
  spendLineFor,
} from '../src/engine/simulate.ts'
import { creditsYearText } from '../src/engine/text.ts'
import { addToWallet, updateInWallet } from '../src/engine/wallet-change.ts'
import type { Card } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { WalletSchema, type WalletCard } from '../src/schema/wallet.ts'
import { feeWorthKit } from '../src/engine/fee-worth.ts'
import { heldToInput } from '../site/app/sync.ts'

const catalog = await loadCatalog()
const TODAY = '2026-10-24'

const cardOf = (c: Catalog, id: string): Card => {
  const card = c.cards.find((x) => x.id === id)
  if (!card) throw new Error(`no ${id}`)
  return card
}
function held(fields: object): WalletCard {
  const [card] = WalletSchema.parse({
    cards: [{ id: 'amex-gold', ...fields }],
  }).cards
  if (!card) throw new Error('no card')
  return card
}

describe('a credit over a year', () => {
  test('is its amount times the periods in a year', () => {
    expect(creditPerYear({ amount: 7, period: 'month' })).toBe(84)
    expect(creditPerYear({ amount: 50, period: 'quarter' })).toBe(200)
    expect(creditPerYear({ amount: 50, period: 'half_year' })).toBe(100)
    expect(creditPerYear({ amount: 300, period: 'calendar_year' })).toBe(300)
    expect(creditPerYear({ amount: 300, period: 'cardmember_year' })).toBe(300)
  })

  test("a card's credits add up, each named by its first store", () => {
    const year = allCreditsYear(
      catalog,
      cardOf(catalog, 'amex-gold'),
      TODAY,
      {},
    )
    expect(year.yearly).toBe(424)
    expect(year.names).toEqual(["Dunkin'", 'Uber', 'Grubhub', 'Resy'])
    expect(creditsYearText(year)).toBe(
      "$424 a year: Dunkin', Uber, Grubhub and Resy",
    )
  })

  test('a held card counts credits said in use, but none marked unused', () => {
    const gold = cardOf(catalog, 'amex-gold')
    expect(
      usedCreditsYear(catalog, gold, held({}), TODAY, {}).creditIds,
    ).toEqual([])
    expect(
      usedCreditsYear(catalog, gold, held({ enrolled: ['dunkin'] }), TODAY, {})
        .yearly,
    ).toBe(84)
    expect(
      usedCreditsYear(
        catalog,
        gold,
        held({ enrolled: ['dunkin', 'uber-cash'] }),
        TODAY,
        {},
      ).yearly,
    ).toBe(204)
    expect(
      usedCreditsYear(
        catalog,
        gold,
        held({
          credit_usage: { 'uber-cash': { period: '2026-11', used: 10 } },
        }),
        TODAY,
        {},
      ).creditIds,
    ).toEqual(['uber-cash'])
    expect(
      usedCreditsYear(
        catalog,
        gold,
        held({
          enrolled: ['dunkin', 'resy'],
          skipped_credits: ['dunkin', 'uber-cash'],
        }),
        TODAY,
        {},
      ),
    ).toMatchObject({ yearly: 100, creditIds: ['resy'] })
  })
})

describe('a credit that ends on a date', () => {
  const ending = (credits: Card['credits']): Card => ({
    ...cardOf(catalog, 'amex-gold'),
    credits,
  })
  const lyft = { id: 'lyft', match: { merchants: ['lyft'] }, amount: 10 }

  test("a year counts only the periods that start by the credit's last day", () => {
    const card = ending([
      { ...lyft, period: 'month', valid_to: '2027-09-30' },
      {
        id: 'stubhub',
        match: { merchants: ['stubhub'] },
        amount: 150,
        period: 'half_year',
        valid_to: '2027-12-31',
      },
    ])
    expect(allCreditsYear(catalog, card, '2026-11-07', {}).yearly).toBe(
      110 + 300,
    )
    expect(allCreditsYear(catalog, card, '2027-08-15', {}).yearly).toBe(
      20 + 150,
    )
    expect(allCreditsYear(catalog, card, '2027-10-01', {})).toMatchObject({
      yearly: 150,
      creditIds: ['stubhub'],
    })
  })

  test('is gone from the wallet and the answers after it ends', () => {
    const card = ending([{ ...lyft, period: 'month', valid_to: '2027-09-30' }])
    const holding = held({ enrolled: ['lyft'] })
    expect(creditStates(catalog, card, holding, '2027-09-30')).toHaveLength(1)
    expect(creditStates(catalog, card, holding, '2027-10-01')).toEqual([])
    const lyftRide = {
      merchantId: 'lyft',
      category: 'transit.rideshare',
      source: 'seed' as const,
    }
    expect(creditAt(catalog, card, holding, lyftRide, '2027-09-30')).not.toBe(
      null,
    )
    expect(creditAt(catalog, card, holding, lyftRide, '2027-10-01')).toBe(null)
  })

  test("says when it ends wherever the card's credits are listed", () => {
    const reserve = cardInfo(
      catalog,
      cardOf(catalog, 'chase-sapphire-reserve'),
      null,
      TODAY,
    )
    expect(reserve.credits.find((c) => c.id === 'lyft-credit')?.text).toBe(
      '$10 back each month at Lyft through Sep 30, 2027',
    )
  })
})

describe('marking a credit unused', () => {
  test('replaces the list, and refuses a credit the card does not have', () => {
    const added = addToWallet(
      catalog,
      null,
      { id: 'amex-gold', skippedCredits: ['dunkin', 'dunkin'] },
      TODAY,
    )
    if (!added.ok) throw new Error(added.error)
    expect(added.wallet.cards[0]?.skipped_credits).toEqual(['dunkin'])
    const cleared = updateInWallet(
      catalog,
      added.wallet,
      { id: 'amex-gold', skippedCredits: [] },
      TODAY,
    )
    if (!cleared.ok) throw new Error(cleared.error)
    expect(cleared.wallet.cards[0]?.skipped_credits).toEqual([])
    const wrong = updateInWallet(
      catalog,
      added.wallet,
      { id: 'amex-gold', skippedCredits: ['lululemon'] },
      TODAY,
    )
    expect(wrong.ok || wrong.error).toMatch(
      /amex-gold has no credit 'lululemon'\. Its credits are: dunkin, uber-cash, dining, resy\./,
    )
  })

  test('is spliced into the wallet file, keeping comments', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-skip-'))
    const file = path.join(dir, 'wallet.yaml')
    await writeFile(file, 'cards:\n  - id: amex-gold # the metal one\n')
    const store = new FileWalletStore(catalog, file)
    const done = await store.updateCard(
      { id: 'amex-gold', skippedCredits: ['dunkin'] },
      TODAY,
    )
    if (!done.ok) throw new Error(done.error)
    expect(await readFile(file, 'utf8')).toBe(
      'cards:\n  - id: amex-gold # the metal one\n    skipped_credits: [dunkin]\n',
    )
  })

  test('syncing a card carries the list', () => {
    expect(
      heldToInput(catalog, held({ skipped_credits: ['dunkin'] }), TODAY),
    ).toMatchObject({ id: 'amex-gold', skippedCredits: ['dunkin'] })
  })

  test("Dunkin' no longer counts toward the pick at Dunkin'", () => {
    const at = (fields: object) =>
      recommend(
        catalog,
        WalletSchema.parse({
          cards: [{ id: 'amex-gold', ...fields }, { id: 'citi-double-cash' }],
        }),
        {
          merchant: "Dunkin'",
          amount: 5,
          channel: 'in_store',
          date: TODAY,
          country: 'US',
          payment: null,
        },
      ).ranked.find((r) => r.cardId === 'amex-gold')?.credit
    expect(at({ enrolled: ['dunkin'] })).toMatchObject({ dollars: 5 })
    expect(at({ enrolled: ['dunkin'], skipped_credits: ['dunkin'] })).toBeNull()
  })
})

describe('memberships a card implies', () => {
  test("a held card's required membership counts as held", () => {
    expect(
      effectiveMemberships(catalog, [], ['citi-costco-anywhere-visa']),
    ).toEqual(['costco'])
    expect(effectiveMemberships(catalog, ['amazon-prime'], [])).toEqual([
      'amazon-prime',
    ])
  })

  test("Prime Visa doesn't imply Prime: Chase prices it at 3% without", () => {
    const rec = recommend(
      catalog,
      WalletSchema.parse({ cards: [{ id: 'chase-prime-visa' }] }),
      {
        merchant: 'Amazon',
        amount: null,
        channel: 'online',
        date: TODAY,
        country: 'US',
        payment: null,
      },
    )
    expect(rec.ranked[0]?.rate).toBe(3)
  })

  const requiring: Catalog = {
    ...catalog,
    cards: catalog.cards.map((c) =>
      c.id === 'chase-prime-visa'
        ? { ...c, requires_membership: 'amazon-prime' }
        : c,
    ),
    memberships: catalog.memberships.map((m) =>
      m.id === 'amazon-prime' ? { ...m, annual_fee: 139 } : m,
    ),
  }
  const amazon = resolveSpendLines(requiring, [
    spendLineFor(requiring, 'Amazon', 100),
  ])

  test('with Prime Visa needing Prime: held, its 5% applies with no memberships saved', () => {
    const rec = recommend(
      requiring,
      WalletSchema.parse({ cards: [{ id: 'chase-prime-visa' }] }),
      {
        merchant: 'Amazon',
        amount: null,
        channel: 'online',
        date: TODAY,
        country: 'US',
        payment: null,
      },
    )
    expect(rec.ranked[0]?.rate).toBe(5)
    const sim = simulateWallet(
      requiring,
      WalletSchema.parse({ cards: [{ id: 'chase-prime-visa' }] }),
      amazon,
      TODAY,
      ['chase-prime-visa'],
    )
    expect(sim.membershipFees).toBe(0)
    expect(sim.rewards).toBe(60)
  })

  test('with Prime Visa needing Prime: not held, Prime is still counted as a cost', () => {
    const { singles } = simulateCatalog(requiring, amazon, {
      filters: ALL_PERSONAL_CARDS,
      memberships: [],
      valuations: {},
      start: TODAY,
    })
    const prime = singles.find((s) => s.cards[0]?.cardId === 'chase-prime-visa')
    expect(prime?.membershipFees).toBe(139)
    expect(prime?.rewards).toBe(60)
  })
})

describe("the annual-fee page's second figure", { timeout: 30_000 }, () => {
  const { feeWorth } = feeWorthKit(catalog, TODAY)

  test('credits worth more than the fee put the card ahead from the start', () => {
    const gold = feeWorth(cardOf(catalog, 'amex-gold'))
    expect(gold?.credits?.yearly).toBe(424)
    expect(gold?.creditsBreakEven).toBe(0)
    expect(gold?.breakEven).toBeGreaterThan(0)
  })

  test('credits worth less than the fee leave a break-even, or none', () => {
    const ventureX = feeWorth(cardOf(catalog, 'capital-one-venture-x'))
    expect(ventureX?.credits?.yearly).toBe(300)
    expect(ventureX?.creditsBreakEven).toBeNull()
    const noCredits = feeWorth(cardOf(catalog, 'capital-one-venture'))
    expect(noCredits?.credits).toBeNull()
    expect(noCredits?.creditsBreakEven).toBeNull()
  })
})

describe('asking about credits that need no enrolling', () => {
  const asks = (fields: object) =>
    checklist(
      catalog,
      WalletSchema.parse({ cards: [{ id: 'amex-gold', ...fields }] }),
      TODAY,
    ).filter((i) => i.text.startsWith('Do you use'))

  test('asks once, until the credit is marked used or not used', () => {
    expect(asks({}).map((i) => i.text)).toEqual([
      "Do you use American Express Gold Card's Uber credit? Say you use it and it counts against the annual fee.",
    ])
    expect(asks({ enrolled: ['uber-cash'] })).toEqual([])
    expect(asks({ skipped_credits: ['uber-cash'] })).toEqual([])
    expect(
      asks({ credit_usage: { 'uber-cash': { period: '2026-10', used: 10 } } }),
    ).toEqual([])
  })
})
