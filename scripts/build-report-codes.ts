// Writes site/report-codes.gen.json, the codes the site Worker checks a
// short report link against before storing it (site/report-check.ts), so
// it carries no card data. `yarn site:build` runs it; the Worker bundles it
// through the "earnrate:report-codes" alias in both wrangler configs.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reportCodes } from '../site/rate/link.ts'
import { loadCatalog } from '../src/data/load.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const text = JSON.stringify(reportCodes(await loadCatalog()))
await writeFile(path.join(ROOT, 'site', 'report-codes.gen.json'), text)
console.log(
  `Wrote site/report-codes.gen.json (${String(Buffer.byteLength(text))} bytes).`,
)
