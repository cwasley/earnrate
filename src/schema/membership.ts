import { z } from 'zod'
import { KebabId } from './common.ts'

export const MembershipSchema = z.strictObject({
  id: KebabId,
  name: z.string().min(1), // "Costco membership"
  // The site's checkbox for it, when it's one most people would know.
  ask: z.string().min(1).optional(),
  // Memberships in one group are tiers: a person holds one at a time.
  group: KebabId.optional(),
  // Dollars a year, for a membership a card needs (`requires_membership`).
  annual_fee: z.number().nonnegative().optional(),
  // Merchants only members can buy from: spending there means a member.
  members_shop_at: z.array(KebabId).default([]),
})

export const MembershipsFileSchema = z.array(MembershipSchema).min(1)

export type Membership = z.output<typeof MembershipSchema>
