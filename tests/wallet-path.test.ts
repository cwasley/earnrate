import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  stat,
  symlink,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { WALLET_ENV_VAR } from '../src/brand.ts'
import { writeFileAtomic } from '../src/data/atomic-write.ts'
import { walletPath } from '../src/data/load.ts'

const DEFAULT = path.join(homedir(), '.earnrate', 'wallet.yaml')

test('defaults to ~/.earnrate/wallet.yaml, also when the setting is empty', () => {
  expect(walletPath({})).toBe(DEFAULT)
  expect(walletPath({ [WALLET_ENV_VAR]: '' })).toBe(DEFAULT)
  expect(walletPath({ [WALLET_ENV_VAR]: '  ' })).toBe(DEFAULT)
})

test('expands a home directory that arrives unexpanded', () => {
  for (const given of [
    '${HOME}/.earnrate/wallet.yaml',
    '$HOME/.earnrate/wallet.yaml',
    '~/.earnrate/wallet.yaml',
  ])
    expect(walletPath({ [WALLET_ENV_VAR]: given })).toBe(DEFAULT)
})

test('keeps an absolute path as given', () => {
  expect(walletPath({ [WALLET_ENV_VAR]: '/tmp/w/wallet.yaml' })).toBe(
    '/tmp/w/wallet.yaml',
  )
})

test.skipIf(process.platform === 'win32')(
  'wallet writes keep a symlink and its permissions, and new files are private',
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-write-'))
    const real = path.join(dir, 'synced', 'wallet.yaml')
    const link = path.join(dir, 'wallet.yaml')
    await writeFileAtomic(real, 'cards: []\n')
    expect((await stat(real)).mode & 0o777).toBe(0o600)
    await chmod(real, 0o640)
    await symlink(real, link)

    await writeFileAtomic(link, 'cards:\n  - id: amex-gold\n')
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await readFile(real, 'utf8')).toContain('amex-gold')
    expect((await stat(real)).mode & 0o777).toBe(0o640)
  },
)
