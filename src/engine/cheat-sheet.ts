import {
  categoryResolution,
  resolveMerchantById,
} from '../merchants/resolve.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet } from '../schema/wallet.ts'
import { exploreCards, type ExploreOptions } from './explore.ts'
import { bonusStatus } from './bonus.ts'
import { EPSILON, isClose } from './compare.ts'
import { periodKey } from './periods.ts'
import { recommend } from './recommend.ts'
import { checklist } from './checklist.ts'
import { setupNotes } from './setup.ts'
import { capitalize, feeText, listed, money, shortDate } from './text.ts'
import type { RankedCard } from './types.ts'

// `merchant` is a merchant id.
export type CheatSheetItem =
  { label: string; category: string } | { label: string; merchant: string }

// The everyday kinds of purchase: the cheat sheet's rows and the site's
// quick picks.
export const EVERYDAY_PURCHASES: CheatSheetItem[] = [
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
  items: CheatSheetItem[] = EVERYDAY_PURCHASES,
): CheatSheet {
  const ranked: { label: string; cards: RankedCard[] }[] = []
  const rows = items.map((item): CheatSheetRow => {
    const merchant =
      'merchant' in item
        ? resolveMerchantById(catalog, item.merchant, null)
        : categoryResolution(catalog, item.category, null)
    if (!merchant)
      throw new Error(
        `unknown merchant '${'merchant' in item ? item.merchant : item.category}' for ${item.label}`,
      )
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
    // The card that earns the most, even when a welcome bonus would take the
    // pick for one purchase: the sheet is for the whole quarter.
    const top = rec.decision ? rec.ranked[0] : undefined
    ranked.push({ label: item.label, cards: rec.ranked })
    return {
      label: item.label,
      cardId: top?.cardId ?? null,
      cardName: top ? (top.checkoutLabel ?? top.cardName) : null,
      effectiveReturnPct: top?.effectiveReturnPct ?? null,
      matchedRule: top?.matchedRule ?? null,
      note: top?.warnings[0] ?? null,
    }
  })
  const bonuses = wallet.cards.flatMap((held) => {
    const status = bonusStatus(catalog, wallet, held, date)
    if (status?.state !== 'open') return []
    const name =
      held.checkout_label ??
      catalog.cards.find((c) => c.id === held.id)?.name ??
      held.id
    // Rows where the bonus card matches the row's card, or is close to it
    // (as single answers mention it).
    const matches: string[] = []
    const near: string[] = []
    for (const { label, cards } of ranked) {
      const best = cards[0]?.effectiveReturnPct
      const own = cards.find((c) => c.cardId === held.id)?.effectiveReturnPct
      if (best === undefined || own === undefined) continue
      if (best - own < EPSILON) matches.push(label.toLowerCase())
      else if (isClose(own, best)) near.push(label.toLowerCase())
    }
    const where = [
      ...(matches.length > 0
        ? [`matches the listed card on ${listed(matches)}`]
        : []),
      ...(near.length > 0 ? [`comes within a point on ${listed(near)}`] : []),
    ]
    return [
      `Working on ${name}'s welcome bonus: ${money(status.remaining ?? 0)} more by ${shortDate(status.deadline ?? date)}. ${
        where.length > 0
          ? `It ${where.join(' and ')}, so those are the places to use it.`
          : 'It trails the listed cards everywhere, so use it on everyday spending only as needed to reach the bonus.'
      }`,
    ]
  })
  // Picks and activations in plain words, as the to-do list says them; the
  // setup notes name ids for an agent to set.
  const todo = checklist(catalog, wallet, date).filter(
    (i) => i.kind === 'pick' || i.kind === 'activate',
  )
  const notes = [
    ...new Set([
      ...bonuses,
      ...todo.map((i) => i.text),
      ...wallet.cards.flatMap((held) =>
        setupNotes(catalog, wallet, held, date)
          .filter((n) => n.kind !== 'pick' && n.kind !== 'activation')
          .map((n) =>
            n.kind === 'membership'
              ? n.text.replace(/ \([a-z0-9-]+\)/g, '')
              : n.text,
          ),
      ),
    ]),
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
  items: CheatSheetItem[] = EVERYDAY_PURCHASES,
): CheatSheet {
  const rows = items.map((item): CheatSheetRow => {
    const top = exploreCards(
      catalog,
      'merchant' in item
        ? {
            merchant:
              resolveMerchantById(catalog, item.merchant, null)?.resolvedName ??
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
    const fee = top ? `${capitalize(feeText(top))}.` : null
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
