import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { WALLET_ENV_VAR } from '../src/brand.ts'
import { parseWalletYaml } from '../src/format/wallet-yaml.ts'
import { FileWalletStore } from '../src/data/file-store.ts'
import { loadCatalog } from '../src/data/load.ts'
import { JsonWalletStore, type WalletStore } from '../src/data/store.ts'
import type { CheatSheet } from '../src/engine/cheat-sheet.ts'
import type { Recommendation } from '../src/engine/types.ts'
import type { WalletSummary } from '../src/engine/wallet-summary.ts'
import {
  ANSWER_TOOLS,
  createEarnrateServer,
  SAVED_WALLET_TOOLS,
  type WalletSaving,
} from '../src/mcp/server.ts'
import type { Classifier } from '../src/merchants/classifier.ts'
import { createLlmSession, type LlmSession } from '../src/merchants/fallback.ts'
import type { MissLog } from '../src/merchants/missed.ts'
import { TODAY } from './golden/fixtures.ts'
import {
  EXAMPLE_WALLET,
  memoryBackend,
  memoryCache,
  ROOT,
  text,
} from './helpers.ts'

const catalog = await loadCatalog()

async function walletCopy(contents?: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-mcp-'))
  const file = path.join(dir, 'wallet.yaml')
  if (contents === undefined) await copyFile(EXAMPLE_WALLET, file)
  else await writeFile(file, contents)
  return file
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function connect(
  wallet: string | WalletStore,
  llm: LlmSession | null = null,
) {
  const store =
    typeof wallet === 'string' ? new FileWalletStore(catalog, wallet) : wallet
  return serve({ savedWallets: 'file', store }, llm)
}

async function serve(
  saving: WalletSaving,
  llm: LlmSession | null = null,
  missed: MissLog | null = null,
) {
  const handler = createMcpHandler(() =>
    createEarnrateServer({
      catalog,
      ...saving,
      today: () => TODAY,
      llm,
      missed,
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
  cleanups.push(async () => {
    await client.close()
    await handler.close()
  })
  return client
}

describe('tools', () => {
  test('lists the fourteen tools with descriptions and hints', async () => {
    const client = await connect(await walletCopy())
    const { tools } = await client.listTools()
    // The directory reads the listing name from annotations.title.
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy()
      expect(tool.annotations?.title, tool.name).toBe(tool.title)
    }
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_card',
      'best_card_for_purchase',
      'best_cards_for',
      'cheat_sheet',
      'compare_welcome_offers',
      'list_wallet',
      'record_purchase',
      'remove_card',
      'resolve_merchant',
      'search_cards',
      'set_memberships',
      'set_point_values',
      'simulate_spending',
      'update_card',
    ])
    for (const t of tools) {
      expect(t.description?.length).toBeGreaterThan(80)
      expect(t.outputSchema).toBeDefined()
    }
    const record = tools.find((t) => t.name === 'record_purchase')
    expect(record?.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: false,
    })
    const best = tools.find((t) => t.name === 'best_card_for_purchase')
    expect(best?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    })
  })

  test('best_card_for_purchase returns the decision and readable text', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Whole Foods', amount: 80, channel: 'in_store' },
    })
    expect(result.isError).toBeFalsy()
    const rec = result.structuredContent as Recommendation
    expect(rec.decision).toMatchObject({
      cardId: 'amex-blue-cash-preferred',
      checkoutLabel: 'Blue Cash Preferred',
    })
    expect(rec.ranked[0]?.earned).toBeCloseTo(4.8)
    expect(text(result)).toMatch(
      /Use Blue Cash Preferred: 6% back, about \$4\.80/,
    )
  })

  test('best_card_for_purchase takes a valuation profile', async () => {
    const client = await connect(await walletCopy())
    const ask = async (valuation?: string) =>
      (
        (
          await client.callTool({
            name: 'best_card_for_purchase',
            arguments: { merchant: 'restaurants', amount: 100, valuation },
          })
        ).structuredContent as Recommendation
      ).ranked.find((r) => r.cardId === 'amex-gold')?.effectiveReturnPct
    const usual = await ask()
    expect(await ask('points-heavy')).toBeGreaterThan(usual ?? Infinity)
  })

  test('bad arguments come back as a tool error', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Whole Foods', amount: -5 },
    })
    expect(result.isError).toBe(true)
  })

  test('resolve_merchant explains where a merchant came from', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'resolve_merchant',
      arguments: { merchant: 'costco' },
    })
    expect(result.structuredContent).toMatchObject({
      merchantId: 'costco',
      category: 'warehouse_club',
      accepts: ['visa'],
      source: 'override',
    })
    expect(text(result)).toMatch(/from earnrate's merchant list\./)
    expect(text(result)).toMatch(/Takes Visa only\./)
  })

  test('recording at an unknown merchant asks for its category', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'record_purchase',
      arguments: {
        cardId: 'amex-gold',
        merchant: 'Tacos Por Favor Santa Monica',
        amount: 20,
      },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/Nothing was recorded\..*again with category/)
    const other = await client.callTool({
      name: 'record_purchase',
      arguments: {
        cardId: 'amex-gold',
        merchant: 'Tacos Por Favor Santa Monica',
        amount: 20,
        category: 'other',
      },
    })
    expect(other.isError).toBeFalsy()
  })

  test('spend milestones: set the spending, see it cross, record it', async () => {
    const file = await walletCopy(
      '# mine\ncards:\n  - id: chase-ihg-one-rewards # the no-fee one\n',
    )
    const client = await connect(file)
    const set = await client.callTool({
      name: 'update_card',
      arguments: {
        cardId: 'chase-ihg-one-rewards',
        milestoneSpent: { 'spend-15k': 14950 },
      },
    })
    expect(set.isError, text(set)).toBeFalsy()
    expect(text(set)).toMatch(/\$14,950 spent toward spend-15k this year/)
    const saved = await readFile(file, 'utf8')
    expect(saved).toContain('# the no-fee one')
    expect(saved).toMatch(
      /milestone_usage:\n\s+spend-15k: \{ period: "?2026"?, spent: 14950 \}/,
    )

    const best = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Chipotle', amount: 100 },
    })
    expect(text(best)).toMatch(
      /reaches the \$15,000 calendar-year spend for 10,000 bonus points and Gold Elite status/,
    )

    const recorded = await client.callTool({
      name: 'record_purchase',
      arguments: {
        cardId: 'chase-ihg-one-rewards',
        merchant: 'Chipotle',
        amount: 100,
      },
    })
    expect(recorded.isError, text(recorded)).toBeFalsy()
    expect(text(recorded)).toMatch(
      /Spend on chase-ihg-one-rewards this year: \$15,050\. That reaches its \$15,000 spend bonus\./,
    )
    expect(
      (recorded.structuredContent as { milestones: { after: number }[] })
        .milestones[0]?.after,
    ).toBe(15050)

    const listed = await client.callTool({ name: 'list_wallet', arguments: {} })
    expect(text(listed)).toMatch(
      /Spend bonus \(spend-15k\): \$15,000 reached this year: 10,000 bonus points and Gold Elite status\./,
    )

    const wrong = await client.callTool({
      name: 'update_card',
      arguments: {
        cardId: 'chase-ihg-one-rewards',
        milestoneSpent: { 'spend-99k': 1 },
      },
    })
    expect(text(wrong)).toMatch(/no spend milestone 'spend-99k'.*spend-15k/)
  })

  test('settings that change nothing say so', async () => {
    const client = await connect(await walletCopy())
    const anniversary = await client.callTool({
      name: 'update_card',
      arguments: { cardId: 'amex-gold', anniversary: '03-14' },
    })
    expect(text(anniversary)).toMatch(
      /anniversary 03-14\. None of its caps reset on the account anniversary/,
    )
    const memberships = await client.callTool({
      name: 'set_memberships',
      arguments: { memberships: ['amazon-prime', 'nordy-club-ambassador'] },
    })
    expect(text(memberships)).toMatch(
      /Nordy Club Ambassador doesn't change any saved card's rates yet/,
    )
  })

  test('an unknown merchant asks for its category', async () => {
    const client = await connect(await walletCopy())
    const unknown = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Tacos Por Favor Santa Monica' },
    })
    expect(text(unknown)).toMatch(
      /^earnrate doesn't recognize "Tacos Por Favor Santa Monica".*call best_card_for_purchase again with category/,
    )
    const known = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: {
        merchant: 'Tacos Por Favor Santa Monica',
        category: 'dining',
      },
    })
    expect(text(known)).not.toMatch(/doesn't recognize/)
  })

  test('list_wallet shows caps and chosen categories', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({ name: 'list_wallet', arguments: {} })
    const summary = result.structuredContent as WalletSummary
    expect(summary.cards).toHaveLength(9)
    const cashPlus = summary.cards.find((c) => c.cardId === 'usbank-cash-plus')
    expect(cashPlus?.chosen).toMatchObject({ period: '2026-Q4', current: true })
    expect(cashPlus?.caps).toEqual([
      expect.objectContaining({
        key: 'five-percent-combined',
        currentPeriod: '2026-Q4',
        remaining: 2000,
      }),
    ])
    expect(text(result)).toMatch(
      /Cash\+ Visa Signature Card \(usbank-cash-plus\), shown at checkout as "Cash\+": Visa,/,
    )
    expect(text(result)).toMatch(
      /Picks for 2026-Q4, through Dec 31, 2026: 5%: /,
    )
    expect(text(result)).toMatch(
      /Cap on your 5% picks: .* \(cap key five-percent-combined\)/,
    )
    expect(text(result)).toMatch(/^Memberships: /m)
    expect(text(result)).toMatch(
      /^To do now:\n- Activate Freedom Flex's bonus on /m,
    )
  })

  test('category inputs leave out parents no purchase codes as', async () => {
    const client = await connect(await walletCopy())
    const parent = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Corner market', category: 'grocery' },
    })
    expect(parent.isError).toBe(true)
    const child = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Corner market', category: 'grocery.supermarket' },
    })
    expect(child.isError).toBeFalsy()
  })

  test('a broken wallet is reported, not thrown', async () => {
    const client = await connect(
      await walletCopy('cards:\n  - id: nope-card\n'),
    )
    const result = await client.callTool({ name: 'list_wallet', arguments: {} })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/nope-card: not in the card catalog/)
  })
})

describe('wallet setup', () => {
  async function missingWallet(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-mcp-'))
    return path.join(dir, 'earnrate', 'wallet.yaml')
  }

  test('the server tells agents how to set up a wallet', async () => {
    const client = await connect(await walletCopy())
    expect(client.getInstructions()).toMatch(/search_cards.*add_card/s)
  })

  test('the every-card cheat sheet takes catalog filters', async () => {
    const client = await connect(await missingWallet())
    const sheet = await client.callTool({
      name: 'cheat_sheet',
      arguments: { noAnnualFee: true },
    })
    const rows = (sheet.structuredContent as CheatSheet).rows
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      if (row.cardId === null) continue
      const card = catalog.cards.find((c) => c.id === row.cardId)
      expect(card?.annual_fee ?? 0).toBe(0)
    }
  })

  test('compares every card with no wallet at all', async () => {
    const client = await connect(await missingWallet())
    const best = await client.callTool({
      name: 'best_cards_for',
      arguments: { category: 'grocery.supermarket' },
    })
    expect(best.isError).toBeFalsy()
    const ranked = (best.structuredContent as { ranked: { cardId: string }[] })
      .ranked
    expect(ranked[0]?.cardId).toBe('amex-blue-cash-preferred')
    expect(ranked).toHaveLength(10)
    expect(text(best)).toMatch(/^Best cards for supermarkets:/)

    const sim = await client.callTool({
      name: 'simulate_spending',
      arguments: {
        spending: [
          { category: 'grocery.supermarket', monthly: 700 },
          { merchant: 'Amazon', monthly: 100 },
        ],
        noAnnualFee: true,
      },
    })
    expect(sim.isError).toBeFalsy()
    const { singles, pairs } = sim.structuredContent as {
      singles: { annualFees: number }[]
      pairs: unknown[]
    }
    expect(singles.every((s) => s.annualFees === 0)).toBe(true)
    expect(pairs.length).toBeGreaterThan(0)

    const withWallet = await client.callTool({
      name: 'simulate_spending',
      arguments: {
        spending: [{ category: 'dining', monthly: 300 }],
        compareToWallet: true,
      },
    })
    expect(withWallet.isError).toBeFalsy()
    expect(text(withWallet)).toMatch(
      /No cards are saved or named.*Best single cards/is,
    )
  })

  test('cheat_sheet answers from the wallet', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({ name: 'cheat_sheet', arguments: {} })
    expect(result.isError).toBeFalsy()
    const { rows } = result.structuredContent as {
      rows: { label: string; cardId: string | null }[]
    }
    expect(rows.find((r) => r.label === 'Groceries')?.cardId).toBe(
      'amex-blue-cash-preferred',
    )
    expect(text(result)).toMatch(
      /^From the wallet file on this computer.*\nYour cheat sheet for Q4 2026/,
    )
  })

  test('simulate_spending against the wallet ranks additions', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'simulate_spending',
      arguments: {
        spending: [
          { category: 'dining', monthly: 400 },
          { category: 'other', monthly: 1000 },
        ],
        compareToWallet: true,
      },
    })
    expect(result.isError).toBeFalsy()
    const { current, additions } = result.structuredContent as {
      current: { rewards: number }
      additions: { gain: number }[]
    }
    expect(current.rewards).toBeGreaterThan(0)
    expect(additions.length).toBeGreaterThan(0)
    expect(text(result)).toMatch(
      /^From the wallet file on this computer.*\nYour wallet earns about/,
    )
  })

  test('nothing entered: read tools answer from every card', async () => {
    const client = await connect(await missingWallet())
    const best = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Whole Foods' },
    })
    expect(best.isError).toBeFalsy()
    const answer = best.structuredContent as {
      decision: unknown
      allCards: { ranked: { cardId: string }[] } | null
    }
    expect(answer.decision).toBeNull()
    expect(answer.allCards?.ranked[0]?.cardId).toBe('amex-blue-cash-preferred')
    expect(text(best)).toMatch(/^Best cards for Whole Foods Market/)

    const unknownPlace = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: "Joe's Diner", category: 'dining' },
    })
    expect(
      (
        unknownPlace.structuredContent as {
          allCards: { merchant: { category: string } }
        }
      ).allCards.merchant.category,
    ).toBe('dining')

    const sheet = await client.callTool({ name: 'cheat_sheet', arguments: {} })
    const allSheet = sheet.structuredContent as {
      scope: string
      rows: { label: string; cardId: string | null }[]
    }
    expect(allSheet.scope).toBe('all cards')
    expect(allSheet.rows.find((r) => r.label === 'Groceries')?.cardId).toBe(
      'amex-blue-cash-preferred',
    )

    const sim = await client.callTool({
      name: 'simulate_spending',
      arguments: {},
    })
    expect(sim.isError).toBeFalsy()
    expect((sim.structuredContent as { notes: string[] }).notes[0]).toMatch(
      /typical monthly amounts/,
    )
  })

  test('cards named in the conversation answer for just those cards', async () => {
    const file = await missingWallet()
    const client = await connect(file)
    const cards = [{ cardId: 'amex-gold' }, { cardId: 'chase-prime-visa' }]
    const best = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: {
        merchant: 'Whole Foods',
        cards,
        memberships: ['amazon-prime'],
      },
    })
    const answer = best.structuredContent as {
      decision: { cardId: string; effectiveReturnPct: number }
      allCards: unknown
    }
    expect(answer.decision.cardId).toBe('chase-prime-visa')
    expect(answer.decision.effectiveReturnPct).toBe(5)
    expect(answer.allCards).toBeNull()

    const sheet = await client.callTool({
      name: 'cheat_sheet',
      arguments: { cards },
    })
    expect((sheet.structuredContent as { scope: string }).scope).toBe('wallet')

    const sim = await client.callTool({
      name: 'simulate_spending',
      arguments: { cards },
    })
    expect(
      (sim.structuredContent as { additions: unknown[] }).additions.length,
    ).toBeGreaterThan(0)

    const bad = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Costco', cards: [{ cardId: 'not-a-card' }] },
    })
    expect(bad.isError).toBe(true)
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })

  test('a JSON-backed saved wallet works through the same tools', async () => {
    const backend = memoryBackend()
    const client = await connect(
      new JsonWalletStore(catalog, backend, 'your saved wallet'),
    )
    const before = await client.callTool({ name: 'list_wallet', arguments: {} })
    expect(text(before)).toMatch(/no saved wallet yet/)
    await client.callTool({
      name: 'add_card',
      arguments: {
        cardId: 'amex-blue-cash-preferred',
        bonus: { opened: '2026-10-01' },
      },
    })
    const best = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Whole Foods', amount: 100 },
    })
    expect(
      (best.structuredContent as { decision: { cardId: string } }).decision
        .cardId,
    ).toBe('amex-blue-cash-preferred')
    const recorded = await client.callTool({
      name: 'record_purchase',
      arguments: {
        cardId: 'amex-blue-cash-preferred',
        merchant: 'Whole Foods',
        amount: 100,
      },
    })
    expect(text(recorded)).toMatch(
      /Welcome bonus on amex-blue-cash-preferred: \$100 of \$3,000/,
    )
    const saved = JSON.parse((await backend.read()) ?? '{}') as {
      cards: { bonus?: { spent: number } }[]
    }
    expect(saved.cards[0]?.bonus?.spent).toBe(100)
  })

  test('saved point values and memberships apply to every answer, unless asked otherwise', async () => {
    const client = await serve({
      savedWallets: 'account',
      store: new JsonWalletStore(
        catalog,
        memoryBackend(
          JSON.stringify({
            version: 1,
            valuations: { UR: 2 },
            memberships: ['amazon-prime'],
            cards: [{ id: 'amex-gold', cap_usage: {}, activated: [] }],
          }),
        ),
        'your saved wallet',
      ),
    })
    const best = await client.callTool({
      name: 'best_cards_for',
      arguments: { category: 'dining' },
    })
    expect(text(best)).toMatch(/ \d\. Chase Sapphire Preferred Card +6%/)
    const flat = await client.callTool({
      name: 'best_cards_for',
      arguments: { category: 'dining', valuation: 'flat' },
    })
    expect(text(flat)).not.toMatch(/ 1\. Chase Sapphire Preferred Card/)
    const amazon = await client.callTool({
      name: 'best_cards_for',
      arguments: { merchant: 'Amazon' },
    })
    expect(text(amazon)).toMatch(/Prime Visa +5%/)
    const sheet = await client.callTool({
      name: 'cheat_sheet',
      arguments: { everyCard: true },
    })
    expect(text(sheet)).toMatch(/not just the user's saved cards/)
  })

  test("every tool's answer matches its declared output schema", async () => {
    // A client that has listed the tools checks each answer against its
    // outputSchema, as Claude Desktop does.
    const parsed = parseWalletYaml(
      await readFile(EXAMPLE_WALLET, 'utf8'),
      catalog,
    )
    if (typeof parsed === 'string') throw new Error(parsed)
    const client = await serve({
      savedWallets: 'account',
      store: new JsonWalletStore(
        catalog,
        memoryBackend(JSON.stringify(parsed)),
        'your saved wallet',
      ),
    })
    const { tools } = await client.listTools()
    const calls: [string, Record<string, unknown>][] = [
      ['list_wallet', {}],
      ['best_card_for_purchase', { merchant: 'Whole Foods', amount: 80 }],
      [
        'best_card_for_purchase',
        { merchant: 'Costco', cards: [{ cardId: 'amex-gold' }] },
      ],
      ['resolve_merchant', { merchant: 'Costco' }],
      ['cheat_sheet', {}],
      ['cheat_sheet', { everyCard: true, noAnnualFee: true }],
      ['best_cards_for', { category: 'gas' }],
      ['simulate_spending', {}],
      ['simulate_spending', { compareToWallet: true }],
      ['compare_welcome_offers', {}],
      ['search_cards', { query: 'gold' }],
      ['add_card', { cardId: 'chase-freedom-unlimited' }],
      [
        'update_card',
        { cardId: 'chase-freedom-unlimited', checkoutLabel: 'CFU' },
      ],
      [
        'record_purchase',
        { cardId: 'amex-gold', merchant: 'Whole Foods', amount: 20 },
      ],
      ['set_memberships', { memberships: ['amazon-prime', 'costco'] }],
      [
        'set_point_values',
        { values: { 'Chase points': 1.5 }, profile: 'points-heavy' },
      ],
      ['remove_card', { cardId: 'chase-freedom-unlimited' }],
      ['export_wallet', {}],
      [
        'delete_wallet',
        { confirm: true, cards: parsed.cards.length, saved: 5 },
      ],
      ['switch_wallet', {}],
    ]
    const called = new Set<string>()
    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError, `${name}: ${text(result)}`).toBeFalsy()
      called.add(name)
    }
    expect(
      tools
        .map((t) => t.name)
        .filter((n) => !called.has(n) && n !== 'import_wallet'),
    ).toEqual([])
  })

  test('an account wallet exports, imports and deletes', async () => {
    const backend = memoryBackend()
    const client = await serve({
      savedWallets: 'account',
      store: new JsonWalletStore(catalog, backend, 'your saved wallet'),
    })
    const names = (await client.listTools()).tools.map((t) => t.name)
    for (const name of SAVED_WALLET_TOOLS) expect(names).toContain(name)

    const imported = await client.callTool({
      name: 'import_wallet',
      arguments: {
        yaml: 'memberships: [amazon-prime]\ncards:\n  - id: chase-prime-visa\n  - id: amex-gold\n    checkout_label: Gold\n',
      },
    })
    expect(text(imported)).toMatch(/Imported a wallet with 2 cards/)
    const exported = await client.callTool({
      name: 'export_wallet',
      arguments: {},
    })
    expect(text(exported)).toMatch(/- id: amex-gold\n\s+checkout_label: Gold/)
    expect(text(exported)).toContain('amazon-prime')

    const notWallet = await client.callTool({
      name: 'import_wallet',
      arguments: { yaml: 'cards:\n  - id: not-a-card\n' },
    })
    expect(notWallet.isError).toBe(true)

    const cardNumber = await client.callTool({
      name: 'import_wallet',
      arguments: {
        yaml: 'cards:\n  - id: amex-gold\n    checkout_label: 3782 822463 10006\n',
        replace: true,
      },
    })
    expect(cardNumber.isError).toBe(true)
    expect(text(cardNumber)).toMatch(/looks like it has a card number/)
    expect(await backend.read()).not.toContain('3782')

    const over = { yaml: 'cards:\n  - id: amex-gold\n' }
    const refused = await client.callTool({
      name: 'import_wallet',
      arguments: over,
    })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toMatch(
      /replace what's saved: 2 cards \(chase-prime-visa, amex-gold\) and Amazon Prime\./,
    )
    const replaced = await client.callTool({
      name: 'import_wallet',
      arguments: { ...over, replace: true },
    })
    expect(text(replaced)).toMatch(
      /Replaced what was saved \(.*\) with the imported wallet: 1 card \(amex-gold\)\./,
    )

    const unconfirmed = await client.callTool({
      name: 'delete_wallet',
      arguments: {},
    })
    expect(unconfirmed.isError).toBe(true)
    expect(await backend.read()).not.toBeNull()
    await client.callTool({
      name: 'delete_wallet',
      arguments: { confirm: true, cards: 1 },
    })
    expect(await backend.read()).toBeNull()
    const after = await client.callTool({ name: 'list_wallet', arguments: {} })
    expect(text(after)).toMatch(/saved wallet has no cards yet/)
    const stale = await client.callTool({
      name: 'delete_wallet',
      arguments: { confirm: true, cards: 1 },
    })
    expect(stale.isError).toBe(true)
    expect(text(stale)).toMatch(/holds nothing, not what the user confirmed/)
    const empty = await client.callTool({
      name: 'delete_wallet',
      arguments: { confirm: true, cards: 0 },
    })
    expect(empty.isError).toBeFalsy()
  })

  test('import and delete count memberships and point values, not just cards', async () => {
    const backend = memoryBackend(
      JSON.stringify({
        version: 1,
        memberships: ['amazon-prime'],
        valuations: { UR: 1.5 },
        cards: [],
      }),
    )
    const client = await serve({
      savedWallets: 'account',
      store: new JsonWalletStore(catalog, backend, 'your saved wallet'),
    })
    const imported = await client.callTool({
      name: 'import_wallet',
      arguments: { yaml: 'cards:\n  - id: amex-gold\n' },
    })
    expect(text(imported)).toMatch(
      /replace what's saved: Amazon Prime and Chase Ultimate Rewards \(UR\) at 1\.5¢/,
    )
    const deleted = await client.callTool({
      name: 'delete_wallet',
      arguments: { confirm: true, cards: 0 },
    })
    expect(text(deleted)).toMatch(/pass cards: 0 and saved: 2/)
    expect(await backend.read()).not.toBeNull()
    await client.callTool({
      name: 'delete_wallet',
      arguments: { confirm: true, cards: 0, saved: 2 },
    })
    expect(await backend.read()).toBeNull()
  })

  test('the tool lists cover every tool, and only hosted wallets add account tools', async () => {
    const names = async (saving: WalletSaving) =>
      (await (await serve(saving)).listTools()).tools.map((t) => t.name).sort()
    expect(
      await names({
        savedWallets: 'account',
        store: new JsonWalletStore(catalog, memoryBackend(), 'x'),
      }),
    ).toEqual([...ANSWER_TOOLS, ...SAVED_WALLET_TOOLS].sort())
    expect(
      await names({
        savedWallets: 'file',
        store: new JsonWalletStore(catalog, memoryBackend(), 'x'),
      }),
    ).toEqual(
      [
        ...ANSWER_TOOLS,
        ...SAVED_WALLET_TOOLS.filter(
          (n) => !n.endsWith('_wallet') || n === 'list_wallet',
        ),
      ].sort(),
    )
  })

  test('from no wallet to a recommendation', async () => {
    const file = await missingWallet()
    const client = await connect(file)

    const before = await client.callTool({ name: 'list_wallet', arguments: {} })
    expect(before.isError).toBeFalsy()
    expect(text(before)).toMatch(
      /no saved wallet yet.*search_cards.*add_card/is,
    )
    expect(before.structuredContent).toEqual({
      memberships: [],
      membershipNames: [],
      pointValues: [],
      started: null,
      cards: [],
      checklist: [],
    })

    for (const [name, args] of [
      ['best_card_for_purchase', { merchant: 'Whole Foods' }],
      ['cheat_sheet', {}],
      ['compare_welcome_offers', {}],
    ] as const) {
      const empty = await client.callTool({ name, arguments: args })
      expect(empty.isError, name).toBeFalsy()
    }
    const record = await client.callTool({
      name: 'record_purchase',
      arguments: { cardId: 'amex-gold', merchant: 'Whole Foods', amount: 10 },
    })
    expect(record.isError).toBe(true)

    const found = await client.callTool({
      name: 'search_cards',
      arguments: { query: 'amex blue cash preferred' },
    })
    const ids = (found.structuredContent as { cards: { id: string }[] }).cards
    expect(ids.map((c) => c.id)).toEqual(['amex-blue-cash-preferred'])

    const added = await client.callTool({
      name: 'add_card',
      arguments: { cardId: 'amex-blue-cash-preferred', checkoutLabel: 'BCP' },
    })
    expect(added.isError).toBeFalsy()
    expect(added.structuredContent).toMatchObject({
      created: true,
      cardIds: ['amex-blue-cash-preferred'],
    })
    expect(text(added)).toMatch(/Nothing else to set up/)

    const prime = await client.callTool({
      name: 'add_card',
      arguments: { cardId: 'chase-prime-visa' },
    })
    expect(text(prime)).toMatch(/amazon-prime/)
    await client.callTool({
      name: 'set_memberships',
      arguments: { memberships: ['amazon-prime'] },
    })

    const best = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Amazon', channel: 'online' },
    })
    expect((best.structuredContent as Recommendation).decision?.cardId).toBe(
      'chase-prime-visa',
    )
    expect(await readFile(file, 'utf8')).toContain(
      'memberships: [amazon-prime]\ncards:\n  - id: amex-blue-cash-preferred\n    checkout_label: BCP\n  - id: chase-prime-visa\n',
    )
  })

  test('picks are checked against the card and saved for this period', async () => {
    const file = await walletCopy()
    const client = await connect(file)
    const bad = await client.callTool({
      name: 'update_card',
      arguments: {
        cardId: 'usbank-cash-plus',
        picks: { 'two-percent': ['dining'] },
      },
    })
    expect(bad.isError).toBe(true)
    expect(text(bad)).toMatch(
      /Options: gas-ev-charging, grocery-stores, restaurants/,
    )

    const good = await client.callTool({
      name: 'update_card',
      arguments: {
        cardId: 'usbank-cash-plus',
        picks: { 'two-percent': ['restaurants'] },
      },
    })
    expect(good.isError).toBeFalsy()
    expect(text(good)).toMatch(/: 2% picks: restaurants\./)
    const wallet = await client.callTool({ name: 'list_wallet', arguments: {} })
    const cashPlus = (wallet.structuredContent as WalletSummary).cards.find(
      (c) => c.cardId === 'usbank-cash-plus',
    )
    expect(cashPlus?.chosen).toMatchObject({
      period: '2026-Q4',
      current: true,
      picks: {
        'five-percent': ['tv-internet-streaming', 'movie-theaters'],
        'two-percent': ['restaurants'],
      },
    })
    const gas = await client.callTool({
      name: 'update_card',
      arguments: {
        cardId: 'usbank-cash-plus',
        picks: { 'two-percent': ['gas-ev-charging'] },
      },
    })
    expect(text(gas)).toMatch(/2% picks: gas stations and EV charging\./)
  })

  test('a wallet can hold memberships with no cards', async () => {
    const client = await connect(
      await walletCopy(
        'memberships: [amazon-prime]\ncards:\n  - id: amex-gold\n',
      ),
    )
    const removed = await client.callTool({
      name: 'remove_card',
      arguments: { cardId: 'amex-gold' },
    })
    expect(text(removed)).toMatch(/no cards now; answers cover every card/)
    const best = await client.callTool({
      name: 'best_cards_for',
      arguments: { merchant: 'Amazon' },
    })
    expect(text(best)).toMatch(/With your Amazon Prime/)
    const listed = await client.callTool({ name: 'list_wallet', arguments: {} })
    expect(text(listed)).toMatch(/has no cards yet/)
    expect(text(listed)).toMatch(/Memberships: Amazon Prime \(amazon-prime\)\./)
  })
})

describe('category from the caller', () => {
  test('an unknown merchant uses it, labeled and at medium confidence', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: {
        merchant: "Lucky's Market",
        amount: 60,
        category: 'grocery.supermarket',
      },
    })
    const rec = result.structuredContent as Recommendation
    expect(rec.merchant).toMatchObject({
      source: 'caller',
      category: 'grocery.supermarket',
    })
    expect(rec.decision).toMatchObject({
      cardId: 'amex-blue-cash-preferred',
      confidence: 'medium',
    })
    expect(rec.warnings.join(' ')).toMatch(/category given with the request/)
  })

  test('a merchant earnrate knows ignores it', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'resolve_merchant',
      arguments: { merchant: 'Costco', category: 'dining' },
    })
    expect(result.structuredContent).toMatchObject({
      source: 'override',
      category: 'warehouse_club',
    })
  })

  test('only real category ids are accepted, and the tool lists them', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: "Lucky's Market", category: 'groceries' },
    })
    expect(result.isError).toBe(true)
    const { tools } = await client.listTools()
    const best = tools.find((t) => t.name === 'best_card_for_purchase')
    expect(JSON.stringify(best?.inputSchema)).toMatch(
      /grocery\.supermarket \(Supermarkets\)/,
    )
  })

  test('it comes before the paid Claude fallback', async () => {
    const calls: string[] = []
    const llm = createLlmSession({
      classifier: (merchant) => {
        calls.push(merchant)
        return Promise.reject(new Error('should not be called'))
      },
      cache: memoryCache(),
      maxCalls: 5,
      today: () => TODAY,
    })
    const client = await connect(await walletCopy(), llm)
    await client.callTool({
      name: 'best_card_for_purchase',
      arguments: {
        merchant: "Lucky's Market",
        category: 'grocery.supermarket',
      },
    })
    expect(calls).toEqual([])
  })
})

test("the local server logs stores it doesn't recognize, and only those", async () => {
  const notes: string[] = []
  const client = await serve(
    {
      savedWallets: 'file',
      store: new FileWalletStore(catalog, await walletCopy()),
    },
    null,
    {
      note: (name, category) => {
        notes.push(`${name}|${String(category)}`)
        return Promise.resolve()
      },
    },
  )
  for (const merchant of ['Tacos El Gordo', 'Costco', 'a restaurant'])
    await client.callTool({ name: 'resolve_merchant', arguments: { merchant } })
  await client.callTool({
    name: 'best_card_for_purchase',
    arguments: { merchant: "Joe's Diner", category: 'dining' },
  })
  expect(notes).toEqual(['Tacos El Gordo|null', "Joe's Diner|dining"])
})

describe('category words', () => {
  test('ignore leading and trailing filler, and accept singular forms', async () => {
    const client = await connect(await walletCopy())
    const category = async (merchant: string) =>
      (
        (
          await client.callTool({
            name: 'resolve_merchant',
            arguments: { merchant },
          })
        ).structuredContent as { category: string; source: string }
      ).category
    expect(await category('a restaurant')).toBe('dining')
    expect(await category('the grocery store')).toBe('grocery.supermarket')
    expect(await category('a gas station near me')).toBe('gas')
    expect(await category('a drugstore')).toBe('drugstore')
    expect(
      (
        (
          await client.callTool({
            name: 'resolve_merchant',
            arguments: { merchant: 'The Home Depot' },
          })
        ).structuredContent as { resolvedName: string }
      ).resolvedName,
    ).toBe('The Home Depot')
  })

  test('work like stores in best_card_for_purchase', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'restaurants', amount: 50 },
    })
    const rec = result.structuredContent as Recommendation
    expect(rec.merchant).toMatchObject({
      source: 'category',
      category: 'dining',
    })
    expect(rec.decision).toMatchObject({
      cardId: 'amex-gold',
      confidence: 'high',
    })
    expect(text(result)).not.toMatch(/doesn't recognize/)
  })

  test('work like stores in best_cards_for', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'best_cards_for',
      arguments: { merchant: 'groceries' },
    })
    expect(result.structuredContent).toMatchObject({
      merchant: { source: 'category', category: 'grocery.supermarket' },
    })
  })

  test('give way to a different category from the caller', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'resolve_merchant',
      arguments: { merchant: 'restaurants', category: 'grocery.supermarket' },
    })
    expect(result.structuredContent).toMatchObject({
      source: 'caller',
      category: 'grocery.supermarket',
    })
  })

  test('best_cards_for uses the caller category for an unknown merchant', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'best_cards_for',
      arguments: {
        merchant: "Lucky's Market",
        category: 'grocery.supermarket',
      },
    })
    expect(result.structuredContent).toMatchObject({
      merchant: { source: 'caller', category: 'grocery.supermarket' },
    })
  })
})

describe('record_purchase', () => {
  test('golden #16 end to end: recording $6,000 flips the next pick', async () => {
    const file = await walletCopy()
    const client = await connect(file)
    const ask = async () =>
      (
        (
          await client.callTool({
            name: 'best_card_for_purchase',
            arguments: { merchant: 'Whole Foods', channel: 'in_store' },
          })
        ).structuredContent as Recommendation
      ).decision?.cardId

    expect(await ask()).toBe('amex-blue-cash-preferred')
    const recorded = await client.callTool({
      name: 'record_purchase',
      arguments: {
        cardId: 'amex-blue-cash-preferred',
        merchant: 'Whole Foods',
        amount: 6000,
        channel: 'in_store',
      },
    })
    expect(recorded.structuredContent).toMatchObject({
      recorded: true,
      booking: { capKey: 'us-supermarkets', before: 0, after: 6000 },
    })
    expect(text(recorded)).toMatch(
      /\$0 → \$6,000 of \$6,000 for 2026, \$0 left/,
    )
    expect(await ask()).toBe('chase-prime-visa')
  })

  test('changes only the cap_usage lines of the wallet file', async () => {
    const file = await walletCopy()
    const before = await readFile(file, 'utf8')
    const client = await connect(file)
    for (const amount of [50, 25.5]) {
      await client.callTool({
        name: 'record_purchase',
        arguments: {
          cardId: 'amex-blue-cash-preferred',
          merchant: 'Whole Foods',
          amount,
        },
      })
    }
    const after = await readFile(file, 'utf8')
    const added = after
      .split('\n')
      .filter((l) => !before.split('\n').includes(l))
    expect(added).toEqual([
      '    cap_usage:',
      '      us-supermarkets: { period: "2026", spent: 75.5 }',
    ])
    expect(after.replace(added.map((l) => `${l}\n`).join(''), '')).toBe(before)
  })

  test('adds to an existing cap_usage map and keeps comments', async () => {
    const yaml = [
      '# my cards',
      'cards:',
      '  - id: usbank-cash-plus # the U.S. Bank one',
      '    chosen:',
      '      period: 2026-Q4',
      '      picks:',
      '        five-percent: [tv-internet-streaming, movie-theaters]',
      '        two-percent: [gas-ev-charging]',
      '    cap_usage:',
      '      five-percent-combined: { period: 2026-Q3, spent: 1999 } # last quarter',
      '  - id: amex-blue-cash-preferred',
      '    cap_usage:',
      '      us-supermarkets: { period: "2026", spent: 100 }',
      '',
    ].join('\n')
    const file = await walletCopy(yaml)
    const client = await connect(file)
    await client.callTool({
      name: 'record_purchase',
      arguments: {
        cardId: 'usbank-cash-plus',
        merchant: 'Comcast',
        amount: 120,
      },
    })
    await client.callTool({
      name: 'record_purchase',
      arguments: {
        cardId: 'amex-blue-cash-preferred',
        merchant: 'Whole Foods',
        amount: 20,
      },
    })
    expect(await readFile(file, 'utf8')).toBe(
      yaml
        .replace(
          '{ period: 2026-Q3, spent: 1999 } # last quarter',
          '{ period: 2026-Q4, spent: 120 } # last quarter',
        )
        .replace('spent: 100 }', 'spent: 120 }'),
    )
  })

  test('purchases recorded at the same time are all counted', async () => {
    const file = await walletCopy()
    const client = await connect(file)
    await Promise.all(
      [10, 20, 30, 40].map((amount) =>
        client.callTool({
          name: 'record_purchase',
          arguments: {
            cardId: 'amex-blue-cash-preferred',
            merchant: 'Whole Foods',
            amount,
          },
        }),
      ),
    )
    expect(await readFile(file, 'utf8')).toMatch(
      /us-supermarkets: \{ period: "2026", spent: 100 \}/,
    )
  })

  test('a purchase with no cap is acknowledged and nothing is written', async () => {
    const file = await walletCopy()
    const before = await readFile(file, 'utf8')
    const client = await connect(file)
    const result = await client.callTool({
      name: 'record_purchase',
      arguments: { cardId: 'sofi-unlimited-2', merchant: 'Target', amount: 40 },
    })
    expect(result.structuredContent).toMatchObject({ recorded: false })
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  test('an unknown card is a tool error that lists the real ones', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'record_purchase',
      arguments: {
        cardId: 'chase-sapphire-reserve',
        merchant: 'Delta',
        amount: 300,
      },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/isn't in the wallet\. Cards: amex-gold/)
  })
})

describe('Claude fallback through the server', () => {
  test('uses the shared session and marks tools as reaching outside', async () => {
    const calls: string[] = []
    const classifier: Classifier = (merchant) => {
      calls.push(merchant)
      return Promise.resolve({
        category: 'dining',
        likelyMcc: 5812,
        mayCodeAs: [],
        confidence: 'medium',
        rationale: 'A restaurant.',
        model: 'fake-model',
      })
    }
    const llm = createLlmSession({
      classifier,
      cache: memoryCache(),
      maxCalls: 1,
      today: () => TODAY,
    })
    const client = await connect(await walletCopy(), llm)
    const { tools } = await client.listTools()
    expect(
      tools.find((t) => t.name === 'best_card_for_purchase')?.annotations,
    ).toMatchObject({ openWorldHint: true })

    const first = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Bestia' },
    })
    expect((first.structuredContent as Recommendation).merchant.source).toBe(
      'llm',
    )
    const second = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Tiny Bookshop' },
    })
    expect(calls).toEqual(['Bestia'])
    expect(
      (second.structuredContent as Recommendation).warnings.join(' '),
    ).toMatch(/already made 1 calls/)
  })
})

test('the stdio server answers a real client', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'src/mcp/bin.ts')],
    env: {
      ...process.env,
      EARNRATE_MISSED_MERCHANTS: 'off',
      [WALLET_ENV_VAR]: EXAMPLE_WALLET,
    },
  })
  const client = new Client({ name: 'earnrate-stdio-test', version: '0.0.0' })
  await client.connect(transport)
  cleanups.push(() => client.close())
  const result = await client.callTool({
    name: 'best_card_for_purchase',
    arguments: { merchant: 'netflix' },
  })
  expect((result.structuredContent as Recommendation).decision?.cardId).toBe(
    'amex-blue-cash-preferred',
  )
})

describe('welcome bonuses', () => {
  const BONUS_WALLET = `cards:
  - id: amex-blue-cash-preferred
  - id: chase-sapphire-preferred
    checkout_label: Sapphire Preferred
    bonus: { opened: 2026-10-01, spend: 4000, by: 2026-12-31, points: 75000, spent: 500 }
`

  test('record_purchase counts toward an open bonus', async () => {
    const file = await walletCopy(BONUS_WALLET)
    const client = await connect(file)
    const result = await client.callTool({
      name: 'record_purchase',
      arguments: {
        cardId: 'chase-sapphire-preferred',
        merchant: 'Etsy',
        amount: 250,
        date: TODAY,
      },
    })
    expect(result.structuredContent).toMatchObject({
      recorded: true,
      booking: null,
      bonus: { before: 500, after: 750, spend: 4000 },
    })
    expect(text(result)).toMatch(
      /\$750 of \$4,000 spent, \$3,250 to go by 2026-12-31/,
    )
    expect(await readFile(file, 'utf8')).toMatch(/spent: 750 \}/)
  })

  test('best_card_for_purchase and list_wallet report it', async () => {
    const client = await connect(await walletCopy(BONUS_WALLET))
    const best = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Whole Foods', amount: 80 },
    })
    expect((best.structuredContent as Recommendation).bonus).toMatchObject({
      cardId: 'chase-sapphire-preferred',
      remaining: 3500,
    })
    const listed = await client.callTool({ name: 'list_wallet', arguments: {} })
    const summary = listed.structuredContent as WalletSummary
    expect(
      summary.cards.find((c) => c.cardId === 'chase-sapphire-preferred')?.bonus,
    ).toMatchObject({ state: 'open', remaining: 3500, value: 750 })
  })
})

test('list_wallet handles a monthly cap', async () => {
  const client = await connect(
    await walletCopy('cards:\n  - id: citi-custom-cash\n'),
  )
  const listed = await client.callTool({ name: 'list_wallet', arguments: {} })
  expect(listed.isError).toBeFalsy()
  expect(
    (listed.structuredContent as WalletSummary).cards[0]?.caps[0]?.period,
  ).toBe('month')
})
