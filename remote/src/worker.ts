import { DurableObject } from 'cloudflare:workers'
import bundle from 'earnrate:bundle'
import { makeWorker, type Env as AppEnv } from './app.ts'
import { WalletVault, type VaultApi } from './vault.ts'

type Env = AppEnv & {
  OAUTH_KV: KVNamespace
  WALLETS: DurableObjectNamespace<WalletObject>
}

// One saved wallet. Its alarm deletes it 13 months after its last use.
// Workers RPC calls only methods on this class, so each VaultApi method is
// forwarded here with the vault's own parameters; `implements` catches a
// missing one, which the stub's cast in makeWorker below can't.
export class WalletObject extends DurableObject<Env> implements VaultApi {
  private readonly vault = new WalletVault(this.ctx.storage, bundle.catalog)

  create(...a: Parameters<VaultApi['create']>) {
    return this.vault.create(...a)
  }
  checkIn(...a: Parameters<VaultApi['checkIn']>) {
    return this.vault.checkIn(...a)
  }
  signOutGrants(...a: Parameters<VaultApi['signOutGrants']>) {
    return this.vault.signOutGrants(...a)
  }
  wrappedKey(...a: Parameters<VaultApi['wrappedKey']>) {
    return this.vault.wrappedKey(...a)
  }
  load(...a: Parameters<VaultApi['load']>) {
    return this.vault.load(...a)
  }
  addCard(...a: Parameters<VaultApi['addCard']>) {
    return this.vault.addCard(...a)
  }
  updateCard(...a: Parameters<VaultApi['updateCard']>) {
    return this.vault.updateCard(...a)
  }
  removeCard(...a: Parameters<VaultApi['removeCard']>) {
    return this.vault.removeCard(...a)
  }
  setPastCards(...a: Parameters<VaultApi['setPastCards']>) {
    return this.vault.setPastCards(...a)
  }
  setMemberships(...a: Parameters<VaultApi['setMemberships']>) {
    return this.vault.setMemberships(...a)
  }
  setSkippedIssuers(...a: Parameters<VaultApi['setSkippedIssuers']>) {
    return this.vault.setSkippedIssuers(...a)
  }
  setValuations(...a: Parameters<VaultApi['setValuations']>) {
    return this.vault.setValuations(...a)
  }
  replace(...a: Parameters<VaultApi['replace']>) {
    return this.vault.replace(...a)
  }
  record(...a: Parameters<VaultApi['record']>) {
    return this.vault.record(...a)
  }
  started(...a: Parameters<VaultApi['started']>) {
    return this.vault.started(...a)
  }
  destroy(...a: Parameters<VaultApi['destroy']>) {
    return this.vault.destroy(...a)
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
