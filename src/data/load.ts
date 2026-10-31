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
import { CurrenciesFileSchema } from '../schema/currency.ts'
import { MerchantsFileSchema } from '../schema/merchant.ts'
import { WalletSchema, type Wallet } from '../schema/wallet.ts'

export const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url))

async function readYaml<S extends z.ZodType>(
  file: string,
  schema: S,
): Promise<z.output<S>> {
  const raw: unknown = parse(await readFile(file, 'utf8'))
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error(`${file}\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

async function loadCards(dir: string): Promise<Card[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort()
  return Promise.all(
    files.map(async (f) => {
      const card = await readYaml(path.join(dir, f), CardSchema)
      if (f !== `${card.id}.yaml`) {
        throw new Error(`${f}: file name must match card id '${card.id}'`)
      }
      return card
    }),
  )
}

export async function loadCatalog(dir = DATA_DIR): Promise<Catalog> {
  const [categories, currencies, cards, seed, overrides] = await Promise.all([
    readYaml(path.join(dir, 'categories.yaml'), CategoriesFileSchema),
    readYaml(path.join(dir, 'currencies.yaml'), CurrenciesFileSchema),
    loadCards(path.join(dir, 'cards')),
    readYaml(path.join(dir, 'merchants', 'seed.yaml'), MerchantsFileSchema),
    readYaml(
      path.join(dir, 'merchants', 'overrides.yaml'),
      MerchantsFileSchema,
    ),
  ])
  return { categories, currencies, cards, merchants: { seed, overrides } }
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
