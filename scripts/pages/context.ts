// Everything a page module needs, built once from the catalog, so a test
// can render a page from the same data the build uses.
import { longDate, quarterYear, shortDate } from '../../src/engine/text.ts'
import { cardText } from '../../src/format/card-text.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { OgImage } from './og.ts'
import { ruleKit } from './rules.ts'
import { pageKit } from './site.ts'

export type GeneratedPage = {
  file: string // under site-dist: "quarterly/2026-q4.html"
  path: string // its address: "/quarterly/2026-q4"
  html: string
  lastmod: string
  noindex?: boolean // left out of the sitemap
  image?: OgImage // its preview image, drawn with the card and store pages'
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
    // "Nov 4, 2026": a page's "Updated" date, from its lastmod, in the
    // format the pages give every other date.
    dayWords: shortDate,
    thisQuarter: quarterYear(options.today),
    ...cardText(catalog),
    ...pageKit(catalog, { dataVersion: options.dataVersion, todayWords }),
    ...ruleKit(catalog, options.today),
  }
}

export type PageContext = ReturnType<typeof pageContext>
