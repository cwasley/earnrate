import type {
  AccountStore,
  RecordResult,
  SetupResult,
} from '../../src/data/store.ts'
import type {
  MerchantResolution,
  RecordedPurchase,
} from '../../src/engine/types.ts'
import type { CardInput } from '../../src/engine/wallet-change.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import type { VaultApi } from './vault.ts'

const WHERE = 'your saved wallet'

// A signed-in user's wallet: its vault, and the key from their grant.
export class VaultWalletStore implements AccountStore {
  readonly where = WHERE
  private readonly vault: VaultApi
  private readonly walletKey: string
  private readonly signOut: () => Promise<void>

  constructor(
    vault: VaultApi,
    walletKey: string,
    signOut: () => Promise<void>, // revokes every grant for this wallet
  ) {
    this.vault = vault
    this.walletKey = walletKey
    this.signOut = signOut
  }

  load(): Promise<Wallet | null> {
    return this.vault.load(this.walletKey)
  }

  addCard(input: CardInput, today: string): Promise<SetupResult> {
    return this.vault.addCard(this.walletKey, input, today)
  }

  updateCard(input: CardInput, today: string): Promise<SetupResult> {
    return this.vault.updateCard(this.walletKey, input, today)
  }

  removeCard(cardId: string): Promise<SetupResult> {
    return this.vault.removeCard(this.walletKey, cardId)
  }

  setMemberships(memberships: string[]): Promise<SetupResult> {
    return this.vault.setMemberships(this.walletKey, memberships)
  }

  replace(wallet: Wallet): Promise<SetupResult> {
    return this.vault.replace(this.walletKey, wallet)
  }

  record(
    purchase: RecordedPurchase,
    merchant: MerchantResolution,
  ): Promise<RecordResult> {
    return this.vault.record(this.walletKey, purchase, merchant)
  }

  async erase(): Promise<void> {
    await this.vault.destroy()
    await this.signOut()
  }
}

// Before sign-in. The Worker asks for sign-in before any saved-wallet tool
// runs, so only load() is reached here; the refusals are a backstop.
export const signedOutStore: AccountStore = {
  where: WHERE,
  load: () => Promise.resolve(null),
  addCard: refuse,
  updateCard: refuse,
  removeCard: refuse,
  setMemberships: refuse,
  replace: refuse,
  record: refuse,
  erase: () => Promise.resolve(),
}

function refuse() {
  return Promise.resolve({
    ok: false as const,
    error: 'Connect a saved wallet first.',
  })
}
