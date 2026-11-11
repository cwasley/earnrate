import type { Wallet } from '../../src/schema/wallet.ts'

// Only reads: the statement check imports this, and its page must never
// write to the browser's storage.
export function loadWallet(): Wallet | null {
  try {
    const raw = localStorage.getItem('earnrate:wallet')
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<Wallet> | null
    if (!parsed || !Array.isArray(parsed.cards)) return null
    return {
      valuations: parsed.valuations ?? {},
      memberships: parsed.memberships ?? [],
      ...(parsed.skipped_issuers
        ? { skipped_issuers: parsed.skipped_issuers }
        : {}),
      cards: parsed.cards,
    }
  } catch {
    return null
  }
}
