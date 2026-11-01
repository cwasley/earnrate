import type { Wallet } from '../schema/wallet.ts'

export const VALUATION_PROFILES = {
  flat: { MR: 1.0, UR: 1.0 },
  'points-heavy': { MR: 1.7, UR: 1.7 },
} as const

export type ValuationProfile = keyof typeof VALUATION_PROFILES

// "MR and UR at 1.7¢": what a profile sets, for help text.
export function profileText(profile: ValuationProfile): string {
  const values = Object.entries(VALUATION_PROFILES[profile])
  const cents = [...new Set(values.map(([, v]) => v))]
  return cents.length === 1
    ? `${values.map(([id]) => id).join(' and ')} at ${String(cents[0])}¢`
    : values.map(([id, v]) => `${id} at ${String(v)}¢`).join(', ')
}

export function isValuationProfile(name: string): name is ValuationProfile {
  return Object.hasOwn(VALUATION_PROFILES, name)
}

export function withValuationProfile(
  wallet: Wallet,
  profile: ValuationProfile,
): Wallet {
  return {
    ...wallet,
    valuations: { ...wallet.valuations, ...VALUATION_PROFILES[profile] },
  }
}
