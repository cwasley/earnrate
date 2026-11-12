// This browser's own report link, wired to its storage and to the short
// link requests. Started only for the visitor's own wallet: never on a
// shared report, which must not read this browser's storage.
import { catalog } from 'virtual:catalog'
import { ownReport } from '../rate/own-report.ts'
import { savedRows } from '../rate/source.ts'
import { deleteReport, writeReport } from '../rate/store.ts'
import { LINK_KEY, linkUpdater, parseLink, type MyLink } from './report-link.ts'
import { loadWallet } from './saved-wallet.ts'
import { onWalletSaved } from './wallet-events.ts'

function readRows() {
  try {
    return savedRows(localStorage.getItem('earnrate:spending'))
  } catch {
    return null
  }
}

export const myLink = linkUpdater({
  load: () => {
    try {
      return parseLink(localStorage.getItem(LINK_KEY))
    } catch {
      return null
    }
  },
  store: (link: MyLink | null) => {
    try {
      if (link === null) localStorage.removeItem(LINK_KEY)
      else localStorage.setItem(LINK_KEY, JSON.stringify(link))
    } catch {
      // Without storage the link isn't remembered, or updated, after the
      // page closes; it still opens, and expires as any link does.
    }
  },
  current: (spending) =>
    ownReport(catalog, loadWallet(), spending ? readRows() : null, spending),
  write: writeReport,
  remove: deleteReport,
  later: (fn, ms) => setTimeout(fn, ms),
  cancel: (t) => {
    clearTimeout(t as ReturnType<typeof setTimeout>)
  },
})

let started = false

export function startMyLink(): void {
  if (started) return
  started = true
  onWalletSaved(myLink.changed)
  addEventListener('pagehide', myLink.flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') myLink.flush()
  })
  // A change saved just before the last page closed.
  myLink.changed()
}
