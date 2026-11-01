import { bookPurchase } from '../engine/record.ts'
import type { MerchantResolution, RecordedPurchase } from '../engine/types.ts'
import {
  addToWallet,
  removeFromWallet,
  updateInWallet,
  withMemberships,
  type CardInput,
  type WalletChange,
} from '../engine/wallet-change.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { loadWallet } from './load.ts'
import type { RecordResult, SetupResult, WalletStore } from './store.ts'
import {
  addCardText,
  commitWalletText,
  readWalletText,
  removeCardText,
  setMembershipsText,
  updateCardText,
  writeProgress,
} from './wallet-edit.ts'

type Applied = Extract<WalletChange, { ok: true }>

const failed = (error: string) => ({ ok: false as const, error })
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const queues = new Map<string, Promise<unknown>>()

// Runs `task` after every earlier task for the same file has settled, so a
// read-modify-write of the wallet never interleaves with another.
function withWalletLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve()
  const run = previous.then(task, task)
  queues.set(
    file,
    run.catch(() => undefined),
  )
  return run
}

// The wallet as a YAML file (the CLI, the local MCP server and the .mcpb).
// Each change is worked out on the parsed wallet, then spliced into the text,
// which must re-parse to exactly that wallet before it's written, so the
// user's comments survive.
export class FileWalletStore implements WalletStore {
  readonly where: string
  private readonly catalog: Catalog

  constructor(catalog: Catalog, file: string) {
    this.catalog = catalog
    this.where = file
  }

  async load(): Promise<Wallet | null> {
    try {
      return await loadWallet(this.where)
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null
      throw e
    }
  }

  private change(
    plan: (wallet: Wallet | null) => WalletChange | string,
    edit: (text: string | null, change: Applied) => string,
  ): Promise<SetupResult> {
    return withWalletLock(this.where, async () => {
      try {
        const { text, wallet } = await readWalletText(this.where)
        const change = plan(wallet)
        if (typeof change === 'string') return failed(change)
        if (!change.ok) return change
        await commitWalletText(this.where, edit(text, change), change.wallet)
        return {
          ok: true,
          wallet: change.wallet,
          created: text === null,
          notes: change.notes,
        }
      } catch (e) {
        return failed(errorText(e))
      }
    })
  }

  // Changes other than adding a card need a wallet file to change.
  private existing(apply: (wallet: Wallet) => WalletChange) {
    return (wallet: Wallet | null) =>
      wallet === null
        ? `No wallet at ${this.where} yet. Add a card first to create it.`
        : apply(wallet)
  }

  addCard(input: CardInput, today: string): Promise<SetupResult> {
    return this.change(
      (wallet) => addToWallet(this.catalog, wallet, input, today),
      (text, change) => addCardText(text, { id: input.id, ...change.fields }),
    )
  }

  updateCard(input: CardInput, today: string): Promise<SetupResult> {
    return this.change(
      this.existing((w) => updateInWallet(this.catalog, w, input, today)),
      (text, change) => updateCardText(text ?? '', input.id, change.fields),
    )
  }

  removeCard(cardId: string): Promise<SetupResult> {
    return this.change(
      this.existing((w) =>
        w.cards.length === 1 && w.cards[0]?.id === cardId
          ? failed(
              `${cardId} is the last card in ${this.where}. To start over, delete that file; to swap cards, add the new one first.`,
            )
          : removeFromWallet(w, cardId),
      ),
      (text) => removeCardText(text ?? '', cardId),
    )
  }

  setMemberships(memberships: string[]): Promise<SetupResult> {
    return this.change(
      this.existing((w) => withMemberships(this.catalog, w, memberships)),
      (text, change) =>
        setMembershipsText(text ?? '', change.wallet.memberships),
    )
  }

  record(
    purchase: RecordedPurchase,
    merchant: MerchantResolution,
  ): Promise<RecordResult> {
    return withWalletLock(this.where, async () => {
      const wallet = await this.load()
      if (!wallet) return failed("There's no saved wallet to record it in.")
      if (!wallet.cards.some((c) => c.id === purchase.cardId))
        return failed(`${purchase.cardId} isn't in the wallet.`)
      const booked = bookPurchase(this.catalog, wallet, purchase, merchant)
      try {
        if (booked.cap || booked.bonus)
          await writeProgress(
            this.where,
            booked.cap ? [booked.cap] : [],
            booked.bonus ? [booked.bonus] : [],
          )
      } catch (e) {
        return failed(errorText(e))
      }
      return { ok: true, ...booked }
    })
  }
}
