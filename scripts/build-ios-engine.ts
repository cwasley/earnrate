// Writes the iPhone app's engine (one script for JavaScriptCore) and its
// card data into ios/earnrate/earnrate/Engine/. All three are build output:
// catalog.json is the parsed catalog with its data version (the form the
// app also stores a downloaded update in), and catalog-version.json the
// version alone, which the app compares before loading either.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { CATALOG_FILE_FORMAT } from '../src/data/catalog-file.ts'
import { DATA_DIR, loadCatalog } from '../src/data/load.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(ROOT, 'ios', 'earnrate', 'earnrate', 'Engine')
await mkdir(OUT, { recursive: true })
await build({
  entryPoints: [path.join(ROOT, 'ios', 'engine', 'entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2022',
  minify: true,
  outfile: path.join(OUT, 'engine.js'),
  logLevel: 'warning',
})
const version = (await readFile(path.join(DATA_DIR, 'VERSION'), 'utf8')).trim()
await writeFile(
  path.join(OUT, 'catalog.json'),
  JSON.stringify({ version, catalog: await loadCatalog() }),
)
await writeFile(
  path.join(OUT, 'catalog-version.json'),
  JSON.stringify({ format: CATALOG_FILE_FORMAT, version }),
)
console.log(
  `Wrote ${path.relative(ROOT, OUT)}/engine.js, catalog.json and catalog-version.json (card data ${version}).`,
)
