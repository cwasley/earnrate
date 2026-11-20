import { beforeAll, describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { recommend } from '../src/engine/recommend.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { WalletSchema } from '../src/schema/wallet.ts'
import {
  addCard,
  answer,
  cardPage,
  cards,
  home,
  removeCard,
  suggest,
  useCatalog,
  walletCards,
} from '../ios/engine/entry.ts'

const today = '2026-11-19'
const held = {
  cards: [
    { id: 'amex-gold' },
    { id: 'chase-sapphire-preferred' },
    { id: 'citi-double-cash' },
  ],
}

let catalog: Catalog

beforeAll(async () => {
  catalog = await loadCatalog()
  useCatalog(catalog)
})

describe('the iPhone app bridge', () => {
  test('the store tab starts with the everyday purchases', () => {
    expect(home().quick).toContain('Groceries')
    expect(home().quick).toContain('Costco')
  })

  test('suggestions name stores and kinds of places, names first', () => {
    const found = suggest({ query: 'whole' }).suggestions
    expect(found[0]).toEqual({ text: 'Whole Foods Market', kind: 'store' })
    expect(suggest({ query: 'gas' }).suggestions).toContainEqual({
      text: 'Gas stations',
      kind: 'place',
    })
    expect(suggest({ query: '  ' }).suggestions).toEqual([])
    expect(suggest({ query: 'e', limit: 3 }).suggestions).toHaveLength(3)
  })

  test('with no cards saved, an answer ranks every card and says so', () => {
    const a = answer({ query: 'Whole Foods', today })
    expect(a.scope).toBe('every')
    expect(a.canChooseScope).toBe(false)
    expect(a.scopeNote).toMatch(/every personal card/)
    expect(a.title).toBe('Best cards for Whole Foods Market')
    expect(a.subtitle).toBe('Counts as a supermarket')
    expect(a.pick?.cardId).toBe(a.rows[0]?.card.id)
    expect(a.pick?.label).toBe('Best card')
    expect(a.rows).toHaveLength(8)
    expect(a.more).toBeGreaterThan(0)
    expect(a.moreLabel).toMatch(/^Show all \d+ cards$/)
    expect(a.footer.some((l) => l.startsWith('Usual merchant code'))).toBe(
      false,
    )
    const all = answer({ query: 'Whole Foods', today, all: true })
    expect(all.more).toBe(0)
    expect(all.rows.length).toBeGreaterThan(8)
  })

  test("with cards saved, the pick is the engine's own recommendation", () => {
    const a = answer({ query: 'Whole Foods $80', wallet: held, today })
    const rec = recommend(
      catalog,
      WalletSchema.parse(held),
      {
        merchant: 'Whole Foods',
        amount: 80,
        channel: null,
        date: today,
        country: 'US',
      },
      undefined,
      { today },
    )
    expect(a.scope).toBe('yours')
    expect(a.canChooseScope).toBe(true)
    expect(a.pick?.cardId).toBe(rec.decision?.cardId)
    expect(a.pick).toMatchObject({
      label: 'Use',
      name: 'Amex Gold',
      detail: '4% back, about $3.20',
    })
    expect(a.subtitle).toBe('Counts as a supermarket · $80')
    expect(a.rows.map((r) => r.card.id)).toEqual(
      rec.ranked.map((r) => r.cardId),
    )
    expect(a.rows[0]?.reason).toBe('4x Amex Membership Rewards at supermarkets')
    expect(a.rows[1]?.reason).toBe('2% cash back, its base rate')
    expect(a.rows[0]?.why).toEqual(rec.ranked[0]?.reasoning)
  })

  test('someone with cards can still ask every card, with theirs marked', () => {
    const a = answer({
      query: 'Whole Foods',
      wallet: held,
      scope: 'every',
      today,
    })
    expect(a.scope).toBe('every')
    expect(a.canChooseScope).toBe(true)
    expect(
      answer({
        query: 'Whole Foods',
        wallet: held,
        scope: 'every',
        today,
        all: true,
      })
        .rows.filter((r) => r.card.held)
        .map((r) => r.card.id)
        .sort(),
    ).toEqual(held.cards.map((c) => c.id).sort())
  })

  test('a store earnrate does not know asks what kind of place it is', () => {
    const unknown = answer({ query: 'Corner Bodega Xyz', today })
    expect(unknown.kinds?.prompt).toBe(
      'What kind of place is “Corner Bodega Xyz”?',
    )
    expect(unknown.kinds?.quick.map((k) => k.label)).toContain('Supermarket')
    const asGrocery = answer({
      query: 'Corner Bodega Xyz',
      kind: 'grocery.supermarket',
      today,
    })
    expect(asGrocery.kind).toBe('grocery.supermarket')
    expect(asGrocery.rows[0]?.card.id).toBe(
      answer({ query: 'Supermarkets', today }).rows[0]?.card.id,
    )
    expect(answer({ query: 'Whole Foods', today }).kinds).toBeNull()
  })

  test('cards come grouped by issuer, or as a search finds them', () => {
    const all = cards({ wallet: held })
    const issuers = all.groups.map((g) => g.issuer)
    expect(issuers).toEqual([...issuers].sort((a, b) => a.localeCompare(b)))
    const amex = all.groups.find((g) => g.issuer === 'American Express')
    expect(amex?.cards.find((c) => c.id === 'amex-gold')?.held).toBe(true)
    expect(amex?.cards.find((c) => c.id === 'amex-platinum')?.held).toBe(false)
    const found = cards({ query: 'sapphire' }).groups
    expect(found).toHaveLength(1)
    expect(found[0]?.cards.map((c) => c.id)).toContain(
      'chase-sapphire-preferred',
    )
    expect(cards({ query: 'zzzz nothing' }).groups).toEqual([])
  })

  test("a card's drawing uses its color and says when it's light", () => {
    const gold = cards({})
      .groups.flatMap((g) => g.cards)
      .find((c) => c.id === 'amex-gold')
    expect(gold?.art.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(gold?.art.light).toBe(true)
  })

  test('adding and removing go through the wallet rules', () => {
    const added = addCard({ wallet: null, id: 'amex-gold', today })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.wallet?.cards.map((c) => c.id)).toEqual(['amex-gold'])
    expect(
      walletCards({ wallet: added.wallet }).cards.map((c) => c.id),
    ).toEqual(['amex-gold'])
    const twice = addCard({ wallet: added.wallet, id: 'amex-gold', today })
    expect(twice).toEqual({
      ok: false,
      error: 'amex-gold is already in the wallet. Update it instead.',
    })
    expect(addCard({ wallet: null, id: 'no-such-card', today }).ok).toBe(false)
    const removed = removeCard({ wallet: added.wallet, id: 'amex-gold' })
    expect(removed).toEqual({ ok: true, wallet: null, notes: [] })
    expect(walletCards({ wallet: null })).toEqual({ cards: [], problems: [] })
  })

  test("a card's page has its rates, offer, credits and fees", () => {
    const page = cardPage({ id: 'amex-gold', today })
    expect(page.name).toBe('American Express Gold Card')
    expect(page.shortName).toBe('Amex Gold')
    expect(page.fee).toBe('$325 a year')
    expect(page.earning).toContain(
      '1x Amex Membership Rewards on everything else',
    )
    expect(page.offer?.asOf).toMatch(/^Per the issuer's page as of /)
    expect(page.credits.length).toBeGreaterThan(0)
    expect(page.foreignFee).toBe('No foreign transaction fee')
    expect(page.sources.length).toBeGreaterThan(0)
    expect(page.held).toBe(false)
    expect(cardPage({ id: 'amex-gold', wallet: held, today }).held).toBe(true)
    expect(() => cardPage({ id: 'no-such-card', today })).toThrow(
      "Unknown card 'no-such-card'.",
    )
  })
})
