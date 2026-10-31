import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { FileWalletStore } from '../src/data/file-store.ts'
import { loadCatalog } from '../src/data/load.ts'
import {
  JsonWalletStore,
  memoryBackend,
  type WalletStore,
} from '../src/data/store.ts'
import { resolveMerchant } from '../src/merchants/resolve.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()

const stores: [string, () => Promise<WalletStore>][] = [
  [
    'file',
    async () =>
      new FileWalletStore(
        catalog,
        path.join(
          await mkdtemp(path.join(tmpdir(), 'earnrate-store-')),
          'wallet.yaml',
        ),
      ),
  ],
  [
    'json',
    () =>
      Promise.resolve(
        new JsonWalletStore(catalog, memoryBackend(), 'your saved wallet'),
      ),
  ],
]

describe.each(stores)('the %s store', (_name, make) => {
  test('starts with no wallet: optional, never an error', async () => {
    const store = await make()
    expect(await store.load()).toBeNull()
    const update = await store.updateCard({ id: 'amex-gold' }, TODAY)
    expect(update.ok).toBe(false)
  })

  test('adds, updates, records, sets memberships and removes the same way', async () => {
    const store = await make()
    const added = await store.addCard({ id: 'amex-blue-cash-preferred' }, TODAY)
    expect(added.ok && added.created).toBe(true)
    expect((await store.addCard({ id: 'chase-prime-visa' }, TODAY)).ok).toBe(
      true,
    )
    expect(
      (
        await store.updateCard(
          {
            id: 'amex-blue-cash-preferred',
            bonus: { opened: '2026-10-01', spent: 400 },
          },
          TODAY,
        )
      ).ok,
    ).toBe(true)
    expect((await store.setMemberships(['amazon-prime'])).ok).toBe(true)

    const recorded = await store.record(
      {
        cardId: 'amex-blue-cash-preferred',
        merchant: 'Whole Foods',
        amount: 100,
        date: TODAY,
        channel: null,
      },
      resolveMerchant(catalog, 'Whole Foods', null),
    )
    expect(recorded.ok).toBe(true)
    if (!recorded.ok) return
    expect(recorded.cap?.after).toBe(100)
    expect(recorded.bonus?.after).toBe(500)

    const wallet = await store.load()
    expect(wallet?.memberships).toEqual(['amazon-prime'])
    const bcp = wallet?.cards.find((c) => c.id === 'amex-blue-cash-preferred')
    expect(bcp?.cap_usage['us-supermarkets']).toEqual({
      period: '2026',
      spent: 100,
    })
    expect(bcp?.bonus).toEqual({ opened: '2026-10-01', spent: 500 })

    expect((await store.removeCard('chase-prime-visa')).ok).toBe(true)
    expect((await store.load())?.cards.map((c) => c.id)).toEqual([
      'amex-blue-cash-preferred',
    ])
    expect((await store.removeCard('amex-blue-cash-preferred')).ok).toBe(false)
  })

  test('concurrent writes all land', async () => {
    const store = await make()
    await store.addCard({ id: 'amex-blue-cash-preferred' }, TODAY)
    const merchant = resolveMerchant(catalog, 'Whole Foods', null)
    await Promise.all(
      [10, 20, 30].map((amount) =>
        store.record(
          {
            cardId: 'amex-blue-cash-preferred',
            merchant: 'Whole Foods',
            amount,
            date: TODAY,
            channel: null,
          },
          merchant,
        ),
      ),
    )
    const wallet = await store.load()
    expect(wallet?.cards[0]?.cap_usage['us-supermarkets']?.spent).toBe(60)
  })
})

test('the file store keeps the YAML readable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-store-'))
  const file = path.join(dir, 'wallet.yaml')
  const store = new FileWalletStore(catalog, file)
  await store.addCard({ id: 'amex-gold' }, TODAY)
  expect(await readFile(file, 'utf8')).toMatch(/^# Your earnrate wallet/)
})
