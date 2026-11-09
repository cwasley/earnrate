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
import { simulateCatalog, resolveSpendLines } from '../src/engine/simulate.ts'
import { categoryNote } from '../src/engine/text.ts'
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

  test('every card answer for rent leads with the note', () => {
    const r = explore('rent')
    expect(r.categoryNote).toBe(NOTE)
    const out = formatExploration(r, catalog, false)
    expect(out.startsWith(NOTE)).toBe(true)
    expect(out.indexOf(NOTE)).toBeLessThan(out.indexOf('Best cards for'))
    expect(out).not.toMatch(/not recognized/)
  })

  test('other categories carry no note', () => {
    expect(explore('groceries').categoryNote).toBeNull()
    expect(explore('car rental').categoryNote).toBeNull()
    expect(explore('Hertz').categoryNote).toBeNull()
  })

  test('an answer from named cards leads with the note too', () => {
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
    expect(rec.decision?.confidence).toBe('low')
    const out = formatRecommendation(rec, purchase('mortgage'))
    expect(out.indexOf(NOTE)).toBeGreaterThan(-1)
    expect(out.indexOf(NOTE)).toBeLessThan(out.indexOf('Use '))
    const elsewhere = recommend(
      catalog,
      wallet,
      purchase('car rental'),
      resolvePlace(catalog, 'car rental', null),
    )
    expect(elsewhere.categoryNote).toBeNull()
  })

  test('a year of spending that includes rent says so', () => {
    const lines = resolveSpendLines(catalog, [
      { merchant: 'rent', category: null, monthly: 2000 },
      { merchant: 'groceries', category: null, monthly: 500 },
    ])
    const sim = simulateCatalog(catalog, lines, {
      filters: ALL_PERSONAL_CARDS,
      memberships: [],
      valuations: {},
      start: TODAY,
    })
    expect(sim.singles[0]?.notes).toContain(NOTE)
  })
})

describe('surfaces', () => {
  test('the CLI leads with the note, with or without cards', async () => {
    const cli = async (argv: string[], wallet: string) => {
      let stdout = ''
      await run(argv, {
        env: { EARNRATE_MISSED_MERCHANTS: 'off', [WALLET_ENV_VAR]: wallet },
        today: TODAY,
        stdout: (t) => (stdout += t),
        stderr: () => undefined,
      })
      return stdout
    }
    const none = path.join(
      await mkdtemp(path.join(tmpdir(), 'earnrate-rent-')),
      'none.yaml',
    )
    const every = await cli(['rent'], none)
    expect(every.indexOf(NOTE)).toBeGreaterThan(-1)
    expect(every.indexOf(NOTE)).toBeLessThan(every.indexOf('Best cards for'))
    const named = await cli(
      ['rent', '--cards', 'bilt-obsidian,citi-double-cash'],
      none,
    )
    expect(named.indexOf(NOTE)).toBeGreaterThan(-1)
    expect(named.indexOf(NOTE)).toBeLessThan(named.indexOf('Use '))
    const saved = await cli(['mortgage'], EXAMPLE_WALLET)
    expect(saved.indexOf(NOTE)).toBeGreaterThan(-1)
  })

  test('the MCP answers lead with the note', async () => {
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
    type Answer = { categoryNote: string | null }
    const every = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'rent' },
    })
    expect(every.isError, text(every)).toBeFalsy()
    expect(text(every).startsWith(NOTE)).toBe(true)
    expect((every.structuredContent as Answer).categoryNote).toBe(NOTE)
    const named = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: {
        merchant: 'rent',
        cards: [{ cardId: 'bilt-obsidian' }, { cardId: 'citi-double-cash' }],
      },
    })
    expect(named.isError, text(named)).toBeFalsy()
    expect(text(named).indexOf(NOTE)).toBeGreaterThan(-1)
    expect(text(named).indexOf(NOTE)).toBeLessThan(text(named).indexOf('Use '))
    expect((named.structuredContent as Answer).categoryNote).toBe(NOTE)
    const best = await client.callTool({
      name: 'best_cards_for',
      arguments: { category: 'housing' },
    })
    expect(best.isError, text(best)).toBeFalsy()
    expect(text(best).startsWith(NOTE)).toBe(true)
    expect((best.structuredContent as Answer).categoryNote).toBe(NOTE)
    await client.close()
    await handler.close()
  })
})
