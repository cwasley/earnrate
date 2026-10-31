import { homedir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { WALLET_ENV_VAR } from '../src/brand.ts'
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
