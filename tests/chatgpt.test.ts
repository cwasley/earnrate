import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'
import { ORIGIN } from '../remote/src/auth.ts'
import { loadCatalog } from '../src/data/load.ts'
import { ANSWER_TOOLS, SAVED_WALLET_TOOLS } from '../src/mcp/server.ts'

const ROOT = path.join(import.meta.dirname, '..')
const read = async (file: string) =>
  JSON.parse(await readFile(path.join(ROOT, 'chatgpt', file), 'utf8')) as {
    [key: string]: unknown
  }

type Interface = {
  displayName: string
  shortDescription: string
  longDescription: string
  developerName: string
  defaultPrompt: string[]
  [url: `${string}URL`]: string
}
type Review = {
  test_cases: {
    positive: { tools_triggered: string; expected_behavior: string }[]
    negative: { prompt: string }[]
  }
}

async function openai() {
  const manifest = (await read('plugin.json')) as {
    extensions: { 'com.openai': { interface: Interface; review: Review } }
  }
  return manifest.extensions['com.openai']
}

test('the ChatGPT listing fits OpenAI’s submission limits', async () => {
  const { interface: ui } = await openai()
  expect(ui.displayName.length).toBeLessThanOrEqual(30)
  expect(ui.shortDescription.length).toBeLessThanOrEqual(30)
  expect(ui.longDescription.length).toBeLessThanOrEqual(4000)
  expect(ui.developerName.length).toBeLessThanOrEqual(80)
  expect(ui.displayName).not.toMatch(/mcp|plugin/i)
  expect(ui.defaultPrompt.length).toBeLessThanOrEqual(3)
  for (const prompt of ui.defaultPrompt)
    expect(prompt.length).toBeLessThanOrEqual(128)
  for (const key of [
    'websiteURL',
    'supportURL',
    'privacyPolicyURL',
    'termsOfServiceURL',
  ] as const)
    expect(ui[key]).toMatch(/^https:\/\/earnrate\.dev(\/|$)/)
})

test('the ChatGPT listing states the catalog’s counts', async () => {
  const catalog = await loadCatalog()
  const issuers = new Set(catalog.cards.map((c) => c.issuer)).size
  const { interface: ui } = await openai()
  expect(ui.longDescription).toContain(
    `all ${String(catalog.cards.length)} U.S. credit cards it knows, from ${String(issuers)} issuers`,
  )
})

test('the ChatGPT review cases name hosted tools', async () => {
  const { review } = await openai()
  expect(review.test_cases.positive).toHaveLength(5)
  expect(review.test_cases.negative).toHaveLength(3)
  const tools = new Set([...ANSWER_TOOLS, ...SAVED_WALLET_TOOLS])
  for (const c of review.test_cases.positive)
    for (const name of c.tools_triggered.split(',').map((t) => t.trim()))
      expect(tools, name).toContain(name)
  const text = JSON.stringify(review)
  expect(text).not.toMatch(
    /test_credentials|reviewer_instructions|recovery code/i,
  )
})

test('the ChatGPT package points at the hosted server with OAuth', async () => {
  const mcp = (await read('mcp.json')) as {
    mcpServers: Record<string, { url: string; extensions: unknown }>
  }
  const servers = Object.values(mcp.mcpServers)
  expect(servers).toHaveLength(1)
  expect(servers[0]?.url).toBe(ORIGIN)
  expect(JSON.stringify(servers[0]?.extensions)).toContain('"type":"oauth"')
})
