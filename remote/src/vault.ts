import {
  JsonWalletStore,
  type RecordResult,
  type SetupResult,
} from '../../src/data/store.ts'
import type {
  MerchantResolution,
  RecordedPurchase,
} from '../../src/engine/types.ts'
import type { CardInput } from '../../src/engine/wallet-change.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { RETENTION_MONTHS, UNUSED_NEW_WALLET } from './policy.ts'
import { decryptWallet, encryptWallet } from './vault-crypto.ts'

export type VaultStorage = {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  deleteAll(): Promise<void>
  setAlarm(scheduledTime: number): Promise<void>
  deleteAlarm(): Promise<void>
}

type Meta = {
  walletId: string
  wrappedKey: string // the wallet key, wrapped by the recovery code
  created: number
  lastUsed: number
}

const DELETED =
  'This saved wallet was deleted. Sign in again to start a new one.'

// A new wallet nobody has used yet is deleted after a week; any use keeps
// it for 13 months from then.
const DAY = 24 * 60 * 60 * 1000
const UNUSED_NEW_WALLET_MS = UNUSED_NEW_WALLET.days * DAY

function retentionEnd(lastUsed: number): number {
  const end = new Date(lastUsed)
  end.setUTCMonth(end.getUTCMonth() + RETENTION_MONTHS)
  return end.getTime()
}

// One saved wallet, encrypted, inside its own Durable Object. Calls run one
// at a time, so concurrent changes can't overwrite each other.
export class WalletVault {
  private readonly storage: VaultStorage
  private readonly catalog: Catalog
  private readonly now: () => number
  private queue: Promise<unknown> = Promise.resolve()

  constructor(storage: VaultStorage, catalog: Catalog, now = Date.now) {
    this.storage = storage
    this.catalog = catalog
    this.now = now
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async touch(): Promise<Meta | null> {
    const meta = await this.storage.get<Meta>('meta')
    if (!meta) return null
    const now = this.now()
    await this.storage.put('meta', { ...meta, lastUsed: now })
    await this.storage.setAlarm(retentionEnd(now))
    return meta
  }

  private withStore<T>(
    walletKey: string,
    missing: T,
    task: (store: JsonWalletStore) => Promise<T>,
  ): Promise<T> {
    return this.serialized(async () => {
      const meta = await this.touch()
      if (!meta) return missing
      const store = new JsonWalletStore(
        this.catalog,
        {
          read: async () => {
            const sealed = await this.storage.get<string>('wallet')
            return sealed === undefined
              ? null
              : decryptWallet(sealed, walletKey, meta.walletId)
          },
          write: async (text) => {
            await this.storage.put(
              'wallet',
              await encryptWallet(text, walletKey, meta.walletId),
            )
          },
          remove: async () => {
            await this.storage.delete('wallet')
          },
        },
        'your saved wallet',
      )
      return task(store)
    })
  }

  // False when this wallet already exists.
  create(walletId: string, wrappedKey: string): Promise<boolean> {
    return this.serialized(async () => {
      if (await this.storage.get<Meta>('meta')) return false
      const now = this.now()
      await this.storage.put('meta', {
        walletId,
        wrappedKey,
        created: now,
        lastUsed: now,
      } satisfies Meta)
      await this.storage.setAlarm(now + UNUSED_NEW_WALLET_MS)
      return true
    })
  }

  // Any tool call counts as use, so a wallet used only for questions isn't
  // deleted; an app's own setup requests don't. Written at most once a day.
  checkIn(used: boolean): Promise<boolean> {
    return this.serialized(async () => {
      const meta = await this.storage.get<Meta>('meta')
      if (!meta) return false
      const now = this.now()
      if (
        used &&
        (meta.lastUsed === meta.created || now - meta.lastUsed >= DAY)
      ) {
        await this.storage.put('meta', { ...meta, lastUsed: now })
        await this.storage.setAlarm(retentionEnd(now))
      }
      return true
    })
  }

  async wrappedKey(): Promise<string | null> {
    return (await this.storage.get<Meta>('meta'))?.wrappedKey ?? null
  }

  load(walletKey: string): Promise<Wallet | null> {
    return this.withStore(walletKey, null, (s) => s.load())
  }

  addCard(
    walletKey: string,
    input: CardInput,
    today: string,
  ): Promise<SetupResult> {
    return this.withStore(walletKey, failed(), (s) => s.addCard(input, today))
  }

  updateCard(
    walletKey: string,
    input: CardInput,
    today: string,
  ): Promise<SetupResult> {
    return this.withStore(walletKey, failed(), (s) =>
      s.updateCard(input, today),
    )
  }

  removeCard(walletKey: string, cardId: string): Promise<SetupResult> {
    return this.withStore(walletKey, failed(), (s) => s.removeCard(cardId))
  }

  setMemberships(
    walletKey: string,
    memberships: string[],
  ): Promise<SetupResult> {
    return this.withStore(walletKey, failed(), (s) =>
      s.setMemberships(memberships),
    )
  }

  setValuations(
    walletKey: string,
    changes: Record<string, number | null>,
  ): Promise<SetupResult> {
    return this.withStore(walletKey, failed(), (s) => s.setValuations(changes))
  }

  replace(walletKey: string, wallet: Wallet): Promise<SetupResult> {
    return this.withStore(walletKey, failed(), (s) => s.replace(wallet))
  }

  record(
    walletKey: string,
    purchase: RecordedPurchase,
    merchant: MerchantResolution,
  ): Promise<RecordResult> {
    return this.withStore(walletKey, failed(), (s) =>
      s.record(purchase, merchant),
    )
  }

  // When the wallet began, as milliseconds since 1970; null once it's gone.
  async started(): Promise<number | null> {
    return (await this.storage.get<Meta>('meta'))?.created ?? null
  }

  // Everything, including the recovery code's wrapped key.
  destroy(): Promise<void> {
    return this.serialized(async () => {
      await this.storage.deleteAlarm()
      await this.storage.deleteAll()
    })
  }
}

const failed = () => ({ ok: false as const, error: DELETED })

// What the Worker calls, on a Durable Object stub or a vault in tests.
export type VaultApi = Pick<
  WalletVault,
  | 'create'
  | 'checkIn'
  | 'wrappedKey'
  | 'load'
  | 'addCard'
  | 'updateCard'
  | 'removeCard'
  | 'setMemberships'
  | 'setValuations'
  | 'replace'
  | 'record'
  | 'started'
  | 'destroy'
>
