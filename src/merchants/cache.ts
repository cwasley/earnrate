import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { CONFIG_DIR, MERCHANT_CACHE_ENV_VAR } from '../brand.ts'
import type { Classification } from './classifier.ts'

export type CachedClassification = Classification & { classifiedOn: string }

export type MerchantCache = {
  get: (key: string) => CachedClassification | undefined
  set: (key: string, value: CachedClassification) => Promise<void>
}

const EntrySchema = z.strictObject({
  category: z.string(),
  likely_mcc: z.number().int().nullable(),
  may_code_as: z.array(z.string()),
  confidence: z.enum(['medium', 'low']),
  rationale: z.string(),
  model: z.string(),
  classified_on: z.string(),
})

const CacheFileSchema = z.strictObject({
  version: z.literal(1),
  merchants: z.record(z.string(), EntrySchema),
})

type Entry = z.infer<typeof EntrySchema>

const fromEntry = (e: Entry): CachedClassification => ({
  category: e.category,
  likelyMcc: e.likely_mcc,
  mayCodeAs: e.may_code_as,
  confidence: e.confidence,
  rationale: e.rationale,
  model: e.model,
  classifiedOn: e.classified_on,
})

const toEntry = (c: CachedClassification): Entry => ({
  category: c.category,
  likely_mcc: c.likelyMcc,
  may_code_as: c.mayCodeAs,
  confidence: c.confidence,
  rationale: c.rationale,
  model: c.model,
  classified_on: c.classifiedOn,
})

export function merchantCachePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env[MERCHANT_CACHE_ENV_VAR] ??
    path.join(homedir(), CONFIG_DIR, 'merchant-cache.json')
  )
}

export function memoryCache(): MerchantCache {
  const entries = new Map<string, CachedClassification>()
  return {
    get: (key) => entries.get(key),
    set: (key, value) => {
      entries.set(key, value)
      return Promise.resolve()
    },
  }
}

// A cache file that can't be read is left alone rather than overwritten, so a
// hand edit gone wrong doesn't lose every saved classification.
export async function openMerchantCache(
  file: string,
): Promise<{ cache: MerchantCache; problem: string | null }> {
  let merchants: Record<string, Entry> = {}
  let writable = true
  let problem: string | null = null
  try {
    const result = CacheFileSchema.safeParse(
      JSON.parse(await readFile(file, 'utf8')),
    )
    if (result.success) {
      merchants = result.data.merchants
    } else {
      writable = false
      problem = `The merchant cache at ${file} isn't in the expected format, so new classifications won't be saved to it.`
    }
  } catch (e) {
    if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) {
      writable = false
      problem = `Couldn't read the merchant cache at ${file}, so new classifications won't be saved to it.`
    }
  }

  return {
    problem,
    cache: {
      get: (key) => {
        const entry = merchants[key]
        return entry ? fromEntry(entry) : undefined
      },
      set: async (key, value) => {
        merchants = { ...merchants, [key]: toEntry(value) }
        if (!writable) return
        await mkdir(path.dirname(file), { recursive: true })
        const tmp = `${file}.${String(process.pid)}.tmp`
        await writeFile(
          tmp,
          `${JSON.stringify({ version: 1, merchants }, null, 2)}\n`,
        )
        await rename(tmp, file)
      },
    },
  }
}
