// Builds earnrate.mcpb, the one-click install for Claude Desktop: the built
// server, the card data and production node_modules, with mcpb/manifest.json.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const STAGE = path.join(ROOT, '.mcpb-build')
const OUT = path.join(ROOT, 'earnrate.mcpb')
const run = (command: string, args: string[], cwd = ROOT) =>
  execFileSync(command, args, { cwd, stdio: 'inherit' })

const pkg = JSON.parse(
  await readFile(path.join(ROOT, 'package.json'), 'utf8'),
) as {
  version: string
}
const manifest = JSON.parse(
  await readFile(path.join(ROOT, 'mcpb', 'manifest.json'), 'utf8'),
) as { version: string }
if (manifest.version !== pkg.version)
  throw new Error(
    `mcpb/manifest.json is ${manifest.version} but package.json is ${pkg.version}`,
  )

run('yarn', ['build'])
await rm(STAGE, { recursive: true, force: true })
await mkdir(STAGE)
for (const item of [
  'dist',
  'data',
  'wallet.example.yaml',
  'LICENSE',
  'package.json',
  'yarn.lock',
])
  await cp(path.join(ROOT, item), path.join(STAGE, item), {
    recursive: true,
    filter: (src) => !src.endsWith('sources.lock.json'),
  })
await cp(path.join(ROOT, 'mcpb', 'icon.png'), path.join(STAGE, 'icon.png'))
await writeFile(
  path.join(STAGE, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
run(
  'yarn',
  [
    'install',
    '--production',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--non-interactive',
    '--silent',
  ],
  STAGE,
)
const mcpb = path.join(ROOT, 'node_modules', '.bin', 'mcpb')
run(mcpb, ['validate', path.join(STAGE, 'manifest.json')])
await rm(OUT, { force: true })
run(mcpb, ['pack', STAGE, OUT])
