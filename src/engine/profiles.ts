import type { Wallet } from '../schema/wallet.ts'

export const VALUATION_PROFILES = {
  flat: { MR: 1.0, UR: 1.0 },
  'points-heavy': { MR: 1.7, UR: 1.7 },
} as const

export type ValuationProfile = keyof typeof VALUATION_PROFILES

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
