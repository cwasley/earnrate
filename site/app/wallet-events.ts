// Tells the page's own listeners that the saved wallet or spending rows were
// just written, so the visitor's report link can follow (my-link.ts).
const listeners = new Set<() => void>()

export function walletSaved(): void {
  for (const fn of listeners) fn()
}

export function onWalletSaved(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
