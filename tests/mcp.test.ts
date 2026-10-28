import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { WALLET_ENV_VAR } from '../src/brand.ts'
import { loadCatalog } from '../src/data/load.ts'
import type { Recommendation } from '../src/engine/types.ts'
import type { WalletSummary } from '../src/engine/wallet-summary.ts'
import { memoryCache } from '../src/merchants/cache.ts'
import type { Classifier } from '../src/merchants/classifier.ts'
import { createLlmSession, type LlmSession } from '../src/merchants/fallback.ts'
import { createEarnrateServer } from '../src/mcp/server.ts'
import { TODAY } from './golden/fixtures.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXAMPLE_WALLET = path.join(ROOT, 'wallet.example.yaml')
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

async function connect(walletFile: string, llm: LlmSession | null = null) {
  const handler = createMcpHandler(() =>
    createEarnrateServer({
      catalog,
      walletFile,
      today: () => TODAY,
      llm,
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

function text(result: { content?: unknown }): string {
  const content = (result.content ?? []) as { type: string; text?: string }[]
  return content.map((c) => c.text ?? '').join('\n')
}

describe('tools', () => {
  test('lists the five tools with descriptions and hints', async () => {
    const client = await connect(await walletCopy())
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'best_card_for_purchase',
      'compare_welcome_offers',
      'list_wallet',
      'record_purchase',
      'resolve_merchant',
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
    expect(text(result)).toMatch(/Cash\+ \(usbank-cash-plus\)/)
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
    env: { ...process.env, [WALLET_ENV_VAR]: EXAMPLE_WALLET },
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
