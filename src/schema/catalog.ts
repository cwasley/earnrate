import type { Card } from './card.ts'
import type { Category } from './category.ts'
import type { Currency } from './currency.ts'
import type { Merchant } from './merchant.ts'

export type Catalog = {
  categories: Category[]
  currencies: Currency[]
  cards: Card[]
  merchants: { seed: Merchant[]; overrides: Merchant[] }
}
