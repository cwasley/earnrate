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

export class VaultWalletStore implements AccountStore {
  readonly where = WHERE
  private readonly vault: VaultApi
  private readonly walletKey: string
  private readonly signOut: () => Promise<void>
  private readonly signOutHere: () => Promise<void>

  constructor(
    vault: VaultApi,
    walletKey: string,
    signOut: () => Promise<void>, // revokes every grant for this wallet
    signOutHere: () => Promise<void>, // revokes this app's grants for it
  ) {
    this.vault = vault
    this.walletKey = walletKey
    this.signOut = signOut
    this.signOutHere = signOutHere
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

  setSkippedIssuers(issuers: string[]): Promise<SetupResult> {
    return this.vault.setSkippedIssuers(this.walletKey, issuers)
  }

  setValuations(changes: Record<string, number | null>): Promise<SetupResult> {
    return this.vault.setValuations(this.walletKey, changes)
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

  disconnect(): Promise<void> {
    return this.signOutHere()
  }

  async started(): Promise<string | null> {
    const created = await this.vault.started()
    return created === null ? null : new Date(created).toISOString()
  }
}

// Only while sign-in itself is down: questions are still answered, and the
// Worker refuses saved-wallet tools before they get here.
export const signedOutStore: AccountStore = {
  where: WHERE,
  load: () => Promise.resolve(null),
  addCard: refuse,
  updateCard: refuse,
  removeCard: refuse,
  setMemberships: refuse,
  setSkippedIssuers: refuse,
  setValuations: refuse,
  replace: refuse,
  record: refuse,
  erase: () => Promise.reject(new Error('Connect a saved wallet first.')),
  disconnect: () => Promise.reject(new Error('Connect a saved wallet first.')),
  started: () => Promise.resolve(null),
}

function refuse() {
  return Promise.resolve({
    ok: false as const,
    error: 'Connect a saved wallet first.',
  })
}
