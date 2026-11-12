// The report's slower parts, in the order the page shows them: the best two
// cards, each fee card, the next card, then the gaps.
import type { Spending } from '../../src/engine/renewal.ts'
import type { Addition } from '../../src/engine/simulate.ts'
import {
  reportBest,
  reportFeeCards,
  reportGaps,
  reportNext,
  reportStart,
  type BestCards,
  type FeeVerdict,
  type Gap,
  type ReportInput,
} from '../../src/engine/wallet-report.ts'
import type { Catalog } from '../../src/schema/catalog.ts'

export type Job = { input: ReportInput; today: string; spending: Spending }

export type Part =
  | { part: 'best'; value: BestCards }
  | { part: 'fee'; cardId: string; value: FeeVerdict | null }
  | { part: 'next'; value: Addition | null }
  | { part: 'gaps'; value: Gap[] }
  | { part: 'done' }

export type WorkerRequest = { catalog: Catalog; job: Job }

export function steps(catalog: Catalog, job: Job): (() => Part)[] {
  const { input, today, spending } = job
  const fees = input.cards
    .map((c) => c.id)
    .filter(
      (id) => (catalog.cards.find((c) => c.id === id)?.annual_fee ?? 0) > 0,
    )
  return [
    () => ({
      part: 'best',
      value: reportBest(catalog, input, today, spending),
    }),
    ...fees.map((cardId) => (): Part => ({
      part: 'fee',
      cardId,
      value: reportFeeCards(catalog, input, today, spending, cardId)[0] ?? null,
    })),
    () => ({
      part: 'next',
      value: reportNext(catalog, input, today, spending),
    }),
    () => ({
      part: 'gaps',
      value: reportGaps(
        catalog,
        input,
        today,
        spending,
        reportStart(catalog, input, today, spending).simulation,
      ),
    }),
    () => ({ part: 'done' }),
  ]
}
