import { beforeAll, describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { recommend } from '../src/engine/recommend.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { WalletSchema } from '../src/schema/wallet.ts'
import { bonusRules } from '../src/engine/bonus-rules.ts'
import { compareOffers } from '../src/engine/offers.ts'
import { simulateCatalog, typicalSpendLines } from '../src/engine/simulate.ts'
import { ALL_PERSONAL_CARDS } from '../src/engine/explore.ts'
import { cardText } from '../src/format/card-text.ts'
import { catalogFile } from '../src/data/load.ts'
import {
  about,
  addCard,
  answer,
  bestSetups,
  bonusRulesScreen,
  cardFeeWorth,
  cardIndex,
  cardPage,
  cards,
  catalogInfo,
  checkCatalog,
  cardSettings,
  editCard,
  editPastCards,
  editSettings,
  home,
  nextCard,
  pastCards,
  removal,
  removeCard,
  setup,
  suggest,
  useCatalog,
  walletCards,
  walletHome,
  walletSettings,
  type Change,
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
    expect(a.title).toBe('Whole Foods Market')
    expect(a.subtitle).toBe('Counts as a supermarket')
    expect(a.pick?.label).toBe('Best card')
    expect(a.rows).toHaveLength(7)
    expect(a.rows.map((r) => r.card.id)).not.toContain(a.pick?.cardId)
    expect(a.rows[0]?.rank).toBe(2)
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
      reason: '4x Amex Membership Rewards at supermarkets',
    })
    expect(a.subtitle).toBe('Counts as a supermarket · $80')
    expect(a.rows.map((r) => r.card.id)).toEqual(
      rec.ranked.slice(1).map((r) => r.cardId),
    )
    expect(a.rows[0]?.reason).toBe('2% cash back, its base rate')
    expect(a.rows[0]?.why).toEqual(rec.ranked[1]?.reasoning)
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
    expect(unknown.kinds?.lead).toMatch(/Tap the kind of place it is/)
    expect(unknown.callouts.join(' ')).not.toMatch(/doesn't know/)
    expect(unknown.kinds?.quick.map((k) => k.label)).toContain('Supermarket')
    const asGrocery = answer({
      query: 'Corner Bodega Xyz',
      kind: 'grocery.supermarket',
      today,
    })
    expect(asGrocery.kind).toBe('grocery.supermarket')
    expect(asGrocery.pick?.cardId).toBe(
      answer({ query: 'Supermarkets', today }).pick?.cardId,
    )
    expect(answer({ query: 'Whole Foods', today }).kinds).toBeNull()
  })

  test('an everyday word titles its answer, with the category it ranks under it', () => {
    const groceries =
      "Ranks purchases at supermarkets; superstores and warehouse clubs don't count."
    for (const wallet of [undefined, held]) {
      const tapped = answer({ query: 'Groceries', wallet, today })
      expect(tapped.title).toBe('Groceries')
      expect(tapped.subtitle).toBe(groceries)
      expect(tapped.footer).not.toContain(groceries)
      expect(answer({ query: 'groceries', wallet, today }).title).toBe(
        'Groceries',
      )
    }
    expect(answer({ query: 'groceries $80', today }).subtitle).toBe(
      `$80 · ${groceries}`,
    )
    expect(
      home().quick.map((q) => {
        const a = answer({ query: q, today })
        return [a.title, a.subtitle]
      }),
    ).toEqual([
      ['Groceries', groceries],
      ['Dining', 'Ranks purchases at restaurants.'],
      ['Gas', 'Ranks purchases at gas stations.'],
      ['Amazon', 'Counts as online retail'],
      ['Costco', 'Counts as a warehouse club'],
      ['Travel', null],
      ['Netflix', 'Counts as a streaming service, bought online'],
      ['Drugstores', 'Ranks purchases at drugstores and pharmacies.'],
      ['Everything else', null],
    ])
    const own = answer({ query: 'Supermarkets', today })
    expect(own.title).toBe('Supermarkets')
    expect(own.subtitle).toBeNull()
    expect(own.footer).toContain(groceries)
    const store = answer({ query: 'Whole Foods', today })
    expect(store.title).toBe('Whole Foods Market')
    expect(store.subtitle).toBe('Counts as a supermarket')
  })

  test('cards come common first, then by issuer with business cards apart', () => {
    const all = cards({ wallet: held })
    expect(all.quick.map((c) => c.id)).toContain('chase-sapphire-preferred')
    expect(all.quick.find((c) => c.id === 'amex-gold')?.held).toBe(true)
    const personal = all.groups.filter((g) => g.id.startsWith('personal:'))
    const business = all.groups.filter((g) => g.id.startsWith('business:'))
    expect(all.groups).toEqual([...personal, ...business])
    expect(business.length).toBeGreaterThan(0)
    const titles = personal.map((g) => g.title)
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)))
    expect(
      business
        .flatMap((g) => g.cards)
        .every((c) => catalog.cards.find((k) => k.id === c.id)?.business),
    ).toBe(true)
    const letters = all.groups.map((g) => g.index).filter((i) => i !== '')
    expect(new Set(letters).size).toBe(letters.length)
    const amex = all.groups.find((g) => g.title === 'American Express')
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
    const gold = cards({}).quick.find((c) => c.id === 'amex-gold')
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
  test('after adding cards, setup asks only for picks, memberships and activations', () => {
    const ids = [
      'chase-freedom-flex',
      'chase-prime-visa',
      'bank-of-america-customized-cash-rewards',
      'citi-double-cash',
    ]
    const wallet = walletWith(ids)
    const s = setup({ wallet, ids, today })
    expect(s.cards.map((c) => c.card.id)).toEqual([
      'chase-freedom-flex',
      'bank-of-america-customized-cash-rewards',
    ])
    const flex = s.cards[0]
    expect(flex?.activations[0]?.label).toMatch(/^Grocery stores/)
    const bofa = s.cards[1]
    expect(bofa?.picks[0]).toMatchObject({
      single: true,
      count: '0 of 1 picked',
    })
    expect(s.memberships?.toggles.map((t) => t.id)).toEqual(['amazon-prime'])
    expect(s.memberships?.menus.map((m) => m.label)).toEqual([
      'BofA Rewards tier',
    ])
    const picked = ok(
      editCard({
        wallet,
        id: 'bank-of-america-customized-cash-rewards',
        edit: { pick: { choice: 'three-percent', option: 'dining' } },
        today,
      }),
    )
    const again = setup({ wallet: picked, ids, asked: s.asked, today })
    expect(again.cards.map((c) => c.card.id)).toEqual(
      s.cards.map((c) => c.card.id),
    )
    expect(again.cards[1]?.picks[0]?.count).toBe('1 of 1 picked')
    expect(setup({ wallet, ids: ['citi-double-cash'], today })).toMatchObject({
      cards: [],
      memberships: null,
    })
  })

  test('My wallet has the to-do, the cheat sheet and each card', () => {
    const wallet = walletWith([
      'amex-gold',
      'chase-freedom-flex',
      'chase-sapphire-preferred',
      'citi-double-cash',
    ])
    const w = walletHome({ wallet, today })
    expect(w.todo.find((t) => t.cardId === 'chase-freedom-flex')).toMatchObject(
      { button: 'Activate', focus: 'activations' },
    )
    expect(w.sheet?.rows.find((r) => r.label === 'Groceries')).toMatchObject({
      cardId: 'amex-gold',
      rate: '4%',
    })
    expect(
      w.sheet?.rows.find((r) => r.label === 'Streaming (Netflix)')?.query,
    ).toBe('Netflix')
    expect(w.todoShown).toBe(2)
    expect(w.cards).toHaveLength(4)
    expect(w.cards.find((c) => c.card.id === 'amex-gold')?.note).toBe(
      'Add its renewal date',
    )
    expect(walletHome({ wallet: null, today })).toMatchObject({
      todo: [],
      sheet: null,
      cards: [],
    })
  })

  test("a card's settings change through the wallet's update rules", () => {
    let wallet = walletWith([
      'amex-gold',
      'chase-freedom-flex',
      'citi-custom-cash',
    ])
    const flex = cardSettings({ wallet, id: 'chase-freedom-flex', today })
    const rule = flex.activations.find((a) => a.opens === null)?.rule ?? ''
    wallet = ok(
      editCard({
        wallet,
        id: 'chase-freedom-flex',
        edit: { activate: { rule, on: true } },
        today,
      }),
    )
    expect(
      cardSettings({
        wallet,
        id: 'chase-freedom-flex',
        today,
      }).activations.find((a) => a.rule === rule)?.on,
    ).toBe(true)

    const custom = cardSettings({ wallet, id: 'citi-custom-cash', today })
    expect(custom.picks[0]?.legend).toBe(
      'Top category: the one you expect to spend the most in',
    )
    wallet = ok(
      editCard({
        wallet,
        id: 'citi-custom-cash',
        edit: { pick: { choice: 'top-category', option: 'gas-stations' } },
        today,
      }),
    )
    expect(
      cardSettings({ wallet, id: 'citi-custom-cash', today }).picks[0]?.count,
    ).toBe('1 of 1 picked')

    const gold = cardSettings({ wallet, id: 'amex-gold', today })
    const uber = gold.credits?.tiles[0]
    expect(uber?.answer).toBeNull()
    wallet = ok(
      editCard({
        wallet,
        id: 'amex-gold',
        edit: { credit: { tap: uber?.id ?? '', before: null } },
        today,
      }),
    )
    wallet = ok(
      editCard({ wallet, id: 'amex-gold', edit: { credits: 'none' }, today }),
    )
    const tiles = cardSettings({ wallet, id: 'amex-gold', today }).credits
      ?.tiles
    expect(tiles?.[0]?.answer).toBe('used')
    expect(tiles?.slice(1).every((t) => t.answer === 'skipped')).toBe(true)

    wallet = ok(
      editCard({
        wallet,
        id: 'amex-gold',
        edit: { anniversary: { month: 3, day: 14 } },
        today,
      }),
    )
    expect(
      cardSettings({ wallet, id: 'amex-gold', today }).anniversary,
    ).toMatchObject({ month: 3, day: 14 })
    wallet = ok(
      editCard({
        wallet,
        id: 'amex-gold',
        edit: { tracking: { on: true, opened: '2026-10-01' } },
        today,
      }),
    )
    wallet = ok(
      editCard({
        wallet,
        id: 'amex-gold',
        edit: { spent: { dollars: 1200, opened: '2026-10-01' } },
        today,
      }),
    )
    expect(cardSettings({ wallet, id: 'amex-gold', today }).note).toMatch(
      /^Welcome bonus: \$1,200 of \$8,000/,
    )
  })

  test('tracking a welcome bonus waits for the account date', () => {
    const wallet = walletWith(['chase-sapphire-preferred'])
    const id = 'chase-sapphire-preferred'
    const waiting = ok(
      editCard({
        wallet,
        id,
        edit: { tracking: { on: true, opened: null, unsaved: 500 } },
        today,
      }),
    )
    expect(cardSettings({ wallet: waiting, id, today }).bonus).toMatchObject({
      tracking: false,
      opened: null,
    })
    const dated = ok(
      editCard({
        wallet: waiting,
        id,
        edit: { opened: { date: '2026-09-15', tracking: true, unsaved: 500 } },
        today,
      }),
    )
    expect(cardSettings({ wallet: dated, id, today }).bonus).toMatchObject({
      tracking: true,
      opened: '2026-09-15',
      spent: 500,
    })
  })

  test('memberships and point values are set in Settings', () => {
    let wallet = walletWith(['chase-sapphire-preferred'])
    const s = walletSettings({ wallet })
    expect(s.toggles).toEqual([])
    expect(s.otherToggles.map((t) => t.id)).toContain('amazon-prime')
    expect(s.points?.values.map((v) => v.id)).toEqual(['UR'])
    wallet = ok(
      editSettings({
        wallet,
        edit: { membership: { id: 'amazon-prime', on: true } },
      }),
    )
    wallet = ok(
      editSettings({
        wallet,
        edit: {
          tier: { group: 'bofa-preferred-rewards', id: 'bofa-rewards-premier' },
        },
      }),
    )
    wallet = ok(editSettings({ wallet, edit: { transfer: true } }))
    const after = walletSettings({ wallet })
    expect(after.toggles.find((t) => t.id === 'amazon-prime')?.on).toBe(true)
    expect(after.menus[0]?.selected).toBe('bofa-rewards-premier')
    expect(after.points?.transfer?.on).toBe(true)
    expect(after.points?.values[0]?.own).toBe(true)
    wallet = ok(
      editSettings({ wallet, edit: { pointValue: { id: 'UR', cents: null } } }),
    )
    expect(walletSettings({ wallet }).points?.values[0]?.own).toBe(false)
    const before = editSettings({
      wallet: null,
      edit: { membership: { id: 'amazon-prime', on: true } },
    })
    expect(before.ok && before.wallet?.memberships).toEqual(['amazon-prime'])
  })

  test("cards you've had take months, and removing can keep one there", () => {
    let wallet = walletWith(['chase-sapphire-preferred'])
    expect(removal({ id: 'chase-sapphire-preferred' }).keep).toMatch(
      /Cards you've had/,
    )
    wallet = ok(
      removeCard({ wallet, id: 'chase-sapphire-preferred', keep: true, today }),
    )
    const past = pastCards({ wallet, today })
    expect(past.rows.map((r) => r.card.id)).toEqual([
      'chase-sapphire-preferred',
    ])
    expect(past.rows[0]?.text).not.toBeNull()
    expect(past.add.flatMap((g) => g.cards).map((c) => c.id)).not.toContain(
      'chase-sapphire-preferred',
    )
    wallet = ok(
      editPastCards({ wallet, edit: { add: 'capital-one-savor' }, today }),
    )
    wallet = ok(
      editPastCards({
        wallet,
        edit: {
          month: { index: 1, field: 'bonus_received', month: '2024-02' },
        },
        today,
      }),
    )
    expect(
      pastCards({ wallet, today }).rows[1]?.months.find(
        (m) => m.field === 'bonus_received',
      )?.month,
    ).toBe('2024-02')
    expect(
      editPastCards({
        wallet,
        edit: {
          month: { index: 1, field: 'bonus_received', month: '2030-01' },
        },
        today,
      }).ok,
    ).toBe(false)
    wallet = ok(editPastCards({ wallet, edit: { remove: 0 }, today }))
    expect(pastCards({ wallet, today }).rows.map((r) => r.card.id)).toEqual([
      'capital-one-savor',
    ])
  })
})

describe('Next card and Cards in the app', () => {
  test('next cards rank as compare_welcome_offers does, two years together', () => {
    const wallet = walletWith(['amex-gold', 'citi-double-cash'])
    const n = nextCard({ wallet, today })
    const parsed = WalletSchema.parse(wallet)
    const offers = compareOffers(
      catalog,
      parsed,
      { kind: 'any', business: false, noAnnualFee: false, includeHeld: false },
      today,
    ).offers.filter((o) => (o.plan?.twoYears ?? 0) > 0)
    expect(n.rows.map((r) => r.card.id)).toEqual(
      offers.slice(0, 10).map((o) => o.cardId),
    )
    expect(n.rows.map((r) => r.card.id)).not.toContain('amex-gold')
    expect(n.lead).toMatch(/add to your cards/)
    expect(n.basis).toMatch(
      /^On typical U\.S\. spending, about \$[\d,]+ a month\./,
    )
    const first = n.rows[0]
    expect(first?.total).toMatch(/^\+\$/)
    expect(first?.per).toBe('/2 yrs')
    expect(first?.years).toHaveLength(2)
    expect(first?.offer).toMatch(/Public offer as of \w{3} \d+, \d{4}\.$/)
    expect(n.moreLabel).toMatch(/^Show \d+ more$/)
    expect(nextCard({ wallet, today, all: true }).rows.length).toBe(
      offers.length,
    )
    expect(nextCard({ today }).lead).toMatch(/would earn/)
    const fees = new Map(
      nextCard({ today, all: true }).rows.map((r) => [r.card.id, r.fee]),
    )
    expect(fees.get('chase-sapphire-preferred')).toBe('$95/yr')
    expect(fees.get('citi-double-cash')).toBe('No annual fee')
    expect(fees.get('amex-blue-cash-preferred')).toBe('$0, then $95/yr')
  })

  test('next cards follow the filters and ask for a month when a rule needs one', () => {
    const cash = nextCard({
      today,
      filters: { kind: 'cash', noAnnualFee: true, business: false },
    })
    expect(cash.filters.active).toBe(2)
    for (const row of cash.rows) {
      const card = catalog.cards.find((c) => c.id === row.card.id)
      expect(card?.annual_fee ?? 0).toBe(0)
      expect(card?.currency).toBe('cash')
    }
    const business = nextCard({
      today,
      filters: { kind: 'any', noAnnualFee: false, business: true },
    })
    expect(
      business.rows.every(
        (r) => catalog.cards.find((c) => c.id === r.card.id)?.business,
      ),
    ).toBe(true)
    let had = ok(
      editPastCards({
        wallet: walletWith(['amex-gold']),
        edit: { add: 'chase-freedom-unlimited' },
        today,
      }),
    )
    had = ok(
      editPastCards({
        wallet: had,
        edit: { add: 'chase-sapphire-preferred' },
        today,
      }),
    )
    const all = nextCard({ wallet: had, today, all: true })
    const cfu = all.rows.find((r) => r.card.id === 'chase-freedom-unlimited')
    expect(cfu?.eligibility).toMatch(/Tell earnrate when yours posted/)
    expect(cfu?.ask?.label).toBe('Chase Freedom Unlimited: bonus posted')
    expect(
      all.rows.find((r) => r.card.id === 'chase-sapphire-preferred')
        ?.ineligible,
    ).toMatch(/you've had this card before/)
  })

  test("best setups are the site's single cards and pairs on typical spending", () => {
    const b = bestSetups({ today })
    const result = simulateCatalog(
      catalog,
      typicalSpendLines(catalog).filter((l) => l.merchant.source !== 'none'),
      {
        filters: ALL_PERSONAL_CARDS,
        memberships: [],
        valuations: {},
        start: today,
      },
    )
    expect(b.singles.map((s) => s.key)).toEqual(
      result.singles.slice(0, 5).map((s) => s.cards[0]?.cardId),
    )
    expect(b.singles[0]?.per).toBe('/yr')
    expect(b.singles[0]?.lines[0]).toMatch(/back a year before the fee\.$/)
    if (b.pairs.length > 0) {
      expect(b.pairs[0]?.cards).toHaveLength(2)
      expect(b.pairs[0]?.split).toMatch(/ for /)
    } else expect(b.pairsNote).toMatch(/^No pair beats the /)
    expect(b.how[0]).toMatch(/^Rewards minus annual fees/)
    const held = bestSetups({ wallet: walletWith(['amex-gold']), today })
    expect(
      held.singles.flatMap((s) => s.cards).find((c) => c.id === 'amex-gold')
        ?.held ?? true,
    ).toBe(true)
  })

  test("the card list narrows on every typed word, as the site's box does", () => {
    const all = cardIndex({})
    expect(all.groups.flatMap((g) => g.cards)).toHaveLength(
      catalog.cards.length,
    )
    expect(all.groups[0]?.title).toBe('American Express')
    const plat = cardIndex({ query: 'amex plat' })
    const ids = plat.groups.flatMap((g) => g.cards.map((c) => c.id))
    expect(ids).toContain('amex-platinum')
    expect(ids.every((id) => id.startsWith('amex-'))).toBe(true)
    expect(cardIndex({ query: 'bofa' }).groups.map((g) => g.id)).toEqual([
      'bank-of-america',
    ])
    expect(cardIndex({ query: 'zzzz' }).groups).toEqual([])
  })

  test('bonus rules match the site, with what they mean for cards held or had', () => {
    const { shortName, issuerName } = cardText(catalog)
    const rules = bonusRules(catalog, issuerName, shortName)
    const screen = bonusRulesScreen({ today })
    expect(screen.groups.map((g) => g.id)).toEqual(
      rules.groups.map((g) => g.issuer),
    )
    expect(screen.lead[0]).toMatch(
      new RegExp(`Of the ${String(rules.offered)} cards here`),
    )
    const had = ok(
      editPastCards({
        wallet: null,
        edit: { add: 'chase-freedom-unlimited' },
        today,
      }),
    )
    const chase = bonusRulesScreen({ wallet: had, today }).groups.find(
      (g) => g.id === 'chase',
    )
    const cfu = chase?.rows.find((r) => r.card.id === 'chase-freedom-unlimited')
    expect(cfu?.yours).toMatch(/^Chase counts 24 months/)
    expect(cfu?.ask?.ask.field).toBe('bonus_received')
    expect(
      bonusRulesScreen({ query: 'sapphire', today }).groups.flatMap((g) =>
        g.rows.map((r) => r.card.id),
      ),
    ).toContain('chase-sapphire-preferred')
  })
})

describe('phase 1d: lighter next cards, card pages, card data updates', () => {
  test('a next card is one line of offer with its date; the rest is a tap away', () => {
    const n = nextCard({ today })
    const first = n.rows[0]
    expect(first?.offerShort).toMatch(/ after \$[\d,]+ in \d+ months?$/)
    expect(first?.offerShort.length).toBeLessThan(first?.offer.length ?? 0)
    expect(first?.asOf).toMatch(/^Offer as of \w{3} \d+, \d{4}/)
    expect(first?.flag).toBeNull()
    const had = ok(
      editPastCards({
        wallet: walletWith(['amex-gold']),
        edit: { add: 'chase-sapphire-preferred' },
        today,
      }),
    )
    const csp = nextCard({ wallet: had, today, all: true }).rows.find(
      (r) => r.card.id === 'chase-sapphire-preferred',
    )
    expect(csp?.flag).toBe('Bonus unlikely')
    expect(csp?.ineligible).toMatch(/you've had this card before/)
  })

  test('cards an issuer counts together share one repeat-bonus note', () => {
    const had = ok(
      editPastCards({
        wallet: walletWith(['amex-gold']),
        edit: { add: 'chase-southwest-plus' },
        today,
      }),
    )
    const rows = nextCard({ wallet: had, today, all: true }).rows.filter((r) =>
      r.card.id.startsWith('chase-southwest-'),
    )
    expect(rows).toHaveLength(3)
    const [lead, ...rest] = rows
    expect(lead?.eligibility).toMatch(/^Chase counts 24 months/)
    for (const name of ['Plus', 'Premier', 'Priority'])
      expect(lead?.eligibility).toContain(`Southwest Rapid Rewards ${name}`)
    expect(lead?.ask?.label).toBe('Southwest Rapid Rewards Plus: bonus posted')
    expect(lead?.flag).toBe('Bonus may not apply')
    for (const row of rest) {
      expect(row.eligibility).toBe(
        `Same bonus rule as the ${lead?.card.shortName ?? ''}, above.`,
      )
      expect(row.ask).toBeNull()
      expect(row.flag).toBe('Bonus may not apply')
    }
  })

  test("a card's page comes first; whether its fee is worth it comes after", () => {
    const quick = cardPage({ id: 'amex-gold', today, feeWorth: false })
    expect(quick.feeWorth).toBeNull()
    expect(quick.feeWorthLater).toBe(true)
    expect(quick.earning).toEqual(cardPage({ id: 'amex-gold', today }).earning)
    expect(cardFeeWorth({ id: 'amex-gold', today }).text).toBe(
      cardPage({ id: 'amex-gold', today }).feeWorth,
    )
    expect(
      cardPage({ id: 'citi-double-cash', today, feeWorth: false })
        .feeWorthLater,
    ).toBe(false)
    expect(cardPage({ id: 'amex-gold', today }).feeWorthLater).toBe(false)
  })

  test('a downloaded catalog is used only when it reads and is newer', async () => {
    const file = await catalogFile()
    try {
      useCatalog(catalog, '2026.01.01')
      expect(catalogInfo()).toEqual({ version: '2026.01.01', format: 1 })
      expect(() =>
        checkCatalog(JSON.stringify({ ...file, format: 9 })),
      ).toThrow()
      expect(catalogInfo().version).toBe('2026.01.01')
      const stored = JSON.parse(checkCatalog(JSON.stringify(file))) as {
        version: string
        catalog: Catalog
      }
      expect(stored.version).toBe(file.version)
      expect(stored.catalog).toEqual(catalog)
      expect(catalogInfo().version).toBe(file.version)
      expect(() => checkCatalog(JSON.stringify(file))).toThrow(/not newer/)
      const a = about({ appVersion: '1.0 (1)', downloaded: true })
      expect(a.data.label).toBe(`Card data ${file.version}`)
      expect(a.data.detail).toMatch(
        /^\w{3} \d+, \d{4} · Updated from earnrate\.dev$/,
      )
      expect(a.links.map((l) => l.url)).toEqual([
        'https://earnrate.dev/support#wrong-rate',
        'https://earnrate.dev/support',
        'https://earnrate.dev/privacy',
        'https://earnrate.dev/terms',
        'https://github.com/cwasley/earnrate',
      ])
      expect(a.privacy).toMatch(/sends nothing else/)
      expect(a.data.refused).toBeNull()
      expect(
        about({ appVersion: '1.0 (1)', downloaded: true, refused: '2099.1.1' })
          .data.refused,
      ).toBe('Newer card data needs the latest app.')
      expect(
        about({ appVersion: '1.0 (1)', downloaded: true, refused: '2020.1.1' })
          .data.refused,
      ).toBeNull()
    } finally {
      useCatalog(catalog)
    }
  })
})

function walletWith(ids: string[]): unknown {
  let wallet: unknown = null
  for (const id of ids) wallet = ok(addCard({ wallet, id, today }))
  return wallet
}

function ok(change: Change): unknown {
  if (!change.ok) throw new Error(change.error)
  return change.wallet
}
