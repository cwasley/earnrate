import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WALLET_ENV_VAR } from '../src/brand.ts'

// Installs the packed tarball the way a user would, then runs both commands
// from node_modules, where Node won't strip TypeScript types.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-pack-'))
const npmEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('npm_config_')),
)

function check(ok: boolean, message: string) {
  if (!ok) throw new Error(message)
  console.log(`ok - ${message}`)
}

try {
  execFileSync('npm', ['pack', '--pack-destination', dir], {
    cwd: ROOT,
    env: npmEnv,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const tarball = (await readdir(dir)).find((f) => f.endsWith('.tgz'))
  if (!tarball) throw new Error('npm pack produced no tarball')
  const files = execFileSync('tar', ['-tzf', path.join(dir, tarball)], {
    encoding: 'utf8',
  }).split('\n')
  check(
    !files.some((f) =>
      /\.ts$|^package\/(tests|src|scripts|site|private)\//.test(f),
    ),
    'the package has no TypeScript sources, tests or site',
  )
  check(
    !files.includes('package/data/sources.lock.json'),
    'the package leaves out the sources lock',
  )

  execFileSync(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--prefix',
      dir,
      path.join(dir, tarball),
    ],
    { env: npmEnv, stdio: ['ignore', 'ignore', 'inherit'] },
  )
  const pkg = path.join(dir, 'node_modules/earnrate')
  const bin = (name: string) => path.join(dir, 'node_modules/.bin', name)
  const env = {
    ...process.env,
    [WALLET_ENV_VAR]: path.join(pkg, 'wallet.example.yaml'),
  }

  const cli = execFileSync(bin('earnrate'), ['whole foods', '80'], {
    env,
    encoding: 'utf8',
  })
  check(cli.includes('Use Blue Cash Preferred'), 'earnrate picks a card')
  const offers = execFileSync(bin('earnrate'), ['offers', '--cash'], {
    env,
    encoding: 'utf8',
  })
  check(offers.includes('the first year'), 'earnrate offers ranks offers')

  for (const [command, args] of [
    [bin('earnrate'), ['mcp']],
    [bin('earnrate-mcp'), []],
  ] as const) {
    const client = new Client({ name: 'earnrate-smoke', version: '0.0.0' })
    await client.connect(
      new StdioClientTransport({ command, args: [...args], env }),
    )
    const { tools } = await client.listTools()
    await client.close()
    check(
      tools.length === 12,
      `${path.basename(command)} ${args.join(' ')}`.trim() +
        ` serves ${String(tools.length)} MCP tools`,
    )
  }
} finally {
  await rm(dir, { recursive: true, force: true })
}
