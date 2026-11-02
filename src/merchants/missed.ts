import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { CONFIG_DIR, MISSED_ENV_VAR } from '../brand.ts'
import { normalizeMerchantName } from './resolve.ts'

// Stores earnrate didn't recognize, kept only on this computer so the user
// (and, if they choose to share them, earnrate's data) can see which
// merchants to add. The hosted server never keeps one.

export type MissLog = {
  note(name: string, category: string | null, today: string): Promise<void>
}

const MissedFileSchema = z.object({
  version: z.literal(1),
  merchants: z.record(
    z.string(),
    z.object({
      name: z.string(),
      count: z.number().int().positive(),
      last_seen: z.string(),
      categories: z.array(z.string()).default([]),
    }),
  ),
})

export type MissedMerchant = z.output<
  typeof MissedFileSchema
>['merchants'][string]

const MAX = 500

// $EARNRATE_MISSED_MERCHANTS names another file, or "off" keeps no log.
export function missedPath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const given = env[MISSED_ENV_VAR]?.trim()
  if (given === 'off') return null
  return given || path.join(homedir(), CONFIG_DIR, 'missed-merchants.json')
}

export async function readMissed(file: string): Promise<MissedMerchant[]> {
  try {
    const parsed = MissedFileSchema.safeParse(
      JSON.parse(await readFile(file, 'utf8')),
    )
    return parsed.success ? Object.values(parsed.data.merchants) : []
  } catch {
    return []
  }
}

// Writes are queued, so concurrent tool calls never lose a count. A file that
// can't be read as a log is left alone.
export function missLogAt(file: string): MissLog {
  let queue: Promise<unknown> = Promise.resolve()
  return {
    note(name, category, today) {
      const key = normalizeMerchantName(name)
      if (key === '') return Promise.resolve()
      const run = queue.then(async () => {
        let merchants: z.output<typeof MissedFileSchema>['merchants'] = {}
        try {
          const parsed = MissedFileSchema.safeParse(
            JSON.parse(await readFile(file, 'utf8')),
          )
          if (!parsed.success) return
          merchants = parsed.data.merchants
        } catch (e) {
          if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT'))
            return
        }
        const seen = merchants[key]
        merchants[key] = {
          name: name.trim(),
          count: (seen?.count ?? 0) + 1,
          last_seen: today,
          categories: [
            ...new Set([
              ...(seen?.categories ?? []),
              ...(category === null ? [] : [category]),
            ]),
          ],
        }
        const kept = Object.entries(merchants)
          .sort(([, a], [, b]) => b.last_seen.localeCompare(a.last_seen))
          .slice(0, MAX)
        await mkdir(path.dirname(file), { recursive: true })
        const tmp = `${file}.${String(process.pid)}.tmp`
        await writeFile(
          tmp,
          `${JSON.stringify({ version: 1, merchants: Object.fromEntries(kept) }, null, 2)}\n`,
        )
        await rename(tmp, file)
      })
      queue = run.catch(() => undefined)
      return run.catch(() => undefined)
    },
  }
}
