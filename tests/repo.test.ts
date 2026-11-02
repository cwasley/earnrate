import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
  CONNECTION_IDLE_DAYS,
  RATE_LIMIT_SECONDS,
  RETENTION_MONTHS,
  UNUSED_NEW_WALLET,
} from '../remote/src/policy.ts'
import { loadCatalog } from '../src/data/load.ts'
import { ANSWER_TOOLS, SAVED_WALLET_TOOLS } from '../src/mcp/server.ts'
import { ROOT } from './helpers.ts'

const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?)$/i

function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2
    sum += d
  }
  return sum % 10 === 0
}

function cardNumbers(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(
    /(?<![\w.])[3-6]\d{3}(?:[ -]?\d){9,15}(?![\w.])/g,
  )) {
    const digits = m[0].replace(/[ -]/g, '')
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits))
      found.push(m[0])
  }
  return found
}

test('cardNumbers finds card-shaped numbers and skips other long numbers', () => {
  const visa = `4111${' 1111'.repeat(3)}`
  expect(cardNumbers(`pay ${visa} by Friday`)).toEqual([visa])
  expect(cardNumbers(`ref 4111${'1111'.repeat(3)}`)).toHaveLength(1)
  expect(cardNumbers('order 4111111111111112')).toEqual([])
  expect(cardNumbers('sha 9f4111111111111111a1')).toEqual([])
  expect(cardNumbers('2026-10-27 $1,234.56')).toEqual([])
})

test('no committed file contains a card number', async () => {
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\0')
    .filter((f) => f && !BINARY.test(f))
  const hits: string[] = []
  for (const file of files) {
    let text
    try {
      text = await readFile(path.join(ROOT, file), 'utf8')
    } catch {
      continue
    }
    if (cardNumbers(text).length > 0) hits.push(file)
  }
  expect(hits).toEqual([])
})

const readJson = async (file: string) =>
  JSON.parse(await readFile(path.join(ROOT, file), 'utf8')) as Record<
    string,
    unknown
  >

test('the MCP registry entry and Claude Desktop bundle match package.json', async () => {
  const pkg = await readJson('package.json')
  const server = await readJson('server.json')
  const packages = server.packages as { identifier: string; version: string }[]
  expect(server.name).toBe(pkg.mcpName)
  expect(server.version).toBe(pkg.version)
  expect(packages.map((p) => [p.identifier, p.version])).toEqual([
    [pkg.name, pkg.version],
  ])
  const bundle = await readJson('mcpb/manifest.json')
  expect(bundle.version).toBe(pkg.version)
})

test('the Claude plugin and registry entry point at the hosted server', async () => {
  const plugin = await readJson('plugin/.claude-plugin/plugin.json')
  expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/)
  expect((await readJson('plugin/.mcp.json')).mcpServers).toEqual({
    earnrate: { type: 'http', url: 'https://mcp.earnrate.dev' },
  })
  expect((await readJson('server.json')).remotes).toEqual([
    { type: 'streamable-http', url: 'https://mcp.earnrate.dev' },
  ])
})

test('the policy pages and READMEs state the hosted server’s retention', async () => {
  const read = (file: string) => readFile(path.join(ROOT, file), 'utf8')
  const flat = (text: string) => text.replace(/\s+/g, ' ')
  const privacy = await read('site/privacy.html')
  const terms = await read('site/terms.html')
  const readme = await read('README.md')
  const plugin = await read('plugin/README.md')
  const wrangler = await read('remote/wrangler.jsonc')
  for (const [file, text] of Object.entries({ privacy, terms, readme, plugin }))
    expect(flat(text), file).toContain(`${String(RETENTION_MONTHS)} months`)
  for (const [file, text] of Object.entries({ privacy, terms, readme, plugin }))
    expect(flat(text), file).toContain(UNUSED_NEW_WALLET.words)
  expect(flat(privacy)).toContain(`${String(CONNECTION_IDLE_DAYS)} days`)
  expect(flat(readme)).toContain(`${String(CONNECTION_IDLE_DAYS)} days`)
  expect(flat(privacy)).toContain('per minute')
  for (const period of wrangler.matchAll(/"period": (\d+)/g))
    expect(Number(period[1])).toBe(RATE_LIMIT_SECONDS)
})

test('counts in the docs match the catalog and the tool lists', async () => {
  const read = (file: string) => readFile(path.join(ROOT, file), 'utf8')
  const flat = (text: string) => text.replace(/\s+/g, ' ')
  const catalog = await loadCatalog()
  const cards = `${String(catalog.cards.length)} cards`
  expect(flat(await read('README.md'))).toContain(cards)
  expect(flat(await read('site/index.html'))).toContain(cards)

  const hosted = ANSWER_TOOLS.length + SAVED_WALLET_TOOLS.length
  const manifest = JSON.parse(await read('mcpb/manifest.json')) as {
    tools: unknown[]
  }
  expect(flat(await read('README.md'))).toContain(
    `${String(manifest.tools.length)} tools`,
  )
  expect(flat(await read('plugin/README.md'))).toContain(
    `${String(hosted)} tools`,
  )
  expect(await read('scripts/live-check.ts')).toContain(
    `tools.length === ${String(hosted)}`,
  )
})
