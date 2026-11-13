// Get a card's answer, worked out off the page's thread: every card alone
// and in pairs, then the welcome-offer ranking, together so the two always
// describe the same spending. With a saved wallet, "A new card for my
// wallet" asks what each card would add to it instead.
import {
  ALL_PERSONAL_CARDS,
  type CardFilters,
} from '../../../src/engine/explore.ts'
import {
  compareOffers,
  type OfferComparison,
  type OfferFilters,
  type OfferSummary,
} from '../../../src/engine/offers.ts'
import {
  nothingCounted,
  resolveSpendLines,
  simulateAdditions,
  simulateCatalog,
  spendLineFor,
  type CatalogSimulation,
  type WalletWhatIf,
} from '../../../src/engine/simulate.ts'
import type { Catalog } from '../../../src/schema/catalog.ts'
import type { Wallet } from '../../../src/schema/wallet.ts'
import type { Row } from '../spending-rows.ts'

export type Job = {
  rows: Row[]
  typical: boolean
  options: {
    filters: CardFilters
    memberships: string[]
    valuations: Wallet['valuations']
  }
  offerFilters: OfferFilters
  today: string
  // A new card for this wallet, in place of the best cards from scratch.
  wallet?: Wallet
}

// A new card for the wallet: every personal card it doesn't hold, by what
// it adds a year, and over its first two years with its welcome offer.
export type Additions = { whatIf: WalletWhatIf; offers: OfferComparison }

export const NEW_PERSONAL_CARDS: OfferFilters = {
  kind: 'any',
  business: false,
  noAnnualFee: false,
  includeHeld: false,
}

export type Part =
  | {
      part: 'answer'
      result: CatalogSimulation | null
      offers: OfferSummary[]
      additions: Additions | null
    }
  | { part: 'done' }

export type WorkerRequest = { catalog: Catalog; job: Job }

export function steps(catalog: Catalog, job: Job): (() => Part)[] {
  const { rows, typical, options, offerFilters, today, wallet } = job
  return [
    () => {
      const known = resolveSpendLines(
        catalog,
        rows.map((r) => spendLineFor(catalog, r.what, r.monthly)),
      ).filter((l) => l.merchant.source !== 'none')
      if (known.length === 0 || nothingCounted(catalog, known) !== null)
        return { part: 'answer', result: null, offers: [], additions: null }
      if (wallet)
        return {
          part: 'answer',
          result: null,
          offers: [],
          additions: {
            whatIf: simulateAdditions(catalog, wallet, known, {
              filters: ALL_PERSONAL_CARDS,
              memberships: wallet.memberships,
              valuations: wallet.valuations,
              start: today,
            }),
            offers: compareOffers(catalog, wallet, NEW_PERSONAL_CARDS, today, {
              lines: known,
              typical,
            }),
          },
        }
      const result = simulateCatalog(catalog, known, {
        ...options,
        start: today,
      })
      const comparison = compareOffers(
        catalog,
        {
          valuations: options.valuations,
          memberships: options.memberships,
          cards: [],
        },
        offerFilters,
        today,
        { lines: known, typical },
      )
      return {
        part: 'answer',
        result,
        offers: [...comparison.offers, ...comparison.membersOnly],
        additions: null,
      }
    },
    () => ({ part: 'done' }),
  ]
}
