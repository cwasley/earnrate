import { WalletSchema, type Wallet } from '../../src/schema/wallet.ts'
import {
  VALUATION_PROFILES,
  withValuationProfile,
} from '../../src/engine/profiles.ts'
import type { Purchase } from '../../src/engine/types.ts'

export const TODAY = '2026-10-24'

export function baseWallet(): Wallet {
  return WalletSchema.parse({
    valuations: { 'sofi-rewards': { redemption: 'sofi-account' } },
    memberships: ['amazon-prime'],
    cards: [
      { id: 'amex-gold', checkout_label: 'Amex Gold' },
      { id: 'amex-blue-cash-preferred', checkout_label: 'Blue Cash Preferred' },
      { id: 'amex-platinum' },
      { id: 'chase-sapphire-preferred' },
      { id: 'chase-freedom-unlimited' },
      { id: 'chase-prime-visa', checkout_label: 'Prime Visa' },
      {
        id: 'usbank-cash-plus',
        chosen: {
          period: '2026-Q4',
          picks: {
            'five-percent': ['tv-internet-streaming', 'movie-theaters'],
            'two-percent': ['gas-ev-charging'],
          },
        },
      },
      { id: 'citi-my-best-buy-visa' },
      { id: 'sofi-unlimited-2' },
    ],
  })
}

export const PROFILES = {
  flat: VALUATION_PROFILES.flat,
  pointsHeavy: VALUATION_PROFILES['points-heavy'],
} as const

export type Profile = keyof typeof PROFILES

export function withProfile(wallet: Wallet, profile: Profile): Wallet {
  return withValuationProfile(
    wallet,
    profile === 'pointsHeavy' ? 'points-heavy' : 'flat',
  )
}

export function purchase(
  merchant: string,
  overrides: Partial<Omit<Purchase, 'merchant'>> = {},
): Purchase {
  return {
    merchant,
    amount: null,
    channel: null,
    date: TODAY,
    country: 'US',
    ...overrides,
  }
}

export function updateCard(
  wallet: Wallet,
  cardId: string,
  update: (card: Wallet['cards'][number]) => Wallet['cards'][number],
): Wallet {
  return {
    ...wallet,
    cards: wallet.cards.map((c) => (c.id === cardId ? update(c) : c)),
  }
}
