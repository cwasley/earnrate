// Pins the Claude plugin to a published earnrate version: plugin/package.json,
// plugin.json's version, and plugin/package-lock.json with exact versions and
// hashes. Claude Code installs from that lockfile and the plugin runs
// node_modules/earnrate, so the version must already be on npm.
// Usage: node scripts/plugin-lock.ts [version]   (default: package.json's)
import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PLUGIN = path.join(ROOT, 'plugin')
const readJson = async (file: string) =>
  JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
const writeJson = (file: string, value: unknown) =>
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`)

const version =
  process.argv[2] ??
  String((await readJson(path.join(ROOT, 'package.json'))).version)

// npm, not yarn: Claude Code installs plugin dependencies only from npm or
// Bun lockfiles.
execFileSync('npm', ['view', `earnrate@${version}`, 'version'], {
  stdio: 'inherit',
})

const pkg = {
  name: 'earnrate-claude-plugin',
  version,
  private: true,
  description: 'Installs the earnrate MCP server for the Claude plugin.',
  license: 'MIT',
  dependencies: { earnrate: version },
}
const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-plugin-lock-'))
try {
  await writeJson(path.join(dir, 'package.json'), pkg)
  execFileSync(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    { cwd: dir, stdio: 'inherit' },
  )
  await writeJson(path.join(PLUGIN, 'package.json'), pkg)
  await copyFile(
    path.join(dir, 'package-lock.json'),
    path.join(PLUGIN, 'package-lock.json'),
  )
} finally {
  await rm(dir, { recursive: true, force: true })
}

const manifestFile = path.join(PLUGIN, '.claude-plugin', 'plugin.json')
await writeJson(manifestFile, { ...(await readJson(manifestFile)), version })
console.log(`Pinned the plugin to earnrate@${version}.`)
