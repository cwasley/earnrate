import type { CardFilters } from '../../src/engine/explore.ts'
import { ALL_PERSONAL_CARDS } from '../../src/engine/explore.ts'
import { VALUATION_PROFILES } from '../../src/engine/profiles.ts'
import type { Wallet } from '../../src/schema/wallet.ts'

export type Settings = {
  kind: CardFilters['kind']
  noFee: boolean
  business: boolean
  issuer: string | null
  memberships: string[]
  pointsHeavy: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  kind: 'any',
  noFee: false,
  business: false,
  issuer: null,
  memberships: [],
  pointsHeavy: false,
}

export function engineOptions(s: Settings): {
  filters: CardFilters
  memberships: string[]
  valuations: Wallet['valuations']
} {
  return {
    filters: {
      ...ALL_PERSONAL_CARDS,
      kind: s.kind,
      noAnnualFee: s.noFee,
      business: s.business,
      issuer: s.issuer,
    },
    memberships: s.memberships,
    valuations: s.pointsHeavy ? VALUATION_PROFILES['points-heavy'] : {},
  }
}

// Browser storage can be missing or blocked (private windows, previews), so
// every read and write falls back quietly; the page works without it.
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`earnrate:${key}`)
    return raw === null ? fallback : { ...fallback, ...(JSON.parse(raw) as T) }
  } catch {
    return fallback
  }
}

export function loadList<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(`earnrate:${key}`)
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : fallback
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(`earnrate:${key}`, JSON.stringify(value))
  } catch {
    // Storage is a convenience; without it settings last until reload.
  }
}

export function loadWallet(): Wallet | null {
  try {
    const raw = localStorage.getItem('earnrate:wallet')
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<Wallet> | null
    if (!parsed || !Array.isArray(parsed.cards)) return null
    return {
      valuations: parsed.valuations ?? {},
      memberships: parsed.memberships ?? [],
      cards: parsed.cards,
    }
  } catch {
    return null
  }
}

export function saveWallet(wallet: Wallet | null): void {
  try {
    if (wallet === null) localStorage.removeItem('earnrate:wallet')
    else localStorage.setItem('earnrate:wallet', JSON.stringify(wallet))
  } catch {
    // Without storage the wallet lasts until the page closes.
  }
}
