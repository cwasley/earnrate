import path from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { build } from 'esbuild'
import { expect, test } from 'vitest'
import { catalogFile, loadCatalog } from '../src/data/load.ts'
import { SmallURL } from '../ios/engine/url.ts'

const ROOT = path.join(import.meta.dirname, '..')

test("the app engine's URL reads every URL in the card data as URL does", async () => {
  const text = JSON.stringify((await catalogFile()).data)
  const urls = [...new Set(text.match(/https?:\/\/[^"\s]+/g) ?? [])]
  expect(urls.length).toBeGreaterThan(100)
  for (const url of urls) {
    const ours = new SmallURL(url)
    const real = new URL(url)
    expect(ours.hostname, url).toBe(real.hostname)
    expect(ours.protocol, url).toBe(real.protocol)
  }
})

test("the app engine's URL refuses what isn't an absolute URL", () => {
  for (const bad of [
    '',
    'example.com',
    '/cards/amex-gold',
    'https://',
    'https:// example.com',
    'not a url',
  ]) {
    expect(SmallURL.canParse(bad), bad).toBe(false)
    expect(URL.canParse(bad), bad).toBe(false)
  }
  expect(new SmallURL('https://WWW.Chase.com:443/a?b#c').host).toBe(
    'www.chase.com:443',
  )
})

test('the bundled engine checks a downloaded catalog without a URL class, as in JavaScriptCore', async () => {
  const bundle = await build({
    entryPoints: [path.join(ROOT, 'ios/engine/entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  })
  const context = createContext({})
  expect(runInContext('typeof URL', context)).toBe('undefined')
  runInContext(bundle.outputFiles[0]?.text ?? '', context)
  const engine = runInContext('earnrate', context) as {
    load: (json: string) => number
    checkCatalog: (json: string) => string
    catalogInfo: () => string
  }
  engine.load(
    JSON.stringify({ version: '2026.01.01', catalog: await loadCatalog() }),
  )
  const file = await catalogFile()
  const stored = JSON.parse(engine.checkCatalog(JSON.stringify(file))) as {
    version: string
  }
  expect(stored.version).toBe(file.version)
  expect(JSON.parse(engine.catalogInfo())).toEqual({
    version: file.version,
    format: file.format,
  })
})
