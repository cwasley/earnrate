import { z } from 'zod'

export const KebabId = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'expected a kebab-case id')

// Dotted path: `grocery.supermarket` is a child of `grocery`, and a rule that
// matches `grocery` also matches every child.
export const CategoryId = z
  .string()
  .regex(/^[a-z_]+(\.[a-z_]+)*$/, 'expected a category id like grocery.online')

export const CurrencyId = z
  .string()
  .regex(/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/, 'expected a currency id like MR')

export const Mcc = z.number().int().min(0).max(9999)

export const Network = z.enum(['visa', 'mastercard', 'amex', 'discover'])

// A store card (Target Circle Card, Kohl's Card) runs on the store's own
// network and works only at the merchants in the card's `only_at`.
export const CardNetwork = z.enum([...Network.options, 'store'])

export const IsoDate = z.iso.date()

// YAML reads `period: 2026` as a number, so accept both and normalize.
export const PeriodKey = z.preprocess(
  (v) => (typeof v === 'number' ? String(v) : v),
  z
    .string()
    .regex(
      /^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/,
      'expected a period like 2026, 2026-Q4 or 2026-10',
    ),
)

export const ValueRange = z
  .tuple([z.number().positive(), z.number().positive()])
  .refine(([low, high]) => low <= high, 'range must be [low, high]')
