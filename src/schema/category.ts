import { z } from 'zod'
import { CategoryId, Mcc } from './common.ts'

export const CategorySchema = z.strictObject({
  id: CategoryId,
  name: z.string().min(1),
  // Typical MCCs, as hints for explanations and the LLM fallback. Matching is
  // by category, not by these.
  mccs: z.array(Mcc).default([]),
  note: z.string().optional(),
})

export const CategoriesFileSchema = z.array(CategorySchema).min(1)

export type Category = z.output<typeof CategorySchema>
