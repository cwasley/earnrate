import type { Category } from '../schema/category.ts'

export type Classification = {
  category: string
  likelyMcc: number | null
  mayCodeAs: string[]
  confidence: 'medium' | 'low'
  rationale: string
  model: string
}

// Throws when the call fails. A classifier only ever sees the merchant text,
// never amounts, cards or wallet contents.
export type Classifier = (
  merchant: string,
  categories: Category[],
) => Promise<Classification>
