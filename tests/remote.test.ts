import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, test } from 'vitest'
import { makeWorker, type Env } from '../remote/src/app.ts'
import { DATA_DIR, loadCatalog } from '../src/data/load.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()
const dataVersion = (await readFile(`${DATA_DIR}VERSION`, 'utf8')).trim()
const worker = makeWorker(
  { catalog, dataVersion, version: '0.0.0-test' },
  () => TODAY,
)

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function connect(env: Env = {}): Promise<Client> {
  const client = new Client(
    { name: 'earnrate-test', version: '0.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL('https://mcp.earnrate.test/mcp'),
      {
        fetch: (url, init) => worker.fetch(new Request(url, init), env),
      },
    ),
  )
  cleanups.push(() => client.close())
  return client
}

function text(result: { content?: unknown }): string {
  const content = (result.content ?? []) as { type: string; text?: string }[]
  return content.map((c) => c.text ?? '').join('\n')
}

describe('remote connector', () => {
  test('offers only the tools that need no saved wallet', async () => {
    const client = await connect()
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain('best_card_for_purchase')
    expect(names).toContain('cheat_sheet')
    for (const saved of [
      'list_wallet',
      'record_purchase',
      'add_card',
      'update_card',
      'remove_card',
      'set_memberships',
    ])
      expect(names).not.toContain(saved)
  })

  test('answers from every card, or from cards named for one answer', async () => {
    const client = await connect()
    const all = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Whole Foods', amount: 80 },
    })
    expect(all.isError).toBeFalsy()
    expect(text(all)).toContain('Whole Foods')
    const named = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: {
        merchant: 'Whole Foods',
        cards: [{ cardId: 'amex-gold' }],
      },
    })
    expect(named.isError).toBeFalsy()
    expect(
      (named.structuredContent as { decision: { cardId: string } }).decision
        .cardId,
    ).toBe('amex-gold')
  })

  test('redirects the root to the website and 404s other paths', async () => {
    const root = await worker.fetch(
      new Request('https://mcp.earnrate.test/'),
      {},
    )
    expect(root.status).toBe(302)
    expect(root.headers.get('location')).toBe('https://earnrate.dev/')
    const other = await worker.fetch(
      new Request('https://mcp.earnrate.test/wallet'),
      {},
    )
    expect(other.status).toBe(404)
  })

  test('refuses requests over the rate limit', async () => {
    const env: Env = {
      LIMITER: { limit: () => Promise.resolve({ success: false }) },
    }
    const res = await worker.fetch(
      new Request('https://mcp.earnrate.test/mcp', {
        method: 'POST',
        body: '{}',
      }),
      env,
    )
    expect(res.status).toBe(429)
  })

  test('counts only the method and tool name, never arguments', async () => {
    const points: { blobs?: string[]; indexes?: string[] }[] = []
    const client = await connect({
      USAGE: { writeDataPoint: (p) => points.push(p) },
    })
    await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Trader Joes', amount: 123.45 },
    })
    expect(points.map((p) => p.blobs)).toContainEqual([
      'tool:best_card_for_purchase',
    ])
    const recorded = JSON.stringify(points)
    expect(recorded).not.toContain('Trader')
    expect(recorded).not.toContain('123')
  })
})
