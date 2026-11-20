// Writes the card data the iPhone app downloads (src/data/catalog-file.ts)
// into site-dist/app/: the data files in one catalog/<version>.json, and a
// tiny catalog-version.json the app checks first (src/data/catalog-file.ts;
// site/public/_headers sets how long each is cached). `yarn site:build` runs it.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CATALOG_VERSION_FILE,
  catalogFilePath,
} from '../src/data/catalog-file.ts'
import { catalogFile } from '../src/data/load.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = process.env.EARNRATE_PAGES_OUT ?? path.join(ROOT, 'site-dist')
const file = await catalogFile()
const write = async (name: string, value: unknown) => {
  const text = JSON.stringify(value)
  await mkdir(path.dirname(path.join(OUT, name)), { recursive: true })
  await writeFile(path.join(OUT, name), text)
  console.log(`Wrote ${name} (${String(Buffer.byteLength(text))} bytes).`)
}
await write(catalogFilePath(file.version), file)
await write(CATALOG_VERSION_FILE, {
  format: file.format,
  version: file.version,
})
