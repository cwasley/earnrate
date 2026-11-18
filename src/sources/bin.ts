#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { DATA_DIR, loadCatalog } from '../data/load.ts'
import { localToday } from '../engine/periods.ts'
import {
  compareOfferSources,
  compareSources,
  formatReport,
  offerSourceUrls,
  pagesToLoadAgain,
  type PageSnapshot,
  takingTurns,
  withLoads,
  type LineCache,
  hasChanges,
  SourcesLockSchema,
  sourceUrls,
  type SourcesLock,
} from './check.ts'
import { fetchSnapshots } from './fetch.ts'
import { earningLines } from './text.ts'

// Exit codes: 0 nothing changed, 2 only pages that couldn't be reached,
// 3 something changed. 1 stays free for crashes, so CI can tell them apart.
const { values } = parseArgs({
  options: {
    update: { type: 'boolean' },
    report: { type: 'string' },
    dump: { type: 'string' },
    // Comma-separated card ids: check only their pages.
    cards: { type: 'string' },
    // Only the welcome offer quotes, on the pages that carry them (the
    // Thursday run). Reports only; the lock stays as it is.
    offers: { type: 'boolean' },
  },
})

if (values.offers && values.update) {
  process.stderr.write(
    '--offers checks only offer quotes and never updates the lock; run --update without it.\n',
  )
  process.exit(1)
}
const offersOnly = values.offers === true

// Between two pages from one site in the offers-only run, which is
// scheduled and has time to spare.
const SAME_HOST_PAUSE_MS = 10_000

const LOCK = path.join(DATA_DIR, 'sources.lock.json')
// Gitignored: issuer text stays on this machine.
const CACHE = path.join(DATA_DIR, '..', '.sources-cache.json')
const today = localToday()

let lock: SourcesLock = { version: 1, pages: {} }
try {
  lock = SourcesLockSchema.parse(JSON.parse(await readFile(LOCK, 'utf8')))
} catch (e) {
  if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e
}

const catalog = await loadCatalog()
const only =
  values.cards === undefined
    ? undefined
    : new Set(
        values.cards
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      )
const unknown = [...(only ?? [])].filter(
  (id) => !catalog.cards.some((c) => c.id === id),
)
if (unknown.length > 0) {
  process.stderr.write(`Unknown card id: ${unknown.join(', ')}\n`)
  process.exit(1)
}
const urls = offersOnly
  ? takingTurns([...offerSourceUrls(catalog, only).keys()])
  : [...sourceUrls(catalog, only).keys()]
let started = Date.now()
const snapshots = await fetchSnapshots(
  urls,
  (s) => {
    const seconds = Math.round((Date.now() - started) / 1000)
    started = Date.now()
    process.stderr.write(
      `${s.ok ? 'ok  ' : 'FAIL'} ${String(seconds).padStart(3)}s ${s.url}${s.ok ? '' : ` (${s.reason})`}\n`,
    )
  },
  offersOnly ? SAME_HOST_PAUSE_MS : 0,
)

if (values.dump) {
  await mkdir(values.dump, { recursive: true })
  for (const s of snapshots.values()) {
    if (!s.ok) continue
    const name = s.url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_')
    const first = s.loads[0]
    if (!first) continue
    await writeFile(path.join(values.dump, `${name}.txt`), first.innerText)
    await writeFile(
      path.join(values.dump, `${name}.content.txt`),
      first.fullText,
    )
  }
}

let previous: LineCache = {}
try {
  previous = JSON.parse(await readFile(CACHE, 'utf8')) as LineCache
} catch {
  // No local copy yet (or in CI): removed lines are reported as counts.
}

const compare = (loaded: Map<string, PageSnapshot>) =>
  offersOnly
    ? {
        report: compareOfferSources(catalog, loaded, lock, only),
        nextLock: lock,
      }
    : compareSources(catalog, loaded, lock, today, only)
const first = compare(snapshots)
const again = pagesToLoadAgain(catalog, first.report)
const { report, nextLock } =
  again.length === 0
    ? first
    : compare(
        withLoads(
          snapshots,
          await fetchSnapshots(
            again,
            (s) => {
              process.stderr.write(
                `${s.ok ? 'ok  ' : 'FAIL'} again ${s.url}${s.ok ? '' : ` (${s.reason})`}\n`,
              )
            },
            SAME_HOST_PAUSE_MS,
            1,
          ),
        ),
      )
const text = formatReport(report, today, previous, offersOnly)
process.stdout.write(text)
if (values.report) await writeFile(values.report, text)
if (values.update) {
  await writeFile(LOCK, `${JSON.stringify(nextLock, null, 2)}\n`)
  const lines: LineCache = { ...previous }
  for (const s of snapshots.values())
    if (s.ok)
      lines[s.url] = [
        ...new Set(s.loads.flatMap((l) => earningLines(l.innerText))),
      ]
  await writeFile(CACHE, `${JSON.stringify(lines)}\n`)
  process.stderr.write(`Updated ${path.relative(process.cwd(), LOCK)}\n`)
}

process.exitCode = hasChanges(report)
  ? 3
  : report.unreachable.length > 0
    ? 2
    : 0
