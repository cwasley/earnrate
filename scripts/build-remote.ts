// Writes remote/catalog.gen.json, the card data the remote MCP Worker bundles
// (Workers have no filesystem). Run before deploying or testing the Worker.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalog } from '../src/data/load.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const [catalog, pkg] = await Promise.all([
  loadCatalog(),
  readFile(path.join(ROOT, 'package.json'), 'utf8'),
])
await writeFile(
  path.join(ROOT, 'remote', 'catalog.gen.json'),
  JSON.stringify({
    catalog,
    version: (JSON.parse(pkg) as { version: string }).version,
  }),
)
console.log('Wrote remote/catalog.gen.json.')
