import { describe, expect, test } from 'vitest'
import { usedSoFarShown } from '../site/app/credit-enroll.ts'
import { heldToInput } from '../site/app/sync.ts'
import { catalogProblems } from '../src/data/integrity.ts'
import { loadCatalog } from '../src/data/load.ts'
import { checklist, checklistRows } from '../src/engine/checklist.ts'
import { creditStates, usedCreditsYear } from '../src/engine/credits.ts'
import { bookPurchase } from '../src/engine/record.ts'
import { recommend } from '../src/engine/recommend.ts'
import { updateInWallet } from '../src/engine/wallet-change.ts'
import { walletSummary } from '../src/engine/wallet-summary.ts'
import { CardSchema, type Card } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { WalletSchema, type Wallet } from '../src/schema/wallet.ts'

const catalog = await loadCatalog()
const TODAY = '2026-11-13'

const cardOf = (c: Catalog, id: string): Card => {
  const card = c.cards.find((x) => x.id === id)
  if (!card) throw new Error(`no ${id}`)
  return card
}
const bcp = (fields: object = {}): Wallet =>
  WalletSchema.parse({
    cards: [{ id: 'amex-blue-cash-preferred', ...fields }],
  })
const heldOf = (w: Wallet) => {
  const [held] = w.cards
  if (!held) throw new Error('no card')
  return held
}
const stateOf = (w: Wallet, cardId: string, creditId: string, date = TODAY) => {
  const held = w.cards.find((c) => c.id === cardId)
  if (!held) throw new Error(`no ${cardId}`)
  const s = creditStates(catalog, cardOf(catalog, cardId), held, date).find(
    (x) => x.credit.id === creditId,
  )
  if (!s) throw new Error(`no ${creditId}`)
  return s
}

// A wallet saved before the flag, with use of the credit recorded.
const marked = bcp({
  enrolled: ['disney-streaming'],
  credit_usage: { 'disney-streaming': { period: '2026-11', used: 4 } },
})

describe('a credit that pays a subscription billed to the card', () => {
  test('is flagged in the data', () => {
    const credit = cardOf(catalog, 'amex-blue-cash-preferred').credits.find(
      (c) => c.id === 'disney-streaming',
    )
    expect(credit?.subscription).toBe(true)
  })

  test('once marked, counts its full amount every period with no use given', () => {
    const s = stateOf(
      bcp({ enrolled: ['disney-streaming'] }),
      'amex-blue-cash-preferred',
      'disney-streaming',
    )
    expect(s).toMatchObject({ confirmed: true, used: 0, left: 10 })
    const year = usedCreditsYear(
      catalog,
      cardOf(catalog, 'amex-blue-cash-preferred'),
      heldOf(bcp({ enrolled: ['disney-streaming'] })),
      TODAY,
      {},
    )
    expect(year.yearly).toBe(120)
  })

  test('use saved before the flag is ignored, and the wallet keeps it', () => {
    const s = stateOf(marked, 'amex-blue-cash-preferred', 'disney-streaming')
    expect(s).toMatchObject({ used: 0, left: 10 })
    expect(heldOf(marked).credit_usage).toEqual({
      'disney-streaming': { period: '2026-11', used: 4 },
    })
  })

  test("a month that pays more pays that month's amount", () => {
    const card = cardOf(catalog, 'amex-blue-cash-preferred')
    const withDecember: Catalog = {
      ...catalog,
      cards: catalog.cards.map((c) =>
        c.id === card.id
          ? {
              ...c,
              credits: c.credits.map((x) =>
                x.id === 'disney-streaming'
                  ? { ...x, month_amounts: { '12': 15 } }
                  : x,
              ),
            }
          : c,
      ),
    }
    const [s] = creditStates(
      withDecember,
      cardOf(withDecember, card.id),
      heldOf(marked),
      '2026-12-10',
    )
    expect(s).toMatchObject({ periodAmount: 15, left: 15, used: 0 })
  })

  test('the to-do asks to enroll, then has nothing more for it', () => {
    const before = checklistRows(catalog, bcp(), TODAY).filter(
      (i) => i.ref === 'disney-streaming',
    )
    expect(before.map((i) => [i.kind, i.text])).toEqual([
      [
        'enroll',
        expect.stringMatching(
          /^Enroll in .*Disney\+, Hulu and ESPN credit with the issuer, then mark it enrolled\.$/,
        ),
      ],
    ])
    const after = checklist(catalog, marked, TODAY)
    expect(after.filter((i) => i.ref === 'disney-streaming')).toEqual([])
    expect(after.map((i) => i.text).join(' ')).not.toMatch(/Disney/)
  })

  test("list_wallet's line says it's counted in full, with nothing left to use", () => {
    const [card] = walletSummary(catalog, marked, TODAY).cards
    const line = card?.credits.find((c) => c.id === 'disney-streaming')
    expect(line).toMatchObject({ subscription: true, tracked: false })
    expect(line?.text).toBe(
      '$10 back each month at Disney+, Hulu and ESPN: counted in full each month while the subscription is billed to the card.',
    )
  })

  test('a purchase there leaves the wallet as it was', () => {
    const booked = bookPurchase(catalog, marked, {
      cardId: 'amex-blue-cash-preferred',
      merchant: 'Disney+',
      amount: 10.99,
      channel: null,
      date: TODAY,
    })
    expect(booked.credit).toBeNull()
    expect(booked.wallet).toEqual(marked)
  })

  test('purchase answers at its store behave as before', () => {
    const rec = recommend(catalog, marked, {
      merchant: 'Disney+',
      amount: 10.99,
      channel: null,
      date: TODAY,
      country: 'US',
    })
    expect(
      rec.ranked.find((r) => r.cardId === 'amex-blue-cash-preferred')?.credit,
    ).toMatchObject({ dollars: 10 })
  })

  test('Settings has no Used so far box for it', () => {
    expect(
      usedSoFarShown(
        stateOf(marked, 'amex-blue-cash-preferred', 'disney-streaming'),
      ),
    ).toBe(false)
  })

  test('a typed use is ignored, not refused', () => {
    const changed = updateInWallet(
      catalog,
      marked,
      {
        id: 'amex-blue-cash-preferred',
        creditUsed: { 'disney-streaming': 6 },
      },
      TODAY,
    )
    if (!changed.ok) throw new Error(changed.error)
    expect(heldOf(changed.wallet).credit_usage).toEqual(
      heldOf(marked).credit_usage,
    )
  })

  test('sync sends no use for it', () => {
    const input = heldToInput(catalog, heldOf(marked), TODAY)
    expect(input.creditUsed).toBeUndefined()
  })

  test('only a credit a purchase can use is flagged', () => {
    const card = CardSchema.parse({
      id: 'test-card',
      name: 'Test Card',
      issuer: 'amex',
      network: 'amex',
      currency: 'MR',
      last_verified: '2026-11-11',
      verified_by: 'claude',
      source_urls: ['https://example.com/'],
      base_rate: 1,
      foreign_transaction_fee: 0,
      credits: [
        {
          id: 'airline-fee',
          listed: { name: 'airline fee', on: 'fees at one airline' },
          amount: 200,
          period: 'calendar_year',
          subscription: true,
        },
      ],
      evidence: [
        {
          rule: 'base_rate',
          url: 'https://example.com/',
          quote: '1X on everything',
        },
        {
          rule: 'foreign_transaction_fee',
          url: 'https://example.com/',
          quote: 'No foreign transaction fees',
        },
        {
          rule: 'airline-fee',
          url: 'https://example.com/',
          quote: 'up to $200 in statement credits',
        },
      ],
    })
    expect(catalogProblems({ ...catalog, cards: [card] }).join('\n')).toMatch(
      /airline-fee: subscription on a credit no purchase uses/,
    )
  })
})

describe('a credit spent somewhere', () => {
  const gold = WalletSchema.parse({
    cards: [
      {
        id: 'amex-gold',
        enrolled: ['dunkin'],
        credit_usage: { dunkin: { period: '2026-11', used: 3 } },
      },
    ],
  })

  test('still tracks what is left and reminds', () => {
    expect(stateOf(gold, 'amex-gold', 'dunkin')).toMatchObject({
      used: 3,
      left: 4,
    })
    expect(
      checklist(catalog, gold, TODAY).find((i) => i.ref === 'dunkin')?.text,
    ).toMatch(/^Use your \$7 Dunkin' credit on .* by Nov 30, 2026: \$4 left\.$/)
    expect(usedSoFarShown(stateOf(gold, 'amex-gold', 'dunkin'))).toBe(true)
  })

  test('a purchase there still uses it', () => {
    const booked = bookPurchase(catalog, gold, {
      cardId: 'amex-gold',
      merchant: "Dunkin'",
      amount: 6,
      channel: 'in_store',
      date: TODAY,
    })
    expect(booked.credit).toMatchObject({ before: 3, after: 7 })
  })
})
