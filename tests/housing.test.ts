import { createMcpHandler } from '@modelcontextprotocol/server'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { WALLET_ENV_VAR } from '../src/brand.ts'
import { run } from '../src/cli/run.ts'
import { loadCatalog } from '../src/data/load.ts'
import { JsonWalletStore } from '../src/data/store.ts'
import { ALL_PERSONAL_CARDS, exploreCards } from '../src/engine/explore.ts'
import { recommend } from '../src/engine/recommend.ts'
import {
  nothingCounted,
  simulateCatalog,
  resolveSpendLines,
} from '../src/engine/simulate.ts'
import { categoryNote, categoryUnranked } from '../src/engine/text.ts'
import { walletFromCards } from '../src/engine/transient.ts'
import { formatExploration } from '../src/format/explore.ts'
import { formatRecommendation } from '../src/format/recommendation.ts'
import { createEarnrateServer } from '../src/mcp/server.ts'
import { findCategory, resolvePlace } from '../src/merchants/resolve.ts'
import { TODAY } from './golden/fixtures.ts'
import { EXAMPLE_WALLET, memoryBackend, text } from './helpers.ts'

const catalog = await loadCatalog()
const NOTE = categoryNote(catalog, 'housing') ?? ''

const explore = (merchant: string) =>
  exploreCards(
    catalog,
    {
      merchant,
      category: null,
      amount: null,
      channel: null,
      date: TODAY,
    },
    { filters: ALL_PERSONAL_CARDS, memberships: [], valuations: {} },
  )

const purchase = (merchant: string) => ({
  merchant,
  amount: null,
  channel: null,
  date: TODAY,
  country: 'US',
})

describe('rent and mortgage', () => {
  test('the note says cards usually cost a fee there and how Bilt earns', () => {
    expect(NOTE).toMatch(/payment service usually/)
    expect(NOTE).toMatch(/Bilt/)
    expect(NOTE).toMatch(/up to 1\.25X/)
    expect(NOTE).toMatch(/else you spend/)
    expect(NOTE).not.toMatch(/\d% fee/)
  })

  test.each([
    'rent',
    'Rent',
    'rent payment',
    'rent payments',
    'my rent',
    'mortgage',
    'mortgage payment',
    'housing',
  ])('"%s" is rent and mortgage', (words) => {
    const m = resolvePlace(catalog, words, null)
    expect(m.source).toBe('category')
    expect(m.category).toBe('housing')
  })

  test.each([
    ['car rental', 'travel.car_rental'],
    ['car rentals', 'travel.car_rental'],
    ['rental car', 'travel.car_rental'],
    ['rental cars', 'travel.car_rental'],
    ['Hertz', 'travel.car_rental'],
    ['Enterprise', 'travel.car_rental'],
    ['U-Haul', 'other'],
    ['Penske Truck Rental', 'other'],
  ])('"%s" still codes as %s', (words, category) => {
    expect(resolvePlace(catalog, words, null).category).toBe(category)
  })

  test.each(['Rent the Runway', 'Rent-A-Center', 'rental', 'rentals'])(
    '"%s" is not rent',
    (words) => {
      expect(findCategory(catalog, words)).toBeNull()
      expect(resolvePlace(catalog, words, null).category).not.toBe('housing')
    },
  )

  test.each(['rent', 'mortgage'])(
    'every card answer for %s is the note alone',
    (words) => {
      const r = explore(words)
      expect(r.categoryNote).toBe(NOTE)
      expect(r.ranked).toEqual([])
      expect(r.membersOnly).toEqual([])
      expect(r.credits).toEqual([])
      expect(r.excluded).toEqual([])
      expect(r.ifPaying).toEqual([])
      expect(r.assumptions).toEqual([])
      expect(formatExploration(r, catalog, false)).toBe(`${NOTE}\n`)
    },
  )

  test('other categories carry no note and still rank', () => {
    for (const words of ['groceries', 'car rental', 'Hertz']) {
      const r = explore(words)
      expect(r.categoryNote).toBeNull()
      expect(r.ranked.length).toBeGreaterThan(0)
    }
  })

  test('only a category marked unranked goes unranked, and its subcategories', () => {
    const marked = catalog.categories.filter((c) => c.unranked)
    expect(marked.map((c) => c.id)).toEqual(['housing'])
    expect(marked.every((c) => c.note !== undefined)).toBe(true)
    expect(categoryUnranked(catalog, 'housing')).toBe(true)
    expect(categoryUnranked(catalog, 'housing.anything')).toBe(true)
    expect(categoryUnranked(catalog, 'travel.car_rental')).toBe(false)
  })

  test('an answer from named cards is the note alone too', () => {
    const wallet = walletFromCards(
      catalog,
      { cards: [{ id: 'bilt-obsidian' }, { id: 'citi-double-cash' }] },
      TODAY,
    )
    if (typeof wallet === 'string') throw new Error(wallet)
    const rec = recommend(
      catalog,
      wallet,
      purchase('mortgage'),
      resolvePlace(catalog, 'mortgage', null),
    )
    expect(rec.categoryNote).toBe(NOTE)
    expect(rec.decision).toBeNull()
    expect(rec.ranked).toEqual([])
    expect(rec.excluded).toEqual([])
    expect(rec.notes).toEqual([])
    expect(rec.warnings).toEqual([])
    expect(rec.sensitivity).toBeNull()
    expect(rec.bonus).toBeNull()
    const out = formatRecommendation(rec, purchase('mortgage'))
    expect(out).toBe(`Rent and mortgage\n\n${NOTE}\n`)
    const elsewhere = recommend(
      catalog,
      wallet,
      purchase('car rental'),
      resolvePlace(catalog, 'car rental', null),
    )
    expect(elsewhere.categoryNote).toBeNull()
    expect(elsewhere.decision).not.toBeNull()
    expect(elsewhere.ranked.length).toBe(2)
  })

  const simulate = (spend: { merchant: string; monthly: number }[]) =>
    simulateCatalog(
      catalog,
      resolveSpendLines(
        catalog,
        spend.map((s) => ({ ...s, category: null })),
      ),
      {
        filters: ALL_PERSONAL_CARDS,
        memberships: [],
        valuations: {},
        start: TODAY,
      },
    )

  test('a year of spending leaves rent out and says so', () => {
    const lines = resolveSpendLines(catalog, [
      { merchant: 'rent', category: null, monthly: 2000 },
      { merchant: 'groceries', category: null, monthly: 500 },
    ])
    const sim = simulate([
      { merchant: 'rent', monthly: 2000 },
      { merchant: 'groceries', monthly: 500 },
    ])
    const without = simulate([{ merchant: 'groceries', monthly: 500 }])
    const first = sim.singles[0]
    expect(first?.spend).toBe(6000)
    expect(first?.lines.map((l) => l.label)).toEqual(['Supermarkets'])
    expect(first?.notes.slice(0, 2)).toEqual([
      "Rent and mortgage isn't counted in the year.",
      NOTE,
    ])
    expect(sim.singles.map((s) => [s.cards[0]?.cardId, s.net])).toEqual(
      without.singles.map((s) => [s.cards[0]?.cardId, s.net]),
    )
    expect(nothingCounted(catalog, lines)).toBeNull()
    expect(nothingCounted(catalog, lines.slice(0, 1))).toBe(
      `Rent and mortgage isn't counted in the year. ${NOTE} Add other spending to compare cards.`,
    )
  })
})

const namesNoCard = (out: string) => {
  for (const card of catalog.cards) expect(out).not.toContain(card.name)
  expect(out).not.toMatch(/Citi Double Cash|Use |\d% back|Best cards for/)
}

describe('surfaces', () => {
  test('the CLI gives the note alone, with or without cards', async () => {
    const cli = async (argv: string[], wallet: string) => {
      let stdout = ''
      let stderr = ''
      const code = await run(argv, {
        env: { EARNRATE_MISSED_MERCHANTS: 'off', [WALLET_ENV_VAR]: wallet },
        today: TODAY,
        stdout: (t) => (stdout += t),
        stderr: (t) => (stderr += t),
      })
      return { code, stdout, stderr }
    }
    const none = path.join(
      await mkdtemp(path.join(tmpdir(), 'earnrate-rent-')),
      'none.yaml',
    )
    const every = await cli(['rent'], none)
    expect(every.stdout).toBe(`${NOTE}\n`)
    const named = await cli(
      ['rent', '--cards', 'bilt-obsidian,citi-double-cash'],
      none,
    )
    expect(named.stdout).toBe(`Rent and mortgage\n\n${NOTE}\n`)
    const saved = await cli(['mortgage'], EXAMPLE_WALLET)
    expect(saved.stdout).toBe(`Rent and mortgage\n\n${NOTE}\n`)
    const best = await cli(['best', 'rent'], none)
    expect(best.stdout).toBe(`${NOTE}\n`)
    for (const out of [every, named, saved, best]) namesNoCard(out.stdout)
    const year = await cli(['simulate', 'rent=2000'], none)
    expect(year.code).not.toBe(0)
    expect(year.stderr).toContain(NOTE)
    const rental = await cli(['car rental'], none)
    expect(rental.stdout).toMatch(/Best cards for/)
  })

  test('the MCP answers give the note alone', async () => {
    const handler = createMcpHandler(() =>
      createEarnrateServer({
        catalog,
        savedWallets: 'account',
        store: new JsonWalletStore(
          catalog,
          memoryBackend(),
          'your saved wallet',
        ),
        today: () => TODAY,
        llm: null,
        missed: null,
        version: '0.0.0-test',
      }),
    )
    const client = new Client(
      { name: 'earnrate-test', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    )
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://earnrate.test/mcp'), {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      }),
    )
    type Answer = {
      categoryNote: string | null
      decision: unknown
      ranked: unknown[]
      warnings: string[]
      allCards: { ranked: unknown[]; credits: unknown[] } | null
    }
    const every = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'rent' },
    })
    expect(every.isError, text(every)).toBeFalsy()
    expect(text(every)).toBe(`${NOTE}\n`)
    const everyAnswer = every.structuredContent as Answer
    expect(everyAnswer.categoryNote).toBe(NOTE)
    expect(everyAnswer.decision).toBeNull()
    expect(everyAnswer.ranked).toEqual([])
    expect(everyAnswer.warnings).toEqual([])
    expect(everyAnswer.allCards?.ranked).toEqual([])
    expect(everyAnswer.allCards?.credits).toEqual([])
    const named = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: {
        merchant: 'rent',
        cards: [{ cardId: 'bilt-obsidian' }, { cardId: 'citi-double-cash' }],
      },
    })
    expect(named.isError, text(named)).toBeFalsy()
    expect(text(named)).toBe(`Rent and mortgage\n\n${NOTE}\n`)
    const namedAnswer = named.structuredContent as Answer
    expect(namedAnswer.categoryNote).toBe(NOTE)
    expect(namedAnswer.decision).toBeNull()
    expect(namedAnswer.ranked).toEqual([])
    const best = await client.callTool({
      name: 'best_cards_for',
      arguments: { category: 'housing' },
    })
    expect(best.isError, text(best)).toBeFalsy()
    expect(text(best)).toBe(`${NOTE}\n`)
    expect((best.structuredContent as Answer).categoryNote).toBe(NOTE)
    expect((best.structuredContent as Answer).ranked).toEqual([])
    for (const out of [every, named, best]) namesNoCard(text(out))
    const onlyRent = await client.callTool({
      name: 'simulate_spending',
      arguments: { spending: [{ merchant: 'rent', monthly: 2000 }] },
    })
    expect(onlyRent.isError).toBe(true)
    expect(text(onlyRent)).toContain(NOTE)
    const withRent = await client.callTool({
      name: 'simulate_spending',
      arguments: {
        spending: [
          { merchant: 'rent', monthly: 2000 },
          { category: 'dining', monthly: 400 },
        ],
      },
    })
    expect(withRent.isError, text(withRent)).toBeFalsy()
    expect(text(withRent)).toContain("Rent and mortgage isn't counted")
    expect(text(withRent)).toContain('A year of this spending: $4,800.')
    await client.close()
    await handler.close()
  })
})
