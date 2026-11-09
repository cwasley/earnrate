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
import { loadCatalog, loadChanges, loadWallet } from '../src/data/load.ts'
import { landingFacts, renderLanding } from '../scripts/landing.ts'
import { companyParts } from '../scripts/pages/changes.ts'
import { issuerChanges } from '../src/engine/changes.ts'
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
  const support = await read('site/support.html')
  for (const [file, text] of Object.entries({
    privacy,
    terms,
    readme,
    plugin,
    support,
  }))
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
  const sample = await loadWallet(path.join(ROOT, 'wallet.example.yaml'))
  const home = renderLanding(
    await read('site/index.html'),
    landingFacts(catalog, sample, '2026-11-03'),
  )
  expect(flat(home)).toContain(`<b>${String(catalog.cards.length)}</b>cards`)
  expect(flat(home)).toContain(cards)

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

test('the companies page states the catalog’s counts and promises no hosted plan', async () => {
  const catalog = await loadCatalog()
  const sample = await loadWallet(path.join(ROOT, 'wallet.example.yaml'))
  const facts = landingFacts(catalog, sample, '2026-11-03')
  const releases = await loadChanges()
  const parts = companyParts(catalog, releases)
  const page = renderLanding(
    await readFile(path.join(ROOT, 'site/companies.html'), 'utf8'),
    facts,
    parts,
  ).replace(/\s+/g, ' ')
  expect(page).toContain(
    `Rules for ${String(catalog.cards.length)} U.S. credit cards from ${String(facts.issuers.length)} issuers`,
  )
  expect(page).toContain(`About ${String(facts.stores)} stores`)
  expect(page).toContain(
    `${String(issuerChanges(releases).length)} issuer changes recorded since`,
  )
  expect(page).toContain('licensing@earnrate.dev')
  // The recent issuer changes quote offers in dollars; nothing else may.
  expect(page.replace(parts.recent_changes ?? '', '')).not.toMatch(
    /API key|pricing|\$/i,
  )
})

test('the plugin README and README name every hosted tool', async () => {
  const read = (file: string) => readFile(path.join(ROOT, file), 'utf8')
  for (const file of ['plugin/README.md', 'README.md']) {
    const text = await read(file)
    const missing = [...ANSWER_TOOLS, ...SAVED_WALLET_TOOLS].filter(
      (name) => !text.includes(`\`${name}\``),
    )
    expect(missing, file).toEqual([])
  }
})

test('earnrate.dev refuses to be framed and serves no sniffed types', async () => {
  const headers = await readFile(
    path.join(ROOT, 'site/public/_headers'),
    'utf8',
  )
  expect(headers).toMatch(/^\/\*\n/m)
  expect(headers).toMatch(/Content-Security-Policy: .*frame-ancestors 'none'/)
  expect(headers).toContain('X-Content-Type-Options: nosniff')
})

test("the hosted server's favicon is the site's", async () => {
  const { FAVICON_SVG } = await import('../remote/src/pages.ts')
  const site = await readFile(
    path.join(ROOT, 'site/public/favicon.svg'),
    'utf8',
  )
  expect(FAVICON_SVG).toBe(site.trim())
})

test('SECURITY.md and the terms name every hosted domain', async () => {
  const read = (file: string) => readFile(path.join(ROOT, file), 'utf8')
  const domains = new Set<string>()
  for (const config of [
    'wrangler.jsonc',
    'remote/wrangler.jsonc',
    'pass/wrangler.jsonc',
  ])
    for (const m of (await read(config)).matchAll(/"pattern": "([^"]+)"/g))
      if (m[1] && !m[1].startsWith('www.')) domains.add(m[1])
  expect(domains.size).toBeGreaterThanOrEqual(3)
  const security = await read('SECURITY.md')
  const terms = await read('site/terms.html')
  for (const d of domains) {
    expect(security, `SECURITY.md: ${d}`).toContain(d)
    expect(terms, `terms: ${d}`).toContain(d)
  }
})

test('server.json lists every environment variable the package reads', async () => {
  const brand = await import('../src/brand.ts')
  const read = await readJson('server.json')
  const listed = (
    read as {
      packages: { environmentVariables: { name: string }[] }[]
    }
  ).packages[0]?.environmentVariables.map((v) => v.name)
  const vars = Object.entries(brand)
    .filter(([k]) => k.endsWith('_ENV_VAR'))
    .map(([, v]) => v as string)
  expect(new Set(listed)).toEqual(new Set([...vars, 'ANTHROPIC_API_KEY']))
})

test("the privacy page says everything a saved wallet's card can hold", async () => {
  const { WalletCardSchema } = await import('../src/schema/wallet.ts')
  const privacy = await readFile(path.join(ROOT, 'site/privacy.html'), 'utf8')
  const said = privacy.replace(/\s+/g, ' ')
  // A new wallet field needs a phrase here and on the privacy page.
  const phrases: Record<string, string> = {
    id: 'by product',
    checkout_label: 'checkout name',
    anniversary: 'anniversary',
    opened: 'opening date',
    cap_usage: 'spending cap',
    chosen: 'bonus picks',
    activated: 'activated offers',
    milestone_usage: 'yearly spend bonus',
    enrolled: "statement credits you've enrolled in",
    credit_usage: "how much of each you've used",
    skipped_credits: "which ones you don't use",
    night_values: "what it's worth to you",
    bonus: 'welcome bonus',
  }
  for (const key of Object.keys(WalletCardSchema.shape)) {
    const phrase = phrases[key]
    expect(phrase, `no privacy phrase for ${key}`).toBeDefined()
    expect(said, key).toContain(phrase)
  }
})

test("search_cards' description names what it returns", async () => {
  const { cardInfo } = await import('../src/engine/setup.ts')
  const catalog = await loadCatalog()
  const source = await readFile(
    path.join(ROOT, 'src/mcp/tools/answers.ts'),
    'utf8',
  )
  const at = source.indexOf("'search_cards'")
  const description = source.slice(at, source.indexOf('inputSchema', at))
  const card = catalog.cards[0]
  if (!card) throw new Error('no cards')
  // null: plain from the name of the tool, so not worth a phrase.
  const phrases: Record<string, string | null> = {
    id: 'id',
    name: null,
    issuer: null,
    network: 'network',
    currency: null,
    annualFee: 'annual fee',
    firstYearFee: 'first-year waiver',
    foreignTransactionFee: 'foreign transaction fee',
    business: null,
    onlyAt: null,
    held: 'already in the wallet',
    choices: 'category picks',
    memberships: 'memberships',
    requiresMembership: 'memberships',
    activation: 'activations',
    needsAnniversary: null,
    milestones: 'spend bonuses',
    introRates: 'first-year rates',
    credits: 'statement credits',
    freeNights: 'yearly free nights',
  }
  for (const key of Object.keys(cardInfo(catalog, card, null, '2026-11-06'))) {
    expect(key in phrases, `no phrase decided for ${key}`).toBe(true)
    const phrase = phrases[key]
    if (phrase) expect(description, key).toContain(phrase)
  }
})
