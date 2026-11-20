// The card data as one file the iPhone app downloads from earnrate.dev, so
// a data release reaches the app without an app update. The app checks the
// tiny version file (briefly cached, so an unchanged check is a 304), and
// downloads the release's own file, named by its version and cached for
// good, only when it's newer than the data it has. It holds the data files as written, not the parsed catalog: the
// app checks them with its own schemas and derives the rest itself, so a
// release its engine can't read is refused and the app keeps what it has.
// Node-free: the app's engine runs this.
import { z } from 'zod'
import { holderReleases } from '../engine/changes.ts'
import { offerRecords } from '../engine/offer-history.ts'
import { CardSchema } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import { CategoriesFileSchema } from '../schema/category.ts'
import {
  ChangesFileSchema,
  DATA_VERSION,
  type Release,
} from '../schema/changes.ts'
import { CurrenciesFileSchema } from '../schema/currency.ts'
import { IssuersFileSchema } from '../schema/issuer.ts'
import { MembershipsFileSchema } from '../schema/membership.ts'
import { MerchantsFileSchema } from '../schema/merchant.ts'
import { catalogProblems } from './integrity.ts'

// Goes up only when an app that reads the current format would misread a
// new file, not when the data changes; the app refuses a format it
// doesn't know.
export const CATALOG_FILE_FORMAT = 1

export const CATALOG_VERSION_FILE = 'app/catalog-version.json'
export const catalogFilePath = (version: string) =>
  `app/catalog/${version}.json`

// Each data file's contents, as read from its YAML.
export type CatalogSource = {
  categories: unknown
  currencies: unknown
  issuers: unknown
  memberships: unknown
  cards: unknown[]
  merchants: { seed: unknown; overrides: unknown }
  changes: unknown
}

export type CatalogVersion = { format: number; version: string }
export type CatalogFile = CatalogVersion & { data: CatalogSource }

export function parsePart<S extends z.ZodType>(
  label: string,
  raw: unknown,
  schema: S,
): z.output<S> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error(`${label}\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

// The catalog from its parsed files: the change record is kept only as the
// to-do list and the offer histories use it.
export function catalogOf(
  parts: Omit<Catalog, 'changes' | 'offerRecords'> & {
    releases: Release[]
  },
): Catalog {
  const { releases, ...rest } = parts
  return {
    ...rest,
    changes: holderReleases(releases),
    offerRecords: offerRecords(releases),
  }
}

const VersionSchema = z.strictObject({
  format: z.number().int().positive(),
  version: z.string().regex(DATA_VERSION),
})

export const parseCatalogVersion = (raw: unknown): CatalogVersion =>
  parsePart('catalog version', raw, VersionSchema)

// A downloaded catalog file, checked as the data files themselves are
// checked (schemas, then the integrity rules). Throws on anything this
// engine can't read.
export function parseCatalogFile(raw: unknown): {
  version: string
  catalog: Catalog
} {
  const file = parsePart(
    'catalog file',
    raw,
    VersionSchema.extend({
      data: z.strictObject({
        categories: z.unknown(),
        currencies: z.unknown(),
        issuers: z.unknown(),
        memberships: z.unknown(),
        cards: z.array(z.unknown()),
        merchants: z.strictObject({
          seed: z.unknown(),
          overrides: z.unknown(),
        }),
        changes: z.unknown(),
      }),
    }),
  )
  if (file.format !== CATALOG_FILE_FORMAT) {
    throw new Error(`Unknown catalog format ${String(file.format)}.`)
  }
  const { data } = file
  const catalog = catalogOf({
    categories: parsePart('categories', data.categories, CategoriesFileSchema),
    currencies: parsePart('currencies', data.currencies, CurrenciesFileSchema),
    issuers: parsePart('issuers', data.issuers, IssuersFileSchema),
    memberships: parsePart(
      'memberships',
      data.memberships,
      MembershipsFileSchema,
    ),
    cards: data.cards.map((card, i) =>
      parsePart(`cards[${String(i)}]`, card, CardSchema),
    ),
    merchants: {
      seed: parsePart(
        'merchants seed',
        data.merchants.seed,
        MerchantsFileSchema,
      ),
      overrides: parsePart(
        'merchants overrides',
        data.merchants.overrides,
        MerchantsFileSchema,
      ),
    },
    releases: parsePart('changes', data.changes, ChangesFileSchema),
  })
  const problems = catalogProblems(catalog)
  if (problems.length > 0) {
    throw new Error(`The card data has problems:\n${problems.join('\n')}`)
  }
  return { version: file.version, catalog }
}

// Newer data versions sort later: "2026.11.17.2" after "2026.11.17".
export function compareDataVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('.').map(Number)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
