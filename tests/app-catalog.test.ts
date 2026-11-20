import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, test } from 'vitest'
import {
  CATALOG_FILE_FORMAT,
  CATALOG_VERSION_FILE,
  catalogFilePath,
  compareDataVersions,
  parseCatalogFile,
  parseCatalogVersion,
  type CatalogFile,
} from '../src/data/catalog-file.ts'
import { catalogFile, loadCatalog } from '../src/data/load.ts'

const ROOT = path.join(import.meta.dirname, '..')
const run = promisify(execFile)

let file: CatalogFile

beforeAll(async () => {
  file = await catalogFile()
})

const copy = (): CatalogFile => structuredClone(file)

describe("the iPhone app's card data download", () => {
  test('is the data as written, at data/VERSION', async () => {
    const version = (
      await readFile(path.join(ROOT, 'data/VERSION'), 'utf8')
    ).trim()
    expect(file.version).toBe(version)
    expect(file.format).toBe(CATALOG_FILE_FORMAT)
    const parsed = parseCatalogFile(JSON.parse(JSON.stringify(file)))
    expect(parsed.version).toBe(version)
    expect(parsed.catalog).toEqual(await loadCatalog())
  })

  test('refuses a file this engine reads differently', () => {
    expect(() => parseCatalogFile({ ...copy(), format: 2 })).toThrow(
      /Unknown catalog format 2/,
    )
    const extra = copy()
    extra.data.cards[0] = {
      ...(extra.data.cards[0] as object),
      new_field: 1,
    }
    expect(() => parseCatalogFile(extra)).toThrow(/cards\[0\]/)
    const missing = copy()
    missing.data.cards.push(structuredClone(missing.data.cards[0]))
    expect(() => parseCatalogFile(missing)).toThrow(/duplicate card id/)
    expect(() => parseCatalogFile({ ...copy(), version: 'latest' })).toThrow()
  })

  test('newer data versions sort later', () => {
    expect(compareDataVersions('2026.11.17.2', '2026.11.17')).toBeGreaterThan(0)
    expect(compareDataVersions('2026.11.17', '2026.11.17.1')).toBeLessThan(0)
    expect(compareDataVersions('2026.12.01', '2026.11.30.4')).toBeGreaterThan(0)
    expect(compareDataVersions('2026.11.17.2', '2026.11.17.2')).toBe(0)
  })

  test('yarn site:build writes it and its version to /app/, cached briefly', async () => {
    const out = await mkdtemp(path.join(tmpdir(), 'earnrate-app-'))
    try {
      await run(process.execPath, ['scripts/build-app-catalog.ts'], {
        cwd: ROOT,
        env: { ...process.env, EARNRATE_PAGES_OUT: out },
      })
      const written = JSON.parse(
        await readFile(path.join(out, catalogFilePath(file.version)), 'utf8'),
      ) as unknown
      expect(written).toEqual(JSON.parse(JSON.stringify(file)))
      const version = parseCatalogVersion(
        JSON.parse(
          await readFile(path.join(out, CATALOG_VERSION_FILE), 'utf8'),
        ),
      )
      expect(version).toEqual({ format: file.format, version: file.version })
    } finally {
      await rm(out, { recursive: true, force: true })
    }
    const pkg = await readFile(path.join(ROOT, 'package.json'), 'utf8')
    expect(pkg).toMatch(
      /"site:build": "[^"]*node scripts\/build-app-catalog\.ts/,
    )
  })

  test('the version file is cached briefly, each release for good', async () => {
    const text = await readFile(path.join(ROOT, 'site/public/_headers'), 'utf8')
    const blocks = new Map<string, string[]>()
    let current: string[] = []
    for (const line of text.split('\n')) {
      if (line.startsWith('/')) blocks.set(line.trim(), (current = []))
      else if (line.startsWith('  ')) current.push(line.trim())
    }
    expect(blocks.get(`/${CATALOG_VERSION_FILE}`)).toEqual([
      'Cache-Control: public, max-age=300',
    ])
    expect(catalogFilePath(file.version)).toBe(
      `app/catalog/${file.version}.json`,
    )
    expect(blocks.get('/app/catalog/*')).toEqual([
      'Cache-Control: public, max-age=31536000, immutable',
    ])
    expect(blocks.get('/app/*')).toEqual(['X-Robots-Tag: noindex'])
    // Only one rule sets each file's caching.
    const caching = [...blocks].filter(
      ([p, h]) =>
        p.startsWith('/app/') && h.some((x) => x.startsWith('Cache-Control')),
    )
    expect(caching.map(([p]) => p)).toEqual([
      `/${CATALOG_VERSION_FILE}`,
      '/app/catalog/*',
    ])
  })

  test('the privacy page says what the app downloads and that it sends nothing else', async () => {
    const privacy = (
      await readFile(path.join(ROOT, 'site/privacy.html'), 'utf8')
    ).replace(/\s+/g, ' ')
    expect(privacy).toContain('earnrate.dev/app/')
    expect(privacy).toContain('sends nothing else')
  })
})
