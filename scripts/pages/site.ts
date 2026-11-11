// What every static page shares: escaping, the page frame (header,
// breadcrumbs, footer, JSON-LD, social tags), the drawn cards and the
// title and description lengths search results show.
import type { Catalog } from '../../src/schema/catalog.ts'
import { cardArtSvg, cardColor } from '../../src/format/card-art.ts'
import { TABS } from '../../site/tabs.ts'

export const SITE = 'https://earnrate.dev'
const ICON = '/favicon.svg?v=2'

// The footer every page shares, the home page and the policy pages
// included (site/vite.config.ts fills their <!--earnrate:footer-->).
// `before` is a page's own line above it, like the data version.
const FOOTER_GROUPS: [string, [string, string][]][] = [
  [
    'Find a card',
    [
      ['/best/', 'Best card for every store'],
      ['/cards/', 'All cards'],
      ['/compare/', 'Card comparisons'],
      ['/quarterly/', "This quarter's 5% categories"],
      ['/year-end/', 'Credits that end Dec 31'],
      ['/statement', 'Check a statement'],
    ],
  ],
  [
    'How it works',
    [
      ['/categories/', 'What each category covers'],
      ['/how-stores-code', 'How stores code'],
      ['/changes', 'Card term changes'],
      ['/#claude', 'Use it in Claude'],
      ['https://github.com/cwasley/earnrate', 'Source code'],
    ],
  ],
  [
    'earnrate',
    [
      ['/support', 'Support'],
      ['/companies', 'For companies'],
      ['/privacy', 'Privacy'],
      ['/terms', 'Terms'],
    ],
  ],
]

export const siteFooter = (before = '') =>
  `<footer>${before}<nav class="footer-cols" aria-label="More from earnrate">${FOOTER_GROUPS.map(
    ([head, links]) =>
      `<div><p class="footer-head">${head}</p><ul>${links.map(([href, label]) => `<li><a href="${href}">${esc(label)}</a></li>`).join('')}</ul></div>`,
  ).join(
    '',
  )}</nav><p>No affiliate links, ever. The code is MIT licensed; the card data is CC BY-NC 4.0, free for personal use, and <a href="mailto:licensing@earnrate.dev">licensed</a> for commercial use.</p></footer>`

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

// The app's tabs, so a visitor who lands here from a search can see what
// else the site does. The home page has the tabs themselves.
const APP_NAV = `<nav class="app-nav" aria-label="earnrate.dev">${TABS.map((t) => `<a href="${t.href}">${esc(t.name)}</a>`).join('')}</nav>`

// The wordmark and the tabs, on every static page and the statement check.
export const PAGE_HEADER = `<header><a class="wordmark" href="/"><svg class="mark" viewBox="0 -20 120 120" aria-hidden="true"><rect x="24" y="8" width="88" height="56" rx="10" fill="none" stroke="currentColor" stroke-width="7" opacity=".35"/><rect x="8" y="22" width="92" height="58" rx="10" fill="currentColor"/><rect x="20" y="38" width="18" height="13" rx="3" fill="var(--surface)"/></svg>earnrate</a>${APP_NAV}</header>`

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

// A description that leads with the first wording of `lead` that fits, then
// adds each later sentence, in order, in the first wording that still fits.
// A group of lead wordings that say the same thing (a long and a short card
// name) counts as one, and the one that leaves room to say the most wins.
export function fitSentences(
  lead: (string | string[])[],
  more: string[][],
): string {
  const extend = (start: string) => {
    let text = start
    let added = 0
    for (const wordings of more) {
      const next = wordings.find(
        (w) => w !== '' && text.length + 1 + w.length <= DESCRIPTION_MAX,
      )
      if (next === undefined) continue
      text = `${text} ${next}`
      added += next.length
    }
    return { text, added }
  }
  for (const group of lead) {
    const fits = (typeof group === 'string' ? [group] : group).filter(
      (w) => w.length <= DESCRIPTION_MAX,
    )
    const best = fits
      .map(extend)
      .reduce<{ text: string; added: number } | null>(
        (a, b) => (a === null || b.added > a.added ? b : a),
        null,
      )
    if (best) return best.text
  }
  const last = lead.at(-1)
  return (typeof last === 'string' ? last : last?.at(-1)) ?? ''
}

// Links as a row of chips, where a list would run on as a sentence.
export const chipLinks = (links: string[]) =>
  `<ul class="chip-links">${links.map((l) => `<li>${l}</li>`).join('')}</ul>`

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
${page.noindex ? '    <meta name="robots" content="noindex, follow" />\n' : ''}    <meta name="description" content="${esc(page.description)}" />
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
      ${PAGE_HEADER}
      ${page.crumbs.length > 0 ? crumbsHtml(page.crumbs) : ''}
${page.body}
      <aside class="next">
        <h2>Use it with your own cards</h2>
        <p><a href="/#wallet">Add your cards on earnrate.dev</a> and it picks the best one anywhere, tracking your spending caps and quarterly picks. It runs in your browser, with no sign-up.</p>
        <p>Or <a href="/#claude">use it in Claude</a>: ask on claude.ai, in the desktop app, in Claude Code or in Cowork.</p>
      </aside>
      ${siteFooter(`<p class="footer-intro">earnrate compares ${String(catalog.cards.length)} U.S. cards using each issuer's own terms; rankings depend only on those terms. Card data ${esc(context.dataVersion)}. Rates change, so check the issuer's terms before you apply. Wrong rate? <a href="/support">Tell us</a>.</p>`)}
    </main>
  </body>
</html>
`
  }

  return { art, layout }
}
