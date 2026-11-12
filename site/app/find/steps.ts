// Find a card's answer, worked out off the page's thread: every card alone
// and in pairs, then the welcome-offer ranking, together so the two always
// describe the same spending.
import type { CardFilters } from '../../../src/engine/explore.ts'
import {
  compareOffers,
  type OfferFilters,
  type OfferSummary,
} from '../../../src/engine/offers.ts'
import {
  nothingCounted,
  resolveSpendLines,
  simulateCatalog,
  spendLineFor,
  type CatalogSimulation,
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
}

export type Part =
  | {
      part: 'answer'
      result: CatalogSimulation | null
      offers: OfferSummary[]
    }
  | { part: 'done' }

export type WorkerRequest = { catalog: Catalog; job: Job }

export function steps(catalog: Catalog, job: Job): (() => Part)[] {
  const { rows, typical, options, offerFilters, today } = job
  return [
    () => {
      const known = resolveSpendLines(
        catalog,
        rows.map((r) => spendLineFor(catalog, r.what, r.monthly)),
      ).filter((l) => l.merchant.source !== 'none')
      if (known.length === 0 || nothingCounted(catalog, known) !== null)
        return { part: 'answer', result: null, offers: [] }
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
      }
    },
    () => ({ part: 'done' }),
  ]
}
