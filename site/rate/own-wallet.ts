// The only part of /rate that writes: credit answers on the visitor's own
// saved wallet, to this browser's copy or, with sync on, to the synced
// wallet. answerSaver hands it out only for that wallet.
import { catalog } from 'virtual:catalog'
import { localToday } from '../../src/engine/periods.ts'
import { load, loadWallet, save, saveWallet } from '../app/settings.ts'
import { syncRequest } from '../app/sync.ts'
import type { SaveDeps } from './answers.ts'

export const OWN_WALLET: SaveDeps = {
  catalog,
  today: localToday,
  read: loadWallet,
  write: saveWallet,
  synced: () => load('sync', { on: false }).on,
  online: () => navigator.onLine,
  send: (op) => syncRequest(op),
  signedOut: () => {
    save('sync', { on: false })
  },
}
