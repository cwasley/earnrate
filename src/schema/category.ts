import { z } from 'zod'
import { CategoryId, KebabId, Mcc } from './common.ts'

export const CategorySchema = z
  .strictObject({
    id: CategoryId,
    name: z.string().min(1),
    // Typical MCCs, as hints for explanations and the LLM fallback. Matching is
    // by category, not by these.
    mccs: z.array(Mcc).default([]),
    // Everyday words people search by ("groceries"), besides the name.
    aliases: z.array(z.string().min(1)).default([]),
    // Kinds of place this category covers that earnrate.dev offers by name
    // for a store it doesn't know, besides the category itself: "Coffee
    // shop" for fast food. Each is one of the aliases, so search finds it too.
    places: z.array(z.string().min(1)).optional(),
    // What a ranking here can't express, like whether the purchase can go on a
    // card at all. Answers lead with it and their pick is low confidence.
    // Subcategories without one inherit it.
    note: z.string().min(1).optional(),
    // Cards the note names, linked beside it (the Bilt cards on rent): their
    // rules can't show what they earn here. Inherited with the note.
    cards: z.array(KebabId).min(1).optional(),
    // Answered by its note alone: no ranking or pick. Subcategories inherit it.
    unranked: z.literal(true).optional(),
    // Bought as a service, a category reads "on" (3x on flights); places read
    // "at". Subcategories inherit it.
    preposition: z.literal('on').optional(),
    // Bought only on a website or app (online retail): a purchase here is an
    // online one unless the person says otherwise. Subcategories inherit it.
    channel: z.literal('online').optional(),
    slug: z.string().optional(), // its search page, when not from its name
    // Answered by that category's search page instead of one of its own; its
    // own address redirects there.
    page: CategoryId.optional(),
  })
  .refine((c) => !c.unranked || c.note !== undefined, {
    message: 'an unranked category needs a note to answer with',
  })
  .refine((c) => c.cards === undefined || c.note !== undefined, {
    message: "a category's cards are the ones its note names",
  })
  .refine(
    (c) =>
      (c.places ?? []).every((p) =>
        c.aliases.some((a) => a.toLowerCase() === p.toLowerCase()),
      ),
    { message: "each of a category's places is one of its aliases" },
  )

export const CategoriesFileSchema = z.array(CategorySchema).min(1)

export type Category = z.output<typeof CategorySchema>
