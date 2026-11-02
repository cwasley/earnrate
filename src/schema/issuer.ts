import { z } from 'zod'
import { KebabId } from './common.ts'

export const IssuerSchema = z.strictObject({
  id: KebabId,
  name: z.string().min(1), // as shown: "American Express"
  search: z.array(z.string().min(1)).default([]), // other words people use
})

export const IssuersFileSchema = z.array(IssuerSchema).min(1)

export type Issuer = z.output<typeof IssuerSchema>
