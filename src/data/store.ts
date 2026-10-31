import type { SetupNote } from '../engine/setup.ts'
import { bookPurchase, type BookedPurchase } from '../engine/record.ts'
import type { MerchantResolution, RecordedPurchase } from '../engine/types.ts'
import {
  addToWallet,
  removeFromWallet,
  updateInWallet,
  withMemberships,
  type CardInput,
  type WalletChange,
} from '../engine/wallet-change.ts'
import { WalletSchema, type Wallet } from '../schema/wallet.ts'
import type { Catalog } from '../schema/catalog.ts'

export type SetupResult =
  | {
      ok: true
      wallet: Wallet
      created: boolean // there was no saved wallet before
      notes: SetupNote[] // what the changed card still needs
    }
  | { ok: false; error: string }

export type RecordResult =
  ({ ok: true } & BookedPurchase) | { ok: false; error: string }

// Where a saved wallet lives: the YAML file (CLI, local MCP) or JSON in a
// key-value backend (the remote connector). Every change goes through the
// pure rules in src/engine/wallet-change.ts and record.ts, so both behave
// the same. A wallet is optional: load() returns null when none is saved.
export interface WalletStore {
  readonly where: string // for messages: a file path, or "your saved wallet"
  load(): Promise<Wallet | null> // throws when a saved wallet can't be read
  addCard(input: CardInput, today: string): Promise<SetupResult>
  updateCard(input: CardInput, today: string): Promise<SetupResult>
  removeCard(cardId: string): Promise<SetupResult>
  setMemberships(memberships: string[]): Promise<SetupResult>
  record(
    purchase: RecordedPurchase,
    merchant: MerchantResolution,
  ): Promise<RecordResult>
}

// A saved wallet the user can also replace or delete outright: the remote
// server's, where there's no file to edit or remove by hand.
export interface AccountStore extends WalletStore {
  replace(wallet: Wallet): Promise<SetupResult>
  erase(): Promise<void>
}

export type JsonBackend = {
  read(): Promise<string | null>
  write(text: string): Promise<void>
  remove(): Promise<void>
}

const failed = (error: string) => ({ ok: false as const, error })

// A wallet stored as JSON text. Writes are serialized within this instance;
// a backend shared across processes must serialize them itself (one Durable
// Object per wallet does).
export class JsonWalletStore implements AccountStore {
  readonly where: string
  private readonly catalog: Catalog
  private readonly backend: JsonBackend
  private queue: Promise<unknown> = Promise.resolve()

  constructor(catalog: Catalog, backend: JsonBackend, where: string) {
    this.catalog = catalog
    this.backend = backend
    this.where = where
  }

  async load(): Promise<Wallet | null> {
    const text = await this.backend.read()
    return text === null ? null : WalletSchema.parse(JSON.parse(text))
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private change(
    apply: (wallet: Wallet | null) => WalletChange,
  ): Promise<SetupResult> {
    return this.serialized(async () => {
      const before = await this.load()
      const change = apply(before)
      if (!change.ok) return failed(change.error)
      await this.backend.write(JSON.stringify(change.wallet))
      return {
        ok: true,
        wallet: change.wallet,
        created: before === null,
        notes: change.notes,
      }
    })
  }

  private needsWallet(
    apply: (wallet: Wallet) => WalletChange,
  ): (wallet: Wallet | null) => WalletChange {
    return (wallet) =>
      wallet === null
        ? failed("There's no saved wallet yet. Add a card first to start one.")
        : apply(wallet)
  }

  addCard(input: CardInput, today: string): Promise<SetupResult> {
    return this.change((w) => addToWallet(this.catalog, w, input, today))
  }

  updateCard(input: CardInput, today: string): Promise<SetupResult> {
    return this.change(
      this.needsWallet((w) => updateInWallet(this.catalog, w, input, today)),
    )
  }

  removeCard(cardId: string): Promise<SetupResult> {
    return this.change(this.needsWallet((w) => removeFromWallet(w, cardId)))
  }

  setMemberships(memberships: string[]): Promise<SetupResult> {
    return this.change(
      this.needsWallet((w) => withMemberships(this.catalog, w, memberships)),
    )
  }

  replace(wallet: Wallet): Promise<SetupResult> {
    return this.change(() => ({ ok: true, wallet, fields: {}, notes: [] }))
  }

  erase(): Promise<void> {
    return this.serialized(() => this.backend.remove())
  }

  record(
    purchase: RecordedPurchase,
    merchant: MerchantResolution,
  ): Promise<RecordResult> {
    return this.serialized(async () => {
      const wallet = await this.load()
      if (!wallet) return failed("There's no saved wallet to record it in.")
      if (!wallet.cards.some((c) => c.id === purchase.cardId))
        return failed(`${purchase.cardId} isn't in the wallet.`)
      const booked = bookPurchase(this.catalog, wallet, purchase, merchant)
      if (booked.cap || booked.bonus)
        await this.backend.write(JSON.stringify(booked.wallet))
      return { ok: true, ...booked }
    })
  }
}

// A store with nothing behind it, for tests and for a session that starts
// empty and is thrown away.
export function memoryBackend(initial: string | null = null): JsonBackend {
  let text = initial
  return {
    read: () => Promise.resolve(text),
    write: (next) => {
      text = next
      return Promise.resolve()
    },
    remove: () => {
      text = null
      return Promise.resolve()
    },
  }
}

// No saved wallet, and saving refused: the public remote server before
// anonymous saved wallets exist. Cards named in the conversation still work.
export function noSavedWallet(where: string): WalletStore {
  const refused = () =>
    Promise.resolve(
      failed(
        "Saving a wallet isn't available here yet. Name your cards in the conversation instead; nothing is stored.",
      ),
    )
  return {
    where,
    load: () => Promise.resolve(null),
    addCard: refused,
    updateCard: refused,
    removeCard: refused,
    setMemberships: refused,
    record: refused,
  }
}
