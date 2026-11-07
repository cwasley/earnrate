// Everything a page module needs, built once from the catalog, so a test
// can render a page from the same data the build uses.
import { longDate, quarterYear } from '../../src/engine/text.ts'
import { cardText } from '../../src/format/card-text.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import { ruleKit } from './rules.ts'
import { pageKit } from './site.ts'

export type GeneratedPage = {
  file: string // under site-dist: "quarterly/2026-q4.html"
  path: string // its address: "/quarterly/2026-q4"
  html: string
  lastmod: string
}

export function pageContext(
  catalog: Catalog,
  options: { today: string; dataVersion: string },
) {
  const todayWords = longDate(options.today)
  return {
    catalog,
    today: options.today,
    todayWords,
    // "November 4, 2026": a page's "Updated" date, from its lastmod.
    dayWords: longDate,
    thisQuarter: quarterYear(options.today),
    ...cardText(catalog),
    ...pageKit(catalog, { dataVersion: options.dataVersion, todayWords }),
    ...ruleKit(catalog),
  }
}

export type PageContext = ReturnType<typeof pageContext>
