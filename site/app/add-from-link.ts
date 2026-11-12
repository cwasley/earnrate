// Cards named in the address (#wallet&add=…) are added at once only when an
// earnrate.dev page sent the visitor: a card page's "Add it to your wallet",
// or this page's own links. Any other site could link here naming any card,
// or change the address of a window it opened, so then My wallet asks first.

let inPage: string | null = null
// The address the page loaded with; the referrer speaks only for it, once.
let loaded: string | null =
  (globalThis as { location?: { hash: string } }).location?.hash ?? null

// Called by this page's own links to #wallet&add=… as they're followed.
export function followingOwnLink(hash: string): void {
  inPage = hash
}

export function loadedWith(hash: string): void {
  loaded = hash
}

export function addsAtOnce(arrival: {
  hash: string
  referrer: string
  origin: string
}): boolean {
  const own = inPage === arrival.hash
  const arrived = loaded === arrival.hash
  inPage = null
  loaded = null
  if (own) return true
  if (!arrived) return false
  try {
    return (
      arrival.referrer !== '' &&
      new URL(arrival.referrer).origin === arrival.origin
    )
  } catch {
    return false
  }
}

export const askAddText = (count: number) =>
  count === 1
    ? 'Add this card to your wallet?'
    : `Add these ${String(count)} cards to your wallet?`
