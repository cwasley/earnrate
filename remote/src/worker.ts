import { DurableObject } from 'cloudflare:workers'
import bundle from 'earnrate:bundle'
import type {
  MerchantResolution,
  RecordedPurchase,
} from '../../src/engine/types.ts'
import type { CardInput } from '../../src/engine/wallet-change.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { makeWorker, type Env as AppEnv } from './app.ts'
import { WalletVault, type VaultApi } from './vault.ts'

type Env = AppEnv & {
  OAUTH_KV: KVNamespace
  WALLETS: DurableObjectNamespace<WalletObject>
}

// One saved wallet. Its alarm deletes it 13 months after its last use.
export class WalletObject extends DurableObject<Env> {
  private readonly vault = new WalletVault(this.ctx.storage, bundle.catalog)

  create(walletId: string, wrappedKey: string) {
    return this.vault.create(walletId, wrappedKey)
  }
  checkIn(used: boolean, grantId: string | null) {
    return this.vault.checkIn(used, grantId)
  }
  signOutGrants(grants: { id: string; expiresAt: number | null }[]) {
    return this.vault.signOutGrants(grants)
  }
  wrappedKey() {
    return this.vault.wrappedKey()
  }
  load(walletKey: string) {
    return this.vault.load(walletKey)
  }
  addCard(walletKey: string, input: CardInput, today: string) {
    return this.vault.addCard(walletKey, input, today)
  }
  updateCard(walletKey: string, input: CardInput, today: string) {
    return this.vault.updateCard(walletKey, input, today)
  }
  removeCard(walletKey: string, cardId: string) {
    return this.vault.removeCard(walletKey, cardId)
  }
  setMemberships(walletKey: string, memberships: string[]) {
    return this.vault.setMemberships(walletKey, memberships)
  }
  setSkippedIssuers(walletKey: string, issuers: string[]) {
    return this.vault.setSkippedIssuers(walletKey, issuers)
  }
  setValuations(walletKey: string, changes: Record<string, number | null>) {
    return this.vault.setValuations(walletKey, changes)
  }
  replace(walletKey: string, wallet: Wallet) {
    return this.vault.replace(walletKey, wallet)
  }
  record(
    walletKey: string,
    purchase: RecordedPurchase,
    merchant: MerchantResolution,
  ) {
    return this.vault.record(walletKey, purchase, merchant)
  }
  started() {
    return this.vault.started()
  }
  destroy() {
    return this.vault.destroy()
  }
  override async alarm() {
    await this.vault.destroy()
  }
}

export default makeWorker<Env>(
  bundle,
  (env, walletId) =>
    env.WALLETS.get(env.WALLETS.idFromName(walletId)) as unknown as VaultApi,
)
