import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
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

test('the MCP registry entry, Claude Desktop bundle and plugin match package.json', async () => {
  const read = async (file: string) =>
    JSON.parse(await readFile(path.join(ROOT, file), 'utf8')) as Record<
      string,
      unknown
    >
  const pkg = await read('package.json')
  const server = await read('server.json')
  const packages = server.packages as { identifier: string; version: string }[]
  expect(server.name).toBe(pkg.mcpName)
  expect(server.version).toBe(pkg.version)
  expect(packages.map((p) => [p.identifier, p.version])).toEqual([
    [pkg.name, pkg.version],
  ])
  const bundle = await read('mcpb/manifest.json')
  expect(bundle.version).toBe(pkg.version)
  const plugin = await read('plugin/.claude-plugin/plugin.json')
  expect(plugin.version).toBe(pkg.version)
  const servers = (await read('plugin/.mcp.json')).mcpServers as Record<
    string,
    { args: string[] }
  >
  expect(servers.earnrate?.args).toContain(`earnrate@${String(pkg.version)}`)
})
