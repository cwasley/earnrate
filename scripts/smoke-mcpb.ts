// Unzips earnrate.mcpb (from `yarn mcpb:pack`) into a temp dir and runs it the
// way Claude Desktop does: node on the manifest's entry point, with the
// wallet path from user_config. Exits 1 on any failure.
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-mcpb-'))
const failures: string[] = []

function check(ok: boolean, label: string) {
  console.log(`${ok ? 'ok' : 'not ok'} - ${label}`)
  if (!ok) failures.push(label)
}

const text = (result: { content: unknown }) =>
  (result.content as { type: string; text?: string }[])[0]?.text ?? ''

try {
  const bundle = path.join(dir, 'bundle')
  execFileSync('unzip', ['-q', path.join(ROOT, 'earnrate.mcpb'), '-d', bundle])
  const manifest = JSON.parse(
    await readFile(path.join(bundle, 'manifest.json'), 'utf8'),
  ) as {
    server: { mcp_config: { command: string; args: string[] } }
    tools: { name: string }[]
  }
  const args = manifest.server.mcp_config.args.map((a) =>
    a.replace('${__dirname}', bundle),
  )
  const client = new Client({ name: 'smoke-mcpb', version: '0' })
  await client.connect(
    new StdioClientTransport({
      command: manifest.server.mcp_config.command,
      args,
      env: {
        PATH: process.env.PATH ?? '',
        EARNRATE_WALLET: path.join(dir, 'home', '.earnrate', 'wallet.yaml'),
      },
    }),
  )
  const { tools } = await client.listTools()
  check(
    tools
      .map((t) => t.name)
      .sort()
      .join() ===
      manifest.tools
        .map((t) => t.name)
        .sort()
        .join(),
    `the bundle serves the ${String(manifest.tools.length)} tools its manifest lists`,
  )
  const best = await client.callTool({
    name: 'best_cards_for',
    arguments: { category: 'grocery.supermarket' },
  })
  check(
    /^Best cards for supermarkets/.test(text(best)),
    'best_cards_for works with no wallet',
  )
  const added = await client.callTool({
    name: 'add_card',
    arguments: { cardId: 'amex-gold' },
  })
  check(added.isError !== true, 'add_card starts a wallet')
  const sheet = await client.callTool({ name: 'cheat_sheet', arguments: {} })
  check(/^Your cheat sheet for/.test(text(sheet)), 'cheat_sheet reads it back')
  await client.close()
} catch (e) {
  check(false, e instanceof Error ? e.message : String(e))
} finally {
  await rm(dir, { recursive: true, force: true })
}
process.exit(failures.length > 0 ? 1 : 0)
