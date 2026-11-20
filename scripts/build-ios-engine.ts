// Writes the iPhone app's engine (one script for JavaScriptCore) and its
// card data into ios/earnrate/earnrate/Engine/. Both are build output.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { loadCatalog } from '../src/data/load.ts'

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
await writeFile(
  path.join(OUT, 'catalog.json'),
  JSON.stringify(await loadCatalog()),
)
console.log(`Wrote ${path.relative(ROOT, OUT)}/engine.js and catalog.json.`)
