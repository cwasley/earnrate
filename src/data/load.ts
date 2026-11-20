import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { z } from 'zod'
import { CONFIG_DIR, WALLET_ENV_VAR } from '../brand.ts'
import { CardSchema, type Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import { CategoriesFileSchema } from '../schema/category.ts'
import { ChangesFileSchema, type Release } from '../schema/changes.ts'
import { CurrenciesFileSchema } from '../schema/currency.ts'
import { IssuersFileSchema } from '../schema/issuer.ts'
import { MembershipsFileSchema } from '../schema/membership.ts'
import { MerchantsFileSchema } from '../schema/merchant.ts'
import { WalletSchema, type Wallet } from '../schema/wallet.ts'
import {
  CATALOG_FILE_FORMAT,
  catalogOf,
  parsePart,
  type CatalogFile,
  type CatalogSource,
} from './catalog-file.ts'

export const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url))

async function readYaml<S extends z.ZodType>(
  file: string,
  schema: S,
): Promise<z.output<S>> {
  return parsePart(file, await readRaw(file), schema)
}

async function readRaw(file: string): Promise<unknown> {
  return parse(await readFile(file, 'utf8'))
}

const cardFiles = async (dir: string) =>
  (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort()

async function loadCards(dir: string): Promise<Card[]> {
  return Promise.all(
    (await cardFiles(dir)).map(async (f) => {
      const card = await readYaml(path.join(dir, f), CardSchema)
      if (f !== `${card.id}.yaml`) {
        throw new Error(`${f}: file name must match card id '${card.id}'`)
      }
      return card
    }),
  )
}

export async function loadCatalog(dir = DATA_DIR): Promise<Catalog> {
  const [
    categories,
    currencies,
    issuers,
    memberships,
    cards,
    seed,
    overrides,
    releases,
  ] = await Promise.all([
    readYaml(path.join(dir, 'categories.yaml'), CategoriesFileSchema),
    readYaml(path.join(dir, 'currencies.yaml'), CurrenciesFileSchema),
    readYaml(path.join(dir, 'issuers.yaml'), IssuersFileSchema),
    readYaml(path.join(dir, 'memberships.yaml'), MembershipsFileSchema),
    loadCards(path.join(dir, 'cards')),
    readYaml(path.join(dir, 'merchants', 'seed.yaml'), MerchantsFileSchema),
    readYaml(
      path.join(dir, 'merchants', 'overrides.yaml'),
      MerchantsFileSchema,
    ),
    loadChanges(dir),
  ])
  return catalogOf({
    categories,
    currencies,
    issuers,
    memberships,
    cards,
    merchants: { seed, overrides },
    releases,
  })
}

// The data files as written, with the data version, for the iPhone app's
// download (src/data/catalog-file.ts).
export async function catalogFile(dir = DATA_DIR): Promise<CatalogFile> {
  const raw = (file: string) => readRaw(path.join(dir, file))
  const cards = path.join(dir, 'cards')
  const data: CatalogSource = {
    categories: await raw('categories.yaml'),
    currencies: await raw('currencies.yaml'),
    issuers: await raw('issuers.yaml'),
    memberships: await raw('memberships.yaml'),
    cards: await Promise.all(
      (await cardFiles(cards)).map((f) => readRaw(path.join(cards, f))),
    ),
    merchants: {
      seed: await raw('merchants/seed.yaml'),
      overrides: await raw('merchants/overrides.yaml'),
    },
    changes: await raw('changes.yaml'),
  }
  const version = (await readFile(path.join(dir, 'VERSION'), 'utf8')).trim()
  return { format: CATALOG_FILE_FORMAT, version, data }
}

// The structured change record, newest release first.
export function loadChanges(dir = DATA_DIR): Promise<Release[]> {
  return readYaml(path.join(dir, 'changes.yaml'), ChangesFileSchema)
}

// MCP clients pass config values through without a shell, so "~" or
// "${HOME}" can arrive as literal text; expand them here.
export function walletPath(env: NodeJS.ProcessEnv = process.env): string {
  const given = env[WALLET_ENV_VAR]?.trim()
  if (!given) return path.join(homedir(), CONFIG_DIR, 'wallet.yaml')
  const expanded = given
    .replace(/^~(?=$|[/\\])/, homedir())
    .replace(/\$\{HOME\}|\$HOME\b/g, homedir())
  return path.resolve(expanded)
}

export function loadWallet(file = walletPath()): Promise<Wallet> {
  return readYaml(file, WalletSchema)
}
