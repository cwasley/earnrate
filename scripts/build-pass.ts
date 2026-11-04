// Writes pass/bundle.gen.json, the card data and pass images the Wallet-pass
// Worker bundles (Workers have no filesystem).
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadCatalog } from '../src/data/load.ts'

const ROOT = path.join(import.meta.dirname, '..')
const ASSETS = path.join(ROOT, 'pass', 'assets')
const images: Record<string, string> = {}
for (const name of (await readdir(ASSETS)).filter((f) => f.endsWith('.png')))
  images[name] = (await readFile(path.join(ASSETS, name))).toString('base64')
await writeFile(
  path.join(ROOT, 'pass', 'bundle.gen.json'),
  JSON.stringify({ catalog: await loadCatalog(), images }),
)
console.log(
  `Wrote pass/bundle.gen.json (${String(Object.keys(images).length)} images).`,
)
