import type { MerchantResolution, RecordedPurchase } from '../engine/types.ts'
import { bookPurchase } from '../engine/record.ts'
import type { CardInput } from '../engine/wallet-change.ts'
import type { Wallet } from '../schema/wallet.ts'
import { loadWallet, type Catalog } from './load.ts'
import type { RecordResult, SetupResult, WalletStore } from './store.ts'
import {
  addCard,
  removeCard,
  setMemberships,
  updateCard,
} from './wallet-setup.ts'
import {
  withWalletLock,
  writeBonusSpent,
  writeCapBooking,
} from './wallet-write.ts'

// The wallet as a YAML file (the CLI, the local MCP server, the .mcpb and the
// local plugin). Edits splice lines so the user's comments survive.
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

  addCard(input: CardInput, today: string): Promise<SetupResult> {
    return withWalletLock(this.where, () =>
      addCard(this.where, this.catalog, input, today),
    )
  }

  updateCard(input: CardInput, today: string): Promise<SetupResult> {
    return withWalletLock(this.where, () =>
      updateCard(this.where, this.catalog, input, today),
    )
  }

  removeCard(cardId: string): Promise<SetupResult> {
    return withWalletLock(this.where, () =>
      removeCard(this.where, this.catalog, cardId),
    )
  }

  setMemberships(memberships: string[]): Promise<SetupResult> {
    return withWalletLock(this.where, () =>
      setMemberships(this.where, this.catalog, memberships),
    )
  }

  record(
    purchase: RecordedPurchase,
    merchant: MerchantResolution,
  ): Promise<RecordResult> {
    return withWalletLock(this.where, async () => {
      const wallet = await this.load()
      if (!wallet)
        return { ok: false, error: "There's no saved wallet to record it in." }
      if (!wallet.cards.some((c) => c.id === purchase.cardId))
        return { ok: false, error: `${purchase.cardId} isn't in the wallet.` }
      const booked = bookPurchase(this.catalog, wallet, purchase, merchant)
      try {
        if (booked.cap) await writeCapBooking(this.where, booked.cap)
        if (booked.bonus)
          await writeBonusSpent(this.where, purchase.cardId, booked.bonus.after)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      return { ok: true, ...booked }
    })
  }
}
