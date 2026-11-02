import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { catalogProblems, walletProblems } from '../src/data/integrity.ts'
import { loadCatalog, loadWallet } from '../src/data/load.ts'
import { EXAMPLE_WALLET, ROOT } from './helpers.ts'

test('repo data files parse and every reference resolves', async () => {
  const catalog = await loadCatalog()
  expect(catalogProblems(catalog)).toEqual([])
})

test('the example wallet matches the card catalog', async () => {
  const catalog = await loadCatalog()
  const wallet = await loadWallet(EXAMPLE_WALLET)
  expect(walletProblems(wallet, catalog)).toEqual([])
})

test('data/VERSION has a matching changelog section', async () => {
  const read = (file: string) => readFile(path.join(ROOT, 'data', file), 'utf8')
  const version = (await read('VERSION')).trim()
  expect(version).toMatch(/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/)
  expect(await read('CHANGELOG.md')).toContain(`## ${version}\n`)
})
