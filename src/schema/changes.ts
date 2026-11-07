import { z } from 'zod'
import { CategoryId, CurrencyId, IsoDate, KebabId } from './common.ts'

// Only `issuer` means the issuer changed its terms, and only after earnrate
// had recorded the old value correctly. A term earnrate starts recording
// late is an `addition`, so earnrate's own work never reads as a rate cut.
export const ChangeCause = z.enum([
  'issuer',
  'correction',
  'addition',
  'wording',
  'quote',
  'review',
])
export type ChangeCause = z.output<typeof ChangeCause>

export const CHANGE_SUBJECTS = [
  'cards',
  'merchants',
  'categories',
  'currencies',
  'memberships',
  'issuers',
] as const
export type ChangeSubject = (typeof CHANGE_SUBJECTS)[number]

export const DATA_VERSION = /^(\d{4})\.(\d{2})\.(\d{2})(\.\d+)?$/

const ids = z.array(KebabId).min(1)

export const ChangeSchema = z
  .strictObject({
    cause: ChangeCause,
    card: KebabId.optional(),
    cards: ids.optional(),
    merchants: ids.optional(),
    categories: z.array(CategoryId).min(1).optional(),
    currencies: z.array(CurrencyId).min(1).optional(),
    memberships: ids.optional(),
    issuers: ids.optional(),
    // A path in each subject: `welcome_offer`, `rules.amazon`,
    // `credits.instacart.valid_to`. List items are found by their id.
    // Without one, the change is to the whole subject (a new card).
    field: z
      .string()
      .regex(/^[a-z_]+(\.[a-z0-9_-]+)*$/)
      .optional(),
    // The field's value before and after, as written in the data file.
    // `was: null` means it didn't exist; `now: null` means it was removed.
    was: z.unknown().optional(),
    now: z.unknown().optional(),
    summary: z.string().min(1).optional(),
    source: z.url().optional(),
    // When the change reached the data, if before its release's date.
    date: IsoDate.optional(),
    // Issuer changes: when the source check or a person first saw it, and
    // when the issuer says it took effect. Left out when not known.
    detected: IsoDate.optional(),
    effective: IsoDate.optional(),
  })
  .transform(({ card, ...change }) =>
    card === undefined ? change : { ...change, cards: [card] },
  )
  .refine(
    (c) => CHANGE_SUBJECTS.filter((s) => c[s] !== undefined).length === 1,
    'a change names one kind of subject: card(s), merchants, categories, currencies, memberships or issuers',
  )
  .refine(
    (c) =>
      c.cause !== 'issuer' ||
      (c.cards?.length === 1 &&
        c.field !== undefined &&
        c.was !== undefined &&
        c.now !== undefined &&
        c.source !== undefined),
    'an issuer change needs one card, a field, was, now and source',
  )
  .refine(
    (c) => c.cause === 'issuer' || c.summary !== undefined,
    "earnrate's own changes need a summary",
  )
  .refine(
    (c) =>
      c.cause === 'issuer' ||
      (c.detected === undefined && c.effective === undefined),
    'detected and effective are for issuer changes',
  )

export const ReleaseSchema = z
  .strictObject({
    version: z.string().regex(DATA_VERSION),
    date: IsoDate,
    changes: z.array(ChangeSchema).min(1),
  })
  .refine(
    (r) => r.date === r.version.slice(0, 10).replaceAll('.', '-'),
    "a release's date is its version's date",
  )

// Newest release first, like data/CHANGELOG.md.
export const ChangesFileSchema = z.array(ReleaseSchema).min(1)

export type Change = z.output<typeof ChangeSchema>
export type Release = z.output<typeof ReleaseSchema>
