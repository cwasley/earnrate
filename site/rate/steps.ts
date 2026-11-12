// The report's slower parts, in the order the page gets them: the card to
// add first, since the best two cards and the gaps both use it, then the
// best two cards, each fee card, and the gaps.
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
import type { Voice } from '../../src/engine/text.ts'
import type { Catalog } from '../../src/schema/catalog.ts'

export type Job = {
  input: ReportInput
  today: string
  spending: Spending
  voice: Voice
}

export type Part =
  | { part: 'best'; value: BestCards }
  | { part: 'fee'; cardId: string; value: FeeVerdict | null }
  | { part: 'next'; value: Addition | null }
  | { part: 'gaps'; value: Gap[] }
  | { part: 'done' }

export type WorkerRequest = { catalog: Catalog; job: Job }

export function steps(catalog: Catalog, job: Job): (() => Part)[] {
  const { input, today, spending, voice } = job
  const fees = input.cards
    .map((c) => c.id)
    .filter(
      (id) => (catalog.cards.find((c) => c.id === id)?.annual_fee ?? 0) > 0,
    )
  let next: Addition | null = null
  return [
    () => {
      next = reportNext(catalog, input, today, spending)
      return { part: 'next', value: next }
    },
    () => ({
      part: 'best',
      value: reportBest(catalog, input, today, spending, next),
    }),
    ...fees.map((cardId) => (): Part => ({
      part: 'fee',
      cardId,
      value:
        reportFeeCards(catalog, input, today, spending, cardId, voice)[0] ??
        null,
    })),
    () => ({
      part: 'gaps',
      value: reportGaps(
        catalog,
        input,
        today,
        spending,
        reportStart(catalog, input, today, spending).simulation,
        next?.cardId ?? null,
      ),
    }),
    () => ({ part: 'done' }),
  ]
}
