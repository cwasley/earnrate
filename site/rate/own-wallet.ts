// The only parts of /rate that write: the cards a visitor with no saved
// wallet taps in, and credit answers on their own wallet, to this
// browser's copy or, with sync on, to the synced wallet. Never used on a
// shared report.
import { catalog } from 'virtual:catalog'
import { localToday } from '../../src/engine/periods.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { load, loadWallet, save, saveWallet } from '../app/settings.ts'
import { syncRequest } from '../app/sync.ts'
import type { SaveDeps } from './answers.ts'

// Without storage (blocked, or a preview), the wallet lasts while the page
// is open, as on My wallet.
let memory: Wallet | null = null

export const OWN_WALLET: SaveDeps = {
  catalog,
  today: localToday,
  read: () => memory ?? loadWallet(),
  write: (wallet) => {
    memory = saveWallet(wallet) ? null : wallet
  },
  synced: () => load('sync', { on: false }).on,
  online: () => navigator.onLine,
  send: (op) => syncRequest(op),
  signedOut: () => {
    save('sync', { on: false })
  },
}

// Another tab changed storage, so storage works and holds the wallet.
export function storageChanged(): void {
  memory = null
}

// With sync on, the synced wallet replaces this browser's copy, as the home
// page does on load; signed out, sync goes off. Null when nothing changed.
export async function pullSynced(): Promise<Wallet | null> {
  if (!OWN_WALLET.synced()) return null
  const result = await syncRequest(null)
  if (result.kind === 'ok') {
    OWN_WALLET.write(result.wallet)
    return result.wallet
  }
  if (result.kind === 'ended') OWN_WALLET.signedOut()
  return null
}
