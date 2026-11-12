import { describe, expect, test } from 'vitest'
import { catalogProblems } from '../src/data/integrity.ts'
import { loadCatalog } from '../src/data/load.ts'
import { checklist } from '../src/engine/checklist.ts'
import {
  allCreditsYear,
  creditAt,
  unsaidCreditsYear,
  usedCreditsYear,
} from '../src/engine/credits.ts'
import { ALL_PERSONAL_CARDS, exploreCards } from '../src/engine/explore.ts'
import { bookPurchase } from '../src/engine/record.ts'
import { recommend } from '../src/engine/recommend.ts'
import { creditLabel, creditWhere } from '../src/engine/rule-text.ts'
import { walletSummary } from '../src/engine/wallet-summary.ts'
import { updateInWallet } from '../src/engine/wallet-change.ts'
import { CardSchema, type Card } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const catalog = await loadCatalog()
const TODAY = '2026-11-11'

const platinum = (): Card => {
  const card = catalog.cards.find((c) => c.id === 'amex-platinum')
  if (!card) throw new Error('no amex-platinum')
  return card
}
const credit = (id: string) => {
  const c = platinum().credits.find((x) => x.id === id)
  if (!c) throw new Error(`no ${id}`)
  return c
}
const wallet = (fields: object = {}) =>
  WalletSchema.parse({
    cards: [{ id: 'amex-platinum', ...fields }, { id: 'citi-double-cash' }],
  })
const heldPlatinum = (fields: object = {}) => {
  const [held] = wallet(fields).cards
  if (!held) throw new Error('no card')
  return held
}

describe('a listed credit', () => {
  test('is named and placed in its own words', () => {
    expect(creditLabel(catalog, credit('airline-fee'))).toBe('airline fee')
    expect(creditWhere(catalog, credit('hotel'))).toBe(
      'on prepaid Fine Hotels + Resorts, The Hotel Collection and Airbnb Luxe bookings through Amex Travel',
    )
  })

  test("counts in a card's year as if used, and against a held card's fee only once the cardholder says they use it", () => {
    const all = allCreditsYear(catalog, platinum(), TODAY, {})
    expect(all.creditIds).toEqual(
      expect.arrayContaining(['airline-fee', 'hotel']),
    )
    const card = platinum()
    const none = usedCreditsYear(catalog, card, heldPlatinum(), TODAY, {})
    expect(none.creditIds).not.toContain('airline-fee')
    expect(none.creditIds).not.toContain('hotel')
    const unsaid = unsaidCreditsYear(catalog, card, heldPlatinum(), TODAY, {})
    expect(unsaid.creditIds).toEqual(
      expect.arrayContaining(['airline-fee', 'hotel']),
    )
    const used = usedCreditsYear(
      catalog,
      card,
      heldPlatinum({ enrolled: ['airline-fee', 'hotel'] }),
      TODAY,
      {},
    )
    expect(used).toMatchObject({
      yearly: 800,
      creditIds: ['airline-fee', 'hotel'],
    })
    const skipped = usedCreditsYear(
      catalog,
      card,
      heldPlatinum({
        enrolled: ['airline-fee'],
        skipped_credits: ['airline-fee'],
      }),
      TODAY,
      {},
    )
    expect(skipped.creditIds).toEqual([])
  })

  test('never pays on a purchase, enrolled or not', () => {
    const enrolled = wallet({ enrolled: ['airline-fee', 'hotel'] })
    const delta = {
      merchantId: 'delta',
      category: 'travel.flights',
      source: 'seed' as const,
    }
    const [held] = enrolled.cards
    if (!held) throw new Error('no card')
    expect(creditAt(catalog, platinum(), held, delta, TODAY)).toBeNull()
    for (const merchant of ['Delta', 'Amex Travel'] as const) {
      const answer = recommend(catalog, enrolled, {
        merchant,
        amount: 50,
        channel: 'online',
        date: TODAY,
        country: 'US',
        payment: null,
      })
      const ranked = answer.ranked.find((r) => r.cardId === 'amex-platinum')
      expect(ranked?.credit ?? null, merchant).toBeNull()
    }
    const booked = bookPurchase(catalog, enrolled, {
      cardId: 'amex-platinum',
      merchant: 'Delta',
      amount: 50,
      date: TODAY,
      channel: 'online',
    })
    expect(booked.credit).toBeNull()
    expect(booked.wallet.cards[0]?.credit_usage).toBeUndefined()
    const every = exploreCards(
      catalog,
      {
        merchant: 'Delta',
        category: null,
        amount: 50,
        channel: 'online',
        date: TODAY,
      },
      { filters: ALL_PERSONAL_CARDS, memberships: [], valuations: {} },
    )
    expect(every.credits.map((c) => c.creditId)).not.toContain('airline-fee')
  })

  test('is used only as marked, and the to-do says what is left until it resets', () => {
    const marked = updateInWallet(
      catalog,
      wallet({ enrolled: ['airline-fee'] }),
      { id: 'amex-platinum', creditUsed: { 'airline-fee': 50 } },
      TODAY,
    )
    if (!('wallet' in marked)) throw new Error(JSON.stringify(marked))
    const items = checklist(catalog, marked.wallet, TODAY)
    expect(
      items.find((i) => i.kind === 'credit' && i.ref === 'airline-fee'),
    ).toMatchObject({
      due: '2026-12-31',
      text: 'Use your $200 airline fee credit on The Platinum Card from American Express by Dec 31, 2026: $150 left.',
    })
    const summary = walletSummary(catalog, marked.wallet, TODAY)
    expect(
      summary.cards[0]?.credits.find((c) => c.id === 'airline-fee'),
    ).toMatchObject({
      listed: true,
      left: 150,
      text: "$200 back each calendar year on incidental fees charged by the one airline you select: $150 left this year, through Dec 31, 2026; earnrate can't tell which purchases it pays on, so mark what you've used.",
    })
    expect(
      summary.cards[0]?.credits.find((c) => c.id === 'lululemon')?.listed,
    ).toBe(false)
  })
})

describe('integrity of a listed credit', () => {
  const base = {
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
  }
  const evidence = [
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
  ]
  const listed = {
    id: 'airline-fee',
    listed: { name: 'airline fee', on: 'fees at one airline you select' },
    amount: 200,
    period: 'calendar_year',
  }
  const problems = (c: object, quotes: object[]) => {
    const card = CardSchema.parse({
      ...base,
      credits: [c],
      evidence: [...evidence, ...quotes],
    })
    const withCard: Catalog = {
      ...catalog,
      cards: [card],
      merchants: {
        seed: catalog.merchants.seed.filter((m) => m.id === 'delta'),
        overrides: [],
      },
    }
    return catalogProblems(withCard).filter((p) => p.includes('test-card'))
  }
  const amountQuote = {
    rule: 'airline-fee',
    url: 'https://example.com/',
    quote: 'up to $200 in statement credits per calendar year',
  }

  test('passes with a quote that states its amount', () => {
    expect(problems(listed, [amountQuote])).toEqual([])
  })

  test('refuses one without evidence, or whose quotes never state its amount', () => {
    expect(problems(listed, []).join(' ')).toMatch(
      /airline-fee: no evidence quote states its amount/,
    )
    expect(
      problems(listed, [{ ...amountQuote, quote: 'incidental airline fees' }]),
    ).toEqual([expect.stringMatching(/no evidence quote states its amount/)])
  })

  test('refuses one that also matches merchants, and a credit with neither', () => {
    expect(
      problems({ ...listed, match: { merchants: ['delta'] } }, [amountQuote]),
    ).toEqual([expect.stringMatching(/a credit has match or listed, not both/)])
    const { listed: _, ...bare } = listed
    expect(problems(bare, [amountQuote])).toEqual([
      expect.stringMatching(/a credit has match or listed, not both/),
    ])
  })

  test('refuses a minimum purchase on it', () => {
    expect(problems({ ...listed, min_amount: 50 }, [amountQuote])).toEqual([
      expect.stringMatching(/min_amount on a credit no purchase uses/),
    ])
  })
})
