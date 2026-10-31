import type { Catalog } from '../data/load.ts'
import { resolveMerchantById } from '../merchants/resolve.ts'
import type { Wallet } from '../schema/wallet.ts'
import {
  categoryResolution,
  exploreCards,
  type ExploreOptions,
} from './explore.ts'
import { periodKey } from './periods.ts'
import { recommend } from './recommend.ts'
import { setupNotes } from './setup.ts'

// `merchant` is a merchant id.
export type CheatSheetItem =
  { label: string; category: string } | { label: string; merchant: string }

export const CHEAT_SHEET_ITEMS: CheatSheetItem[] = [
  { label: 'Groceries', category: 'grocery.supermarket' },
  { label: 'Dining', category: 'dining' },
  { label: 'Gas', category: 'gas' },
  { label: 'Amazon', merchant: 'amazon' },
  { label: 'Costco', merchant: 'costco' },
  { label: 'Travel', category: 'travel' },
  { label: 'Streaming', category: 'streaming' },
  { label: 'Drugstores', category: 'drugstore' },
  { label: 'Everything else', category: 'other' },
]

export type CheatSheetRow = {
  label: string
  cardId: string | null // null when none of the cards work there
  cardName: string | null // the checkout label when the wallet has one
  effectiveReturnPct: number | null
  matchedRule: string | null
  note: string | null // the top card's first warning, e.g. a cap nearly used
}

export type CheatSheet = {
  scope: 'wallet' | 'all cards' // whose cards each row picks from
  quarter: string // "Q4 2026"
  date: string
  rows: CheatSheetRow[]
  notes: string[] // what the wallet still needs: picks, activations, missing quarters
}

// The best card in the wallet for each everyday kind of purchase on `date`,
// with caps, picks and activations as the wallet has them.
export function cheatSheet(
  catalog: Catalog,
  wallet: Wallet,
  date: string,
  items: CheatSheetItem[] = CHEAT_SHEET_ITEMS,
): CheatSheet {
  const rows = items.map((item): CheatSheetRow => {
    const merchant =
      'merchant' in item
        ? resolveMerchantById(catalog, item.merchant, null)
        : categoryResolution(catalog, item.category, null)
    if (!merchant) throw new Error(`unknown merchant '${item.label}'`)
    const rec = recommend(
      catalog,
      wallet,
      {
        merchant: merchant.input,
        amount: null,
        channel: null,
        date,
        country: 'US',
      },
      merchant,
    )
    const top = rec.ranked.find((r) => r.cardId === rec.decision?.cardId)
    return {
      label: item.label,
      cardId: top?.cardId ?? null,
      cardName: top ? (top.checkoutLabel ?? top.cardName) : null,
      effectiveReturnPct: top?.effectiveReturnPct ?? null,
      matchedRule: top?.matchedRule ?? null,
      note: top?.warnings[0] ?? null,
    }
  })
  const notes = [
    ...new Set(
      wallet.cards.flatMap((held) =>
        setupNotes(catalog, wallet, held, date).map((n) => n.text),
      ),
    ),
  ]
  const [year, q] = (periodKey('quarter', date, null) ?? '').split('-')
  return {
    scope: 'wallet',
    quarter: `${q ?? ''} ${year ?? ''}`,
    date,
    rows,
    notes,
  }
}

// The best card earnrate knows for each everyday kind of purchase, for
// someone who hasn't named any cards. Each row's note says what the card
// costs or needs.
export function catalogCheatSheet(
  catalog: Catalog,
  date: string,
  options: ExploreOptions,
  items: CheatSheetItem[] = CHEAT_SHEET_ITEMS,
): CheatSheet {
  const rows = items.map((item): CheatSheetRow => {
    const top = exploreCards(
      catalog,
      'merchant' in item
        ? {
            merchant:
              catalog.merchants.seed.find((m) => m.id === item.merchant)
                ?.name ??
              catalog.merchants.overrides.find((m) => m.id === item.merchant)
                ?.name ??
              item.label,
            category: null,
            amount: null,
            channel: null,
            date,
          }
        : {
            merchant: null,
            category: item.category,
            amount: null,
            channel: null,
            date,
          },
      options,
    ).ranked[0]
    const fee =
      top?.annualFee === null || top?.annualFee === undefined
        ? null
        : top.annualFee === 0
          ? 'No annual fee.'
          : `$${String(top.annualFee)} annual fee.`
    return {
      label: item.label,
      cardId: top?.cardId ?? null,
      cardName: top?.cardName ?? null,
      effectiveReturnPct: top?.effectiveReturnPct ?? null,
      matchedRule: top?.matchedRule ?? null,
      note: top
        ? [fee, ...top.conditions].filter((n) => n !== null).join(' ')
        : null,
    }
  })
  const [year, q] = (periodKey('quarter', date, null) ?? '').split('-')
  return {
    scope: 'all cards',
    quarter: `${q ?? ''} ${year ?? ''}`,
    date,
    rows,
    notes: [],
  }
}
