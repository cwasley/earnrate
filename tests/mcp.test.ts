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
import { DETAILS_LEFT_OUT } from '../src/engine/card-details.ts'
import type { CheatSheet } from '../src/engine/cheat-sheet.ts'
import { feeWorthKit, TRANSFER_VALUES } from '../src/engine/fee-worth.ts'
import { wholeDollars } from '../src/engine/text.ts'
import type { Recommendation } from '../src/engine/types.ts'
import type { WalletSummary } from '../src/engine/wallet-summary.ts'
import { PROMPTS } from '../src/mcp/prompts.ts'
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

  test('named cards can carry credits enrolled in and an opening date', async () => {
    const client = await connect(await walletCopy())
    const credit = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: {
        merchant: 'Lululemon',
        amount: 100,
        cards: [{ cardId: 'amex-platinum', enrolled: ['lululemon'] }],
      },
    })
    expect(credit.isError, text(credit)).toBeFalsy()
    expect(text(credit)).toMatch(/\$75 back from its Lululemon credit/)
    const intro = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: {
        merchant: 'Chipotle',
        cards: [{ cardId: 'discover-it-cash-back', opened: '2026-03-04' }],
      },
    })
    expect(text(intro)).toMatch(/in your first year/)
    const bad = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: {
        merchant: 'Chipotle',
        cards: [{ cardId: 'discover-it-cash-back', opened: 'March' }],
      },
    })
    expect(bad.isError).toBe(true)
  })

  test('compare_welcome_offers takes the memberships the user names', async () => {
    const client = await connect(await walletCopy())
    const known = await client.callTool({
      name: 'compare_welcome_offers',
      arguments: { memberships: ['costco'] },
    })
    expect(known.isError, text(known)).toBeFalsy()
    const unknown = await client.callTool({
      name: 'compare_welcome_offers',
      arguments: { memberships: ['not-a-membership'] },
    })
    expect(unknown.isError).toBe(true)
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

  test('a cardmember-year cap is recorded for this cardmember year', async () => {
    const client = await connect(
      await walletCopy(
        'cards:\n  - id: chase-ink-business-cash\n    anniversary: "03-15"\n',
      ),
    )
    const recorded = await client.callTool({
      name: 'record_purchase',
      arguments: {
        cardId: 'chase-ink-business-cash',
        merchant: 'Staples',
        amount: 200,
      },
    })
    expect(recorded.isError, text(recorded)).toBeFalsy()
    expect(text(recorded)).toMatch(
      /\$0 → \$200 of \$25,000 this cardmember year, \$24,800 left\./,
    )
    expect(text(recorded)).not.toMatch(/for 20\d\d/)
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
      /reaches the \$15,000 calendar-year spend: 10,000 bonus points, worth about \$50, plus Gold Elite status/,
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
      /Spend on IHG One Rewards this year: \$15,050\. That reaches its \$15,000 spend bonus\./,
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
    expect(text(wrong)).toMatch(/no spend bonus 'spend-99k'.*spend-15k/)
  })

  test('country: abroad, cards rank after their foreign transaction fees', async () => {
    const client = await connect(await walletCopy())
    const abroad = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Etsy', amount: 100, country: 'fr' },
    })
    expect(abroad.isError, text(abroad)).toBeFalsy()
    expect(text(abroad)).toMatch(
      /charge foreign transaction fees here, already subtracted/,
    )
    const bad = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Etsy', country: 'France' },
    })
    expect(bad.isError).toBe(true)
    const every = await client.callTool({
      name: 'best_cards_for',
      arguments: { category: 'dining', country: 'JP', issuer: 'wells-fargo' },
    })
    const ranked = (
      every.structuredContent as { ranked: { foreignFee: number | null }[] }
    ).ranked
    expect(ranked.some((r) => r.foreignFee === 3)).toBe(true)
    const found = await client.callTool({
      name: 'search_cards',
      arguments: { query: 'double cash' },
    })
    expect(text(found)).toMatch(/3% foreign transaction fee/)
  })

  test('payment: a rate that needs a way of paying counts only when given', async () => {
    const client = await connect(await walletCopy())
    const cards = [
      { cardId: 'paypal-cashback-mastercard' },
      { cardId: 'citi-double-cash' },
    ]
    type Answer = {
      decision: { cardId: string; effectiveReturnPct: number }
      assumptions: string[]
    }
    const unknown = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'etsy.com', cards },
    })
    expect(unknown.isError, text(unknown)).toBeFalsy()
    const plain = unknown.structuredContent as Answer
    expect(plain.decision.cardId).toBe('citi-double-cash')
    expect(plain.assumptions).toContain(
      "Through PayPal checkout, PayPal Cashback Mastercard would earn 3% cash back here, instead of the 1.5% cash back it's ranked at. Say how you're paying to count it.",
    )
    const paid = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'etsy.com', cards, payment: 'paypal' },
    })
    expect((paid.structuredContent as Answer).decision).toMatchObject({
      cardId: 'paypal-cashback-mastercard',
      effectiveReturnPct: 3,
    })
    const bad = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'etsy.com', payment: 'venmo' },
    })
    expect(bad.isError).toBe(true)
    const every = await client.callTool({
      name: 'best_cards_for',
      arguments: { merchant: 'Nike', payment: 'apple-pay' },
    })
    const top = (every.structuredContent as { ranked: { cardId: string }[] })
      .ranked
    expect(top.map((r) => r.cardId)).toContain('apple-card')
  })

  test('settings that change nothing say so', async () => {
    const client = await connect(await walletCopy())
    const anniversary = await client.callTool({
      name: 'update_card',
      arguments: { cardId: 'citi-double-cash', anniversary: '03-14' },
    })
    expect(text(anniversary)).toMatch(
      /anniversary 03-14\. It has no annual fee and none of its caps reset on the account anniversary, so earnrate doesn't use it\./,
    )
    const feeCard = await client.callTool({
      name: 'update_card',
      arguments: { cardId: 'amex-gold', anniversary: '03-14' },
    })
    expect(text(feeCard)).not.toMatch(/doesn't use it/)
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
      /Cap on the 2 categories you pick each quarter: .* \(cap key five-percent-combined\)/,
    )
    expect(text(result)).toMatch(/^Memberships: /m)
    expect(text(result)).toMatch(
      /^To do now:\n- Activate Freedom Flex's bonus at grocery stores, /m,
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

describe('prompts', () => {
  const promptText = (result: { messages: { content: unknown }[] }) =>
    result.messages
      .map((m) => (m.content as { text?: string }).text ?? '')
      .join('\n')

  test('lists the four, with titles and arguments', async () => {
    const client = await connect(await walletCopy())
    const { prompts } = await client.listPrompts()
    expect(prompts.map((p) => p.name)).toEqual(PROMPTS)
    for (const p of prompts) {
      expect(p.title, p.name).toBeTruthy()
      expect(p.description?.length, p.name).toBeGreaterThan(40)
    }
    expect(prompts.find((p) => p.name === 'which-card')?.arguments).toEqual([
      expect.objectContaining({ name: 'store', required: true }),
      expect.objectContaining({ name: 'amount', required: false }),
      expect.objectContaining({ name: 'country', required: false }),
      expect.objectContaining({ name: 'paying', required: false }),
    ])
    for (const name of ['cheat-sheet', 'this-quarter', 'set-up'])
      expect(prompts.find((p) => p.name === name)?.arguments ?? []).toEqual([])
  })

  test('which-card names the tool and the store, with or without an amount', async () => {
    const client = await connect(await walletCopy())
    const plain = promptText(
      await client.getPrompt({
        name: 'which-card',
        arguments: { store: 'Whole Foods' },
      }),
    )
    expect(plain).toMatch(/^Which credit card should I use at Whole Foods\?/)
    expect(plain).toContain(
      'best_card_for_purchase with merchant "Whole Foods".',
    )
    expect(plain).not.toMatch(/amount/)
    expect(plain).toMatch(/paying abroad .* pass `country`/)

    const priced = promptText(
      await client.getPrompt({
        name: 'which-card',
        arguments: { store: 'Costco', amount: '120', country: 'France' },
      }),
    )
    expect(priced).toMatch(
      /^Which credit card should I use at Costco for \$120 in France\?/,
    )
    expect(priced).toContain('merchant "Costco", amount "120"')
    expect(priced).toContain('country as the two-letter code for "France"')
    expect(priced).not.toMatch(/paying abroad/)
  })

  test('no prompt asks for card numbers or restates a rate', async () => {
    for (const saving of [
      'file',
      'account',
    ] as const satisfies WalletSaving['savedWallets'][]) {
      const client =
        saving === 'file'
          ? await connect(await walletCopy())
          : await serve({
              savedWallets: 'account',
              store: new JsonWalletStore(
                catalog,
                memoryBackend(),
                'your saved wallet',
              ),
            })
      for (const name of PROMPTS) {
        const got = promptText(
          await client.getPrompt({
            name,
            arguments: name === 'which-card' ? { store: 'Target' } : {},
          }),
        )
        expect(got, name).not.toMatch(/\d+(\.\d+)?(%|x\b| points)/)
        expect(got, name).not.toMatch(/(give|tell|send) me .*card numbers/i)
      }
    }
  })

  test('set-up and this-quarter say which wallet they use', async () => {
    const local = await connect(await walletCopy())
    const hosted = await serve({
      savedWallets: 'account',
      store: new JsonWalletStore(catalog, memoryBackend(), 'your saved wallet'),
    })
    const get = async (client: Client, name: string) =>
      promptText(await client.getPrompt({ name, arguments: {} }))
    expect(await get(local, 'set-up')).toMatch(/wallet file on this computer/)
    expect(await get(local, 'set-up')).not.toMatch(/recovery code/)
    expect(await get(hosted, 'set-up')).toMatch(/hosted earnrate wallet/)
    expect(await get(hosted, 'set-up')).toMatch(
      /Never ask for the recovery code/,
    )
    expect(await get(hosted, 'this-quarter')).toMatch(
      /list_wallet.*without pressing the user/s,
    )
  })

  test('an unknown prompt or a missing store fails cleanly', async () => {
    const client = await connect(await walletCopy())
    await expect(
      client.getPrompt({ name: 'best-card', arguments: {} }),
    ).rejects.toThrow(/best-card/)
    await expect(
      client.getPrompt({ name: 'which-card', arguments: {} }),
    ).rejects.toThrow(/store/)
  })

  test('the hosted server lists the same prompts', async () => {
    const hosted = await serve({
      savedWallets: 'account',
      store: new JsonWalletStore(catalog, memoryBackend(), 'your saved wallet'),
    })
    const local = await connect(await walletCopy())
    const names = async (client: Client) =>
      (await client.listPrompts()).prompts.map((p) => [
        p.name,
        p.arguments?.map((a) => a.name) ?? [],
      ])
    expect(await names(hosted)).toEqual(await names(local))
  })

  test("the Claude Desktop bundle's manifest lists the same prompts", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(ROOT, 'mcpb', 'manifest.json'), 'utf8'),
    ) as { prompts: { name: string; arguments?: string[] }[] }
    const client = await connect(await walletCopy())
    const { prompts } = await client.listPrompts()
    expect(manifest.prompts.map((p) => [p.name, p.arguments ?? []])).toEqual(
      prompts.map((p) => [p.name, p.arguments?.map((a) => a.name) ?? []]),
    )
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
      /Welcome bonus on Amex Blue Cash Preferred: \$100 of \$3,000/,
    )
    expect(text(recorded)).toMatch(
      /Recorded \$100 on Amex Blue Cash Preferred toward its supermarkets cap:/,
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
      skippedIssuers: [],
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

  test('add_card and update_card set an optional opening date', async () => {
    const file = await walletCopy('cards:\n  - id: amex-gold # mine\n')
    const client = await connect(file)
    const added = await client.callTool({
      name: 'add_card',
      arguments: { cardId: 'bank-of-america-customized-cash-rewards' },
    })
    expect(added.isError).toBeFalsy()
    const bad = await client.callTool({
      name: 'update_card',
      arguments: {
        cardId: 'bank-of-america-customized-cash-rewards',
        opened: '2027-01-01',
      },
    })
    expect(bad.isError).toBe(true)
    const set = await client.callTool({
      name: 'update_card',
      arguments: {
        cardId: 'bank-of-america-customized-cash-rewards',
        opened: '2026-03-04',
        picks: { 'three-percent': ['dining'] },
      },
    })
    expect(text(set)).toMatch(/opened 2026-03-04/)
    expect(await readFile(file, 'utf8')).toContain(
      '  - id: amex-gold # mine\n  - id: bank-of-america-customized-cash-rewards\n    opened: 2026-03-04\n',
    )
    const wallet = await client.callTool({ name: 'list_wallet', arguments: {} })
    expect(
      (wallet.structuredContent as WalletSummary).cards.find(
        (c) => c.cardId === 'bank-of-america-customized-cash-rewards',
      ),
    ).toMatchObject({
      opened: '2026-03-04',
      intro: { state: 'active', until: '2027-03-03', days: 365 },
    })
    expect(text(wallet)).toMatch(
      /Opened 2026-03-04: first-year rates through Mar 3, 2027\./,
    )
    const best = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Chipotle', channel: 'in_store' },
    })
    expect(
      (best.structuredContent as Recommendation).decision?.effectiveReturnPct,
    ).toBeCloseTo(6)
  })

  test('merchant credits: enrolled and used through update_card, listed with what is left, used up by record_purchase', async () => {
    const file = await walletCopy('cards:\n  - id: citi-double-cash # mine\n')
    const client = await connect(file)
    const added = await client.callTool({
      name: 'add_card',
      arguments: { cardId: 'amex-platinum', enrolled: ['lululemon'] },
    })
    expect(added.isError).toBeFalsy()
    const set = await client.callTool({
      name: 'update_card',
      arguments: { cardId: 'amex-platinum', creditUsed: { lululemon: 40 } },
    })
    expect(text(set)).toMatch(/\$40 of the lululemon credit used this period/)
    const wallet = await client.callTool({ name: 'list_wallet', arguments: {} })
    const platinum = (wallet.structuredContent as WalletSummary).cards.find(
      (c) => c.cardId === 'amex-platinum',
    )
    expect(platinum?.credits).toContainEqual(
      expect.objectContaining({ id: 'lululemon', enrolled: true, left: 35 }),
    )
    expect(text(wallet)).toMatch(
      /Credit \(lululemon\): \$75 back each quarter at Lululemon: \$35 left this quarter/,
    )
    expect(text(wallet)).toMatch(/Use your \$75 Lululemon credit on/)
    const best = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Lululemon', amount: 100, channel: 'in_store' },
    })
    const rec = best.structuredContent as Recommendation
    expect(rec.decision?.cardId).toBe('amex-platinum')
    expect(rec.ranked[0]?.credit).toMatchObject({ dollars: 35 })
    expect(text(best)).toMatch(/plus \$35 back from its Lululemon credit/)
    const recorded = await client.callTool({
      name: 'record_purchase',
      arguments: {
        cardId: 'amex-platinum',
        merchant: 'Lululemon',
        amount: 100,
        channel: 'in_store',
      },
    })
    expect(text(recorded)).toMatch(
      /Used \$35 of Amex Platinum's Lululemon credit/,
    )
    expect(text(recorded)).toMatch(
      /Started tracking spend on Amex Platinum this year with this purchase: \$100\. Spending on it earlier this year isn't counted/,
    )
    expect(text(recorded)).not.toMatch(/to go for the/)
    expect(await readFile(file, 'utf8')).toContain(
      '    credit_usage:\n      lululemon: { period: 2026-Q4, used: 75 }\n',
    )
    expect(await readFile(file, 'utf8')).toContain('# mine')
  })

  test("credits the user doesn't use: set through update_card, listed, and out of the fee math", async () => {
    const file = await walletCopy('cards:\n  - id: amex-gold # mine\n')
    const client = await connect(file)
    const set = await client.callTool({
      name: 'update_card',
      arguments: {
        cardId: 'amex-gold',
        enrolled: ['dunkin'],
        skippedCredits: ['uber-cash'],
      },
    })
    expect(text(set)).toMatch(/credits not used: uber-cash/)
    const wallet = await client.callTool({ name: 'list_wallet', arguments: {} })
    const gold = (wallet.structuredContent as WalletSummary).cards[0]
    expect(gold?.credits).toContainEqual(
      expect.objectContaining({ id: 'uber-cash', skipped: true }),
    )
    expect(gold?.usedCredits).toBe(84)
    expect(text(wallet)).toMatch(
      /Amex Gold's credits you use \(Dunkin'\) count against its fee: \$84 a year\./,
    )
    const sim = await client.callTool({
      name: 'simulate_spending',
      arguments: { compareToWallet: true },
    })
    expect(sim.isError).toBeFalsy()
    expect(
      (sim.structuredContent as { current: { heldCredits: number } }).current
        .heldCredits,
    ).toBe(84)
    expect(await readFile(file, 'utf8')).toContain(
      '    skipped_credits: [uber-cash]\n',
    )
  })

  test('a free night: listed, asked about, marked used through update_card, and counted in the renewal check', async () => {
    const file = await walletCopy(
      "cards:\n  - id: chase-ihg-one-rewards-premier # mine\n    anniversary: '11-15'\n",
    )
    const client = await connect(file)
    const search = await client.callTool({
      name: 'search_cards',
      arguments: { query: 'ihg premier' },
    })
    expect(
      (
        search.structuredContent as {
          cards: { id: string; freeNights: { id: string; value: number }[] }[]
        }
      ).cards.find((c) => c.id === 'chase-ihg-one-rewards-premier')?.freeNights,
    ).toEqual([
      expect.objectContaining({ id: 'anniversary-night', value: 250 }),
    ])
    const before = await client.callTool({ name: 'list_wallet', arguments: {} })
    expect(text(before)).toMatch(
      /Do you use IHG One Rewards Premier's anniversary free night\?/,
    )
    expect(text(before)).toMatch(
      /Its anniversary free night \(up to \$250\) isn't counted until you say you use it/,
    )
    const set = await client.callTool({
      name: 'update_card',
      arguments: {
        cardId: 'chase-ihg-one-rewards-premier',
        enrolled: ['anniversary-night'],
      },
    })
    expect(set.isError).toBeFalsy()
    const after = await client.callTool({ name: 'list_wallet', arguments: {} })
    const ihg = (after.structuredContent as WalletSummary).cards[0]
    expect(ihg?.freeNights).toEqual([
      expect.objectContaining({ id: 'anniversary-night', confirmed: true }),
    ])
    expect(ihg?.usedCredits).toBe(250)
    expect(text(after)).not.toMatch(/Do you use/)
    expect(text(after)).toMatch(
      /plus up to \$250 for its anniversary free night: about \$\d+ a year ahead after the fee, but only with the free night at its full value\./,
    )
    expect(await readFile(file, 'utf8')).toContain(
      '    enrolled: [anniversary-night]\n',
    )
  })

  test('best_cards_for puts cards with a store credit first', async () => {
    const client = await connect(await walletCopy())
    const result = await client.callTool({
      name: 'best_cards_for',
      arguments: { merchant: 'Lululemon' },
    })
    expect(
      (result.structuredContent as { credits: { cardId: string }[] }).credits,
    ).toEqual([expect.objectContaining({ cardId: 'amex-platinum' })])
    expect(text(result)).toMatch(
      /^With a statement credit at Lululemon:\n\n- The Platinum Card from American Express: \$75 back each quarter, then 1x Amex Membership Rewards \(enroll first\)/,
    )
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
      /\$750 of \$4,000 spent, \$3,250 to go by Dec 31, 2026/,
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

describe('skipped issuers', () => {
  test('set_memberships saves them, list_wallet shows them, and compare_welcome_offers leaves them out', async () => {
    const file = await walletCopy('cards:\n  - id: citi-double-cash\n')
    const client = await connect(file)
    const set = await client.callTool({
      name: 'set_memberships',
      arguments: { skippedIssuers: ['chase'] },
    })
    expect(set.isError).toBeFalsy()
    expect(JSON.stringify(set.content)).toMatch(
      /Next-card answers now leave out Chase\./,
    )
    const listed = await client.callTool({ name: 'list_wallet', arguments: {} })
    expect((listed.structuredContent as WalletSummary).skippedIssuers).toEqual([
      { id: 'chase', name: 'Chase' },
    ])
    const offers = await client.callTool({
      name: 'compare_welcome_offers',
      arguments: {},
    })
    const ids = (
      offers.structuredContent as { offers: { issuer: string }[] }
    ).offers.map((o) => o.issuer)
    expect(ids).not.toContain('chase')
    const once = await client.callTool({
      name: 'compare_welcome_offers',
      arguments: { skippedIssuers: [] },
    })
    expect(
      (once.structuredContent as { offers: { issuer: string }[] }).offers.some(
        (o) => o.issuer === 'chase',
      ),
    ).toBe(true)
    const neither = await client.callTool({
      name: 'set_memberships',
      arguments: {},
    })
    expect(neither.isError).toBe(true)
  })

  test('the hosted store keeps them', async () => {
    const store = new JsonWalletStore(
      catalog,
      memoryBackend(),
      'your saved wallet',
    )
    const done = await store.setSkippedIssuers(['amex', 'amex'])
    expect(done.ok && done.wallet.skipped_issuers).toEqual(['amex'])
    expect((await store.load())?.skipped_issuers).toEqual(['amex'])
    const cleared = await store.setSkippedIssuers([])
    expect(cleared.ok && cleared.wallet.skipped_issuers).toBeUndefined()
  })
})

describe('search_cards: is the annual fee worth it', () => {
  type Found = {
    detailed: boolean
    cards: {
      id: string
      earning: string[] | null
      feeWorth: {
        breakEven: number | null
        creditsBreakEven: number | null
        centsPerUnit: number
        savedValue: boolean
        transfer: { cents: number; breakEven: number | null } | null
        text: string
      } | null
    }[]
  }
  const search = async (wallet: string, query?: string) => {
    const client = await connect(wallet)
    const found = await client.callTool({
      name: 'search_cards',
      arguments: query === undefined ? {} : { query },
    })
    expect(found.isError, text(found)).toBeFalsy()
    return { text: text(found), result: found.structuredContent as Found }
  }
  const gold = (r: Found) => r.cards.find((c) => c.id === 'amex-gold')
  const card = (id: string) => {
    const c = catalog.cards.find((x) => x.id === id)
    if (!c) throw new Error(id)
    return c
  }

  test("a fee card's rates and the card page's break-even", async () => {
    const { text: answer, result } = await search(
      await walletCopy(),
      'amex gold',
    )
    const worth = feeWorthKit(catalog, TODAY).feeWorth(card('amex-gold'))
    const breakEven = worth?.breakEven ?? null
    expect(breakEven).not.toBeNull()
    const found = gold(result)
    expect(found?.earning?.join('; ')).toMatch(/4x .* at restaurants/)
    expect(found?.feeWorth).toMatchObject({
      breakEven,
      creditsBreakEven: worth?.creditsBreakEven,
      centsPerUnit: 1,
      savedValue: false,
    })
    expect(answer).toContain('    earns: ')
    expect(answer).toContain(
      `is the fee worth it? On earning alone, the Amex Gold earns more than the best no-fee card, after its $325 fee, from about ${wholeDollars(breakEven ?? 0)} a month of spending on supermarkets and restaurants.`,
    )
    const transferred = feeWorthKit(catalog, TODAY, TRANSFER_VALUES).feeWorth(
      card('amex-gold'),
    )
    expect(transferred?.breakEven).not.toBeNull()
    expect(found?.feeWorth?.transfer).toEqual({
      cents: 1.7,
      breakEven: transferred?.breakEven,
    })
    expect(answer).toContain(
      `If you transfer Amex Membership Rewards to airlines and hotels and count them at 1.7¢ each, it comes out ahead from about ${wholeDollars(transferred?.breakEven ?? 0)} a month.`,
    )
  }, 30_000)

  test('a no-fee card gets its rates but no fee line', async () => {
    const { text: answer, result } = await search(
      await walletCopy(),
      'double cash',
    )
    const [found] = result.cards
    expect(found?.earning?.length).toBeGreaterThan(0)
    expect(found?.feeWorth).toBeNull()
    expect(answer).not.toMatch(/fee worth it/)
  }, 30_000)

  test('the saved point values count', async () => {
    const { result } = await search(
      await walletCopy('valuations:\n  MR: 2\ncards: []\n'),
      'amex gold',
    )
    const worth = feeWorthKit(catalog, TODAY, { MR: 2 }).feeWorth(
      card('amex-gold'),
    )
    expect(gold(result)?.feeWorth).toMatchObject({
      breakEven: worth?.breakEven,
      centsPerUnit: 2,
      savedValue: true,
    })
    expect(gold(result)?.feeWorth?.text).toMatch(
      /at 2¢ each \(the saved point value\)/,
    )
    expect(gold(result)?.feeWorth?.transfer).toBeNull()
  }, 30_000)

  test('a search that finds many cards leaves the details out', async () => {
    const { text: answer, result } = await search(await walletCopy())
    expect(result.detailed).toBe(false)
    expect(result.cards.every((c) => c.feeWorth === null)).toBe(true)
    expect(answer).toContain(DETAILS_LEFT_OUT)
  })
})
