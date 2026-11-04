// What every static page shares: escaping, the page frame (header,
// breadcrumbs, footer, JSON-LD, social tags), the drawn cards and the
// title and description lengths search results show.
import type { Catalog } from '../../src/schema/catalog.ts'
import { cardArtSvg, cardColor } from '../../src/format/card-art.ts'

export const SITE = 'https://earnrate.dev'
const ICON = '/favicon.svg?v=2'

// Search results cut titles and descriptions past about these lengths;
// tests/pages.test.ts holds every page to them.
export const TITLE_MAX = 60
export const DESCRIPTION_MAX = 155

export const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.+]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const BRAND = ' | earnrate'

// The first candidate that fits, with the brand if there's room. Candidates
// go longest first; when none fits the last is used and the length test
// fails, so a new long name gets a shorter wording.
export function fitTitle(candidates: string[]): string {
  for (const c of candidates) {
    if (c.length + BRAND.length <= TITLE_MAX) return c + BRAND
    if (c.length <= TITLE_MAX) return c
  }
  return candidates.at(-1) ?? ''
}

export const fitDescription = (candidates: string[]): string =>
  candidates.find((c) => c.length <= DESCRIPTION_MAX) ?? candidates.at(-1) ?? ''

export type Crumb = { name: string; path: string }

export type PageSpec = {
  title: string
  description: string
  path: string // "/best/costco"
  body: string
  jsonLd: object
  // Home comes first on its own; the last crumb is this page.
  crumbs: Crumb[]
  image?: string // a path under the site, 1200 x 630
  noindex?: boolean
}

export function pageKit(
  catalog: Catalog,
  context: { dataVersion: string; todayWords: string },
) {
  const art = (cardId: string, width?: number) =>
    `<span class="card-art">${cardArtSvg(cardColor(catalog, cardId), width)}</span>`

  function crumbsHtml(crumbs: Crumb[]): string {
    const all = [{ name: 'earnrate', path: '/' }, ...crumbs]
    const items = all.map((c, i) =>
      i === all.length - 1
        ? `<li aria-current="page">${esc(c.name)}</li>`
        : `<li><a href="${c.path}">${esc(c.name)}</a></li>`,
    )
    return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.join('')}</ol></nav>`
  }

  const crumbsLd = (crumbs: Crumb[]) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'earnrate', path: '/' }, ...crumbs].map(
      (c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: `${SITE}${c.path}`,
      }),
    ),
  })

  const ld = (o: object) =>
    `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`

  function layout(page: PageSpec): string {
    const canonical = `${SITE}${page.path}`
    const image = `${SITE}${page.image ?? '/og.png'}`
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(page.title)}</title>
${page.noindex ? '    <meta name="robots" content="noindex" />\n' : ''}    <meta name="description" content="${esc(page.description)}" />
    <meta name="color-scheme" content="light dark" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="earnrate" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${esc(page.title)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${image}" />
    <meta name="theme-color" content="#9a5020" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2" />
    <link rel="icon" href="${ICON}" />
    <link rel="stylesheet" href="/pages.css" />
    ${ld(page.jsonLd)}${page.crumbs.length > 0 ? `\n    ${ld(crumbsLd(page.crumbs))}` : ''}
  </head>
  <body>
    <main>
      <header><a class="wordmark" href="/">earnrate</a></header>
      ${page.crumbs.length > 0 ? crumbsHtml(page.crumbs) : ''}
${page.body}
      <aside class="next">
        <h2>Use it with your own cards</h2>
        <p><a href="/#wallet">Add your cards on earnrate.dev</a> and it picks the best one anywhere, tracking your spending caps and quarterly picks. It runs in your browser, with no sign-up.</p>
        <p>Or <a href="/#claude">use it in Claude</a>: ask on claude.ai, in the desktop app, in Claude Code or in Cowork.</p>
      </aside>
      <footer>
        <p>earnrate compares ${String(catalog.cards.length)} U.S. cards using each issuer's own terms. No affiliate links, ever: rankings depend only on those terms. Card data ${esc(context.dataVersion)}, updated ${esc(context.todayWords)}. Rates change, so check the issuer's terms before you apply. Wrong rate? <a href="/support">Tell us</a>.</p>
        <p><a href="/">earnrate.dev</a> · <a href="/best/">Best card for every store</a> · <a href="/cards/">All cards</a> · <a href="/quarterly/">5% categories this quarter</a> · <a href="/categories/">What each category covers</a> · <a href="/how-stores-code">How stores code</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/companies">For companies</a> · <a href="/support">Support</a></p>
      </footer>
    </main>
  </body>
</html>
`
  }

  return { art, layout }
}
