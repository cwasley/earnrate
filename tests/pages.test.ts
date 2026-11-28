import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { localToday } from '../src/engine/periods.ts'
import { rotationGapText } from '../src/engine/rotation.ts'
import { simulateSingles, type ResolvedLine } from '../src/engine/simulate.ts'
import {
  dateRange,
  earnText,
  longDate,
  money,
  quarterYear,
  shortDate,
  wholeDollars,
} from '../src/engine/text.ts'
import { ALL_PERSONAL_CARDS, exploreCards } from '../src/engine/explore.ts'
import { pageContext, type PageContext } from '../scripts/pages/context.ts'
import { TABS } from '../site/tabs.ts'
import { EVENTS } from '../site/events.ts'
import {
  feeWorthKit,
  type FeeWorth,
  MAX_MONTHLY,
  STEP,
} from '../src/engine/fee-worth.ts'
import { quarterlyPages, quarters } from '../scripts/pages/quarterly.ts'
import {
  yearEnd,
  yearEndLinks,
  yearEndPages,
  yearEndRedirects,
} from '../scripts/pages/year-end.ts'
import { creditWhere } from '../src/engine/rule-text.ts'
import { offerCheckedOn } from '../src/engine/offers.ts'
import {
  OFFER_HISTORY_CAVEAT,
  offerHistoryText,
  offerRecords,
} from '../src/engine/offer-history.ts'
import { offerHistorySection } from '../scripts/pages/offer-history.ts'
import {
  cheaperCards,
  cheaperCardsTable,
} from '../scripts/pages/cheaper-cards.ts'
import { CardSchema, type Card } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import {
  addDays,
  currentPeriodEnd,
  inEffect,
  periodKey,
} from '../src/engine/periods.ts'
import { allCreditsYear, periodAmount } from '../src/engine/credits.ts'
import { recentChangesSection } from '../scripts/pages/changes.ts'
import { cardChangesUrl } from '../src/engine/changes.ts'
import { ChangesFileSchema } from '../src/schema/changes.ts'
import {
  DESCRIPTION_MAX,
  esc,
  NOTIFY_SCRIPT,
  safariOnApple,
  TITLE_MAX,
} from '../scripts/pages/site.ts'
import { quoteText } from '../scripts/pages/rules.ts'
import { ROOT } from './helpers.ts'
import { PAGES_CSS_LINK } from '../scripts/pages/site.ts'
import { FILTER_SCRIPT, filterScript } from '../scripts/pages/filter.ts'
import { landingPage } from '../site/vite.config.ts'
import { siteFooter } from '../scripts/pages/site.ts'
import { eventPath, LIFE_EVENTS } from '../scripts/pages/life-events.ts'
import { PICKER_SCRIPT } from '../scripts/pages/welcome-offers.ts'
import { CARD_SURCHARGE_NOTE } from '../src/engine/offers.ts'

const catalog = await loadCatalog()
const today = localToday()
const ctx = pageContext(catalog, { today, dataVersion: 'test' })

const unescape = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.html'))
    .map((f) => path.join(dir, f))
}

describe('the built static pages', () => {
  let out = ''
  let pages: { file: string; html: string }[] = []

  beforeAll(() => {
    out = mkdtempSync(path.join(tmpdir(), 'earnrate-pages-'))
    execFileSync(process.execPath, ['scripts/build-pages.ts'], {
      cwd: ROOT,
      env: { ...process.env, EARNRATE_PAGES_OUT: out, EARNRATE_OG: 'off' },
      stdio: 'pipe',
    })
    pages = [
      ...htmlFiles(out),
      ...htmlFiles(path.join(ROOT, 'site')).filter(
        (f) => !f.includes(`${path.sep}public${path.sep}`),
      ),
    ].map((file) => ({ file, html: readFileSync(file, 'utf8') }))
  }, 180_000)

  afterAll(() => {
    rmSync(out, { recursive: true, force: true })
  })

  test('every page that links pages.css opts in to page fades inline first', async () => {
    const plugin = landingPage()
    const transform = plugin.transformIndexHtml as unknown as (
      html: string,
      ctx: { filename: string },
    ) => Promise<string>
    const missing: string[] = []
    let checked = 0
    for (const { file, html } of pages) {
      // The statement check carries all of pages.css inside the page.
      if (!html.includes(PAGES_CSS_LINK) || file.endsWith('statement.html'))
        continue
      const built = file.startsWith(out)
        ? html
        : await transform(html, { filename: file })
      const head = built.slice(0, built.indexOf('</head>'))
      const optIn = head.indexOf('@view-transition { navigation: auto; }')
      if (optIn === -1 || optIn > head.indexOf(PAGES_CSS_LINK))
        missing.push(path.relative(ROOT, file))
      checked++
    }
    expect(checked).toBeGreaterThan(100)
    expect(missing).toEqual([])
  }, 30_000)

  test('every title and description fits in a search result', () => {
    const over: string[] = []
    for (const { file, html } of pages) {
      const title = unescape(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '')
      const description = unescape(
        /<meta\s+name="description"\s+content="([^"]*)"/.exec(html)?.[1] ?? '',
      ).replace(/\s+/g, ' ')
      if (title.length > TITLE_MAX)
        over.push(`${file}: title is ${String(title.length)}: ${title}`)
      if (description.length > DESCRIPTION_MAX)
        over.push(
          `${file}: description is ${String(description.length)}: ${description}`,
        )
    }
    expect(over).toEqual([])
  })

  test('no page links to a page that does not exist', () => {
    const exists = (href: string) => {
      const p = decodeURIComponent(href.split(/[?#]/)[0] ?? '')
      if (p === '/' || p === '') return true
      const candidates = p.endsWith('/')
        ? [path.join(out, p, 'index.html')]
        : [
            path.join(out, `${p}.html`),
            path.join(out, p),
            path.join(ROOT, 'site', `${p}.html`),
            path.join(ROOT, 'site/public', p),
          ]
      return candidates.some((c) => existsSync(c))
    }
    const broken: string[] = []
    for (const { file, html } of pages)
      for (const m of html.matchAll(/href="(\/[^"]*)"/g)) {
        const href = unescape(m[1] ?? '')
        if (!exists(href)) broken.push(`${file} → ${href}`)
      }
    expect([...new Set(broken)]).toEqual([])
  })

  test('every page is in the sitemap and linked from another page', () => {
    const sitemap = readFileSync(path.join(out, 'sitemap.xml'), 'utf8')
    const listed = new Set(
      [...sitemap.matchAll(/<loc>https:\/\/earnrate\.dev([^<]*)<\/loc>/g)].map(
        (m) => m[1] ?? '',
      ),
    )
    const linked = new Set(
      pages.flatMap(({ html }) =>
        [...html.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1] ?? ''),
      ),
    )
    const missing: string[] = []
    for (const file of htmlFiles(out)) {
      const rel = path.relative(out, file).split(path.sep).join('/')
      if (rel === '404.html') continue
      const url = `/${rel.replace(/index\.html$/, '').replace(/\.html$/, '')}`
      const html = readFileSync(file, 'utf8')
      const noindex = html.includes(
        '<meta name="robots" content="noindex, follow" />',
      )
      const canonical =
        /<link rel="canonical" href="https:\/\/earnrate\.dev([^"]*)" \/>/.exec(
          html,
        )?.[1]
      if (canonical === undefined) missing.push(`${url} has no canonical`)
      // The sitemap is exactly the pages to index: not noindex, and their
      // own canonical.
      const indexable = !noindex && canonical === url
      if (!indexable && listed.has(url))
        missing.push(`${url} is not to be indexed but is in the sitemap`)
      if (indexable && !listed.has(url))
        missing.push(`${url} not in the sitemap`)
      if (
        canonical !== undefined &&
        canonical !== url &&
        !listed.has(canonical)
      )
        missing.push(`${url}'s canonical ${canonical} is not in the sitemap`)
      // Links to a page that isn't indexed go to the page that answers for
      // it, so it may have none.
      if (!linked.has(url) && !noindex)
        missing.push(`${url} not linked from any page`)
    }
    expect(missing).toEqual([])
    const indexed = (prefix: string) =>
      [...listed].filter((u) => u.startsWith(prefix) && u !== prefix).length
    // Store and category pages, comparisons and year-end pages are each
    // indexed only where they say something of their own.
    expect(indexed('/best/')).toBeGreaterThan(130)
    expect(indexed('/best/')).toBeLessThan(260)
    expect(indexed('/compare/')).toBeGreaterThan(40)
    expect(indexed('/compare/')).toBeLessThan(100)
    expect(indexed('/year-end/')).toBeLessThan(25)
    expect(indexed('/cards/')).toBe(catalog.cards.length)
  })

  test('no static page links a page that is not to be indexed, except a category page its stores fall back to', () => {
    const noindex = new Map<string, string>()
    for (const file of htmlFiles(out)) {
      const rel = path.relative(out, file).split(path.sep).join('/')
      const url = `/${rel.replace(/index\.html$/, '').replace(/\.html$/, '')}`
      const html = readFileSync(file, 'utf8')
      if (html.includes('<meta name="robots" content="noindex, follow" />'))
        noindex.set(url, html)
    }
    // A category page that stays out of search (its ranking is everyday
    // spending's, or it's only a note) is still the page for its kind of
    // purchase, and holds the rows its stores' links go to.
    const index = readFileSync(path.join(out, 'best', 'index.html'), 'utf8')
    const categories = new Set(
      [
        ...index.matchAll(
          /<h2><a href="(\/best\/[^"]+)"|class="cat-all"[^>]*><a href="(\/best\/[^"]+)"/g,
        ),
      ].map((m) => m[1] ?? m[2] ?? ''),
    )
    expect(categories.size).toBeGreaterThan(30)
    const fallback = (url: string) => categories.has(url)
    const bad: string[] = []
    for (const { file, html } of pages) {
      if (file.endsWith('404.html')) continue
      const self = `/${path
        .relative(out, file)
        .split(path.sep)
        .join('/')
        .replace(/index\.html$/, '')
        .replace(/\.html$/, '')}`
      for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
        const to = m[1] ?? ''
        if (to !== self && noindex.has(to) && !fallback(to))
          bad.push(`${path.relative(out, file)} → ${to}`)
      }
    }
    expect([...new Set(bad)]).toEqual([])
  })

  test('Rate my wallet is in the sitemap, linked from every page, with its own title and one preview image', () => {
    const sitemap = readFileSync(path.join(out, 'sitemap.xml'), 'utf8')
    expect(sitemap).toContain('<loc>https://earnrate.dev/rate</loc>')
    const rate = readFileSync(path.join(ROOT, 'site/rate.html'), 'utf8')
    expect(unescape(/<title>([^<]*)<\/title>/.exec(rate)?.[1] ?? '')).toBe(
      'Rate my wallet: what your cards earn in a year · earnrate',
    )
    expect(rate).toContain('<!--earnrate:header-->')
    expect(rate).toContain('<!--earnrate:footer-->')
    expect(rate).toContain('content="https://earnrate.dev/og/rate.jpg"')
    const descriptions = [
      ...rate.matchAll(
        /<meta\s+(?:name="description"|property="og:description")\s+content="([^"]*)"/g,
      ),
    ].map((m) => m[1] ?? '')
    expect(descriptions).toHaveLength(2)
    for (const d of descriptions) {
      expect(d.length).toBeLessThanOrEqual(155)
      expect(d).not.toMatch(/flat-rate|best two/)
    }
    const card = readFileSync(path.join(out, 'cards', 'amex-gold.html'), 'utf8')
    expect(card).toContain('<a href="/rate">Rate my wallet</a>')
    for (const t of TABS) expect(card).toContain(`href="${t.href}"`)
  })

  test('the welcome-offer hub and each life-event page are built, indexed and linked: the hub from the footer, card pages and bonus rules, each event from the hub', () => {
    const sitemap = readFileSync(path.join(out, 'sitemap.xml'), 'utf8')
    const hub = readFileSync(path.join(out, 'welcome-offers.html'), 'utf8')
    const events = LIFE_EVENTS.map((e) => ({
      path: eventPath(e),
      html: readFileSync(
        path.join(out, `${eventPath(e).slice(1)}.html`),
        'utf8',
      ),
    }))
    for (const page of [{ path: '/welcome-offers', html: hub }, ...events]) {
      expect(page.html, page.path).not.toContain('noindex')
      expect(sitemap, page.path).toContain(
        `<loc>https://earnrate.dev${page.path}</loc>`,
      )
      expect(page.html.split(PICKER_SCRIPT).length - 1, page.path).toBe(1)
      expect(page.html, page.path).toMatch(
        /<section class="picker" data-picker hidden>/,
      )
      expect(page.html, page.path).toContain('BreadcrumbList')
    }
    for (const e of events) expect(hub, e.path).toContain(`href="${e.path}"`)
    expect(hub).toContain('"@type":"ItemList"')
    expect(hub).toContain('<h1>Best credit card welcome offers</h1>')
    expect(
      events.find((e) => e.path === '/welcome-offers/wedding')?.html,
    ).toContain('<h1>Best credit cards for wedding expenses</h1>')
    const bonus = readFileSync(path.join(out, 'bonus-rules.html'), 'utf8')
    expect(bonus).toContain('href="/welcome-offers"')
    const gold = readFileSync(path.join(out, 'cards', 'amex-gold.html'), 'utf8')
    expect(gold).toContain('href="/welcome-offers"')
    expect(siteFooter()).toContain('href="/welcome-offers"')
    // The one sentence on these pages not from card data, said once each.
    for (const e of events)
      expect(e.html.split(esc(CARD_SURCHARGE_NOTE)).length - 1, e.path).toBe(1)
  })

  test('the store, card and bonus-rule lists share one search box and script, hidden until the script runs', () => {
    for (const file of [
      'best/index.html',
      'cards/index.html',
      'bonus-rules.html',
    ]) {
      const html = readFileSync(path.join(out, file), 'utf8')
      expect(html.split(filterScript()).length - 1, file).toBe(1)
      expect(html, file).toMatch(
        /<div class="filter" hidden>\s*<label for="filter">/,
      )
      expect(
        html.match(/<input id="filter" type="search"/g),
        file,
      ).toHaveLength(1)
      expect(html.match(/ data-filtered>/g), file).toHaveLength(1)
      expect(html, file).toMatch(/<p id="no-match"[^>]* hidden>/)
    }
    expect(FILTER_SCRIPT).not.toMatch(
      /fetch|sendBeacon|XMLHttpRequest|Storage|cookie|history|location/,
    )
  })

  test('the card index and bonus rules find cards by name, short name and issuer', () => {
    const rows = (file: string, tag: string) =>
      new Map(
        [
          ...readFileSync(path.join(out, file), 'utf8').matchAll(
            new RegExp(
              `<${tag} (?:data-anchor="[^"]*" )?data-q="([^"]*)"[^>]*>[\\s\\S]*?href="/cards/([^"]+)"`,
              'g',
            ),
          ),
        ].map((m) => [m[2] ?? '', unescape(m[1] ?? '')]),
      )
    const index = rows('cards/index.html', 'li')
    const bonus = rows('bonus-rules.html', 'tr')
    expect([...index.keys()].sort()).toEqual(
      catalog.cards.map((c) => c.id).sort(),
    )
    expect(bonus.size).toBeGreaterThan(40)
    const found = (list: Map<string, string>, q: string) =>
      [...list]
        .filter(([, text]) => q.split(' ').every((w) => text.includes(w)))
        .map(([id]) => id)
    for (const list of [index, bonus]) {
      expect(found(list, 'amex plat')).toContain('amex-platinum')
      expect(found(list, 'sapphire')).toContain('chase-sapphire-preferred')
      expect(found(list, 'southwest').length).toBeGreaterThan(1)
      expect(
        found(list, 'chase').every(
          (id) => catalog.cards.find((c) => c.id === id)?.issuer === 'chase',
        ),
      ).toBe(true)
      expect(found(list, 'bofa').length).toBeGreaterThan(0)
    }
    for (const [id, text] of index) {
      const card = catalog.cards.find((c) => c.id === id)
      expect(text).toContain(card?.name.toLowerCase())
      if (card?.short_name)
        expect(text).toContain(card.short_name.toLowerCase())
    }
  })

  test('the store index links every store (or its row on its category page) and category page, each store inside its closed category', () => {
    const index = readFileSync(path.join(out, 'best', 'index.html'), 'utf8')
    const built = readdirSync(path.join(out, 'best'))
      .filter((f) => f.endsWith('.html') && f !== 'index.html')
      .map((f) => `/best/${f.replace(/\.html$/, '')}`)
    const linked = new Set(
      [...index.matchAll(/href="\/best\/([^"#]+)(?:#([^"]+))?"/g)].map(
        (m) => `/best/${m[2] ?? m[1] ?? ''}`,
      ),
    )
    // A brand answered by its parent store's page is listed with that link.
    const parent = new Map(
      [...catalog.merchants.seed, ...catalog.merchants.overrides].flatMap(
        (m) => (m.brand_of ? [[`/best/${m.id}`, `/best/${m.brand_of}`]] : []),
      ),
    )
    expect(
      built.filter((p) => !linked.has(p) && !linked.has(parent.get(p) ?? '')),
    ).toEqual([])
    expect(index).not.toMatch(/<details[^>]*\sopen/)
    const groups = [
      ...index.matchAll(/<details class="cat"[^>]*>(.*?)<\/details>/g),
    ]
    expect(groups.length).toBeGreaterThan(0)
    const costco = groups.find((g) => g[1]?.includes('href="/best/costco"'))
    expect(costco?.[1]).toContain('<h2>Warehouse clubs</h2>')
    expect(costco?.[1]).toContain('href="/best/warehouse-club"')
  })

  test("a category page gives a shared pick rule's terms for that category only", () => {
    const dining = readFileSync(
      path.join(out, 'categories', 'dining.html'),
      'utf8',
    )
    const gold = dining.slice(dining.indexOf('/cards/amex-business-gold'))
    const block = gold.slice(0, gold.indexOf('</div>'))
    expect(block).toContain('restaurants located in the U.S')
    expect(block).not.toMatch(
      /Any purchases from Google Fi|gas at grocery|When transit/,
    )
    // Personal cards come before business cards within an issuer.
    expect(dining.indexOf('/cards/amex-gold"')).toBeLessThan(
      dining.indexOf('/cards/amex-business-gold'),
    )
  })

  test("a card page's next step follows what the visitor has saved", () => {
    const html = readFileSync(path.join(out, 'cards', 'amex-gold.html'), 'utf8')
    const actions = /<div class="page-actions"[\s\S]*?<\/script>/.exec(
      html,
    )?.[0]
    expect(actions).toContain(
      'data-when="none"><a class="button" href="/#spending&amp;card=amex-gold"',
    )
    expect(actions).toContain(
      'data-when="other" hidden><a class="button" href="/#wallet&amp;whatif=amex-gold"',
    )
    expect(actions).toContain(
      'data-when="holds" hidden><a class="button" href="/#wallet&amp;card=amex-gold"',
    )
    // It reads the wallet saved in this browser and sends nothing.
    expect(actions).toContain("localStorage.getItem('earnrate:wallet')")
    expect(actions).not.toMatch(/fetch|sendBeacon|XMLHttpRequest/)
  })

  test("the year-end page is linked from the footer, and each card it lists has a page of its own, linked from the card when it's indexed and otherwise to the card's block on the hub", () => {
    const year = Number(today.slice(0, 4))
    const y = yearEnd(ctx, year)
    const listed = new Set(
      [
        ...y.credits,
        ...y.monthly,
        ...y.ending,
        ...y.milestones,
        ...y.caps,
        ...y.rotation,
      ].map((c) => c.card.id),
    )
    const built = readdirSync(path.join(out, 'year-end', String(year)))
      .map((f) => f.replace(/\.html$/, ''))
      .sort()
    expect(built).toEqual([...listed].sort())
    const hub = readFileSync(path.join(out, 'year-end', 'index.html'), 'utf8')
    const sitemap = readFileSync(path.join(out, 'sitemap.xml'), 'utf8')
    for (const id of listed) {
      const address = `/year-end/${String(year)}/${id}`
      const page = readFileSync(path.join(out, `${address}.html`), 'utf8')
      const indexed = !page.includes('noindex')
      const card = readFileSync(path.join(out, 'cards', `${id}.html`), 'utf8')
      expect(hub.includes(`href="${address}"`), id).toBe(indexed)
      expect(card.includes(`href="${address}"`), id).toBe(indexed)
      if (!indexed) {
        const anchor = new RegExp(`href="/year-end/#([a-z-]+-${id})"`).exec(
          card,
        )?.[1]
        expect(anchor, id).toBeDefined()
        expect(hub, id).toContain(`data-anchor="${anchor ?? ''}"`)
      }
      expect(page, id).toContain(
        `<link rel="canonical" href="https://earnrate.dev${address}" />`,
      )
      expect(page, id).toContain(
        `<meta property="og:image" content="https://earnrate.dev/og${address}.jpg" />`,
      )
      expect(
        sitemap.includes(`<loc>https://earnrate.dev${address}</loc>`),
        id,
      ).toBe(!page.includes('noindex'))
    }
    const credits = readFileSync(
      path.join(out, 'cards', 'amex-platinum.html'),
      'utf8',
    )
    const section = credits.slice(credits.indexOf('<h2>Statement credits</h2>'))
    expect(section.slice(0, section.indexOf('<h2>', 4))).toContain(
      `href="/year-end/${String(year)}/amex-platinum"`,
    )
    expect(
      readFileSync(path.join(out, 'cards', 'citi-double-cash.html'), 'utf8'),
    ).toContain('<li><a href="/year-end/">')
  })

  test("a fee card's annual-fee section ends with cheaper cards, this card first", () => {
    const head = '<th>Card</th><th>Annual fee</th><th>Nets a year</th>'
    const section = (id: string) => {
      const html = readFileSync(path.join(out, 'cards', `${id}.html`), 'utf8')
      const start = html.indexOf('<h2 id="annual-fee">')
      return start === -1
        ? ''
        : html.slice(start, html.indexOf('<h2', start + 4))
    }
    let shown = 0
    for (const card of catalog.cards) {
      const fee = section(card.id)
      if (!fee.includes(head)) continue
      shown++
      const table = fee.slice(fee.indexOf(head))
      expect(table, card.id).toMatch(
        new RegExp(`^${head}</tr></thead><tbody><tr><td><strong>`),
      )
    }
    expect(shown).toBeGreaterThan(0)
    expect(section('amex-gold')).toContain(head)
    expect(section('amex-platinum')).toContain(head)
    expect(section('citi-double-cash')).toBe('')
  })

  test("a card page dates its offer from the offer's last reading", () => {
    let rechecked = 0
    for (const card of catalog.cards) {
      const html = readFileSync(
        path.join(out, 'cards', `${card.id}.html`),
        'utf8',
      )
      const dated = /per the issuer's page as of ([^.<]+)\./.exec(html)?.[1]
      if (dated === undefined) continue
      expect(dated, card.id).toBe(shortDate(offerCheckedOn(card)))
      if (card.offer_checked !== undefined) rechecked++
    }
    expect(rechecked).toBeGreaterThan(0)
  })

  test("a card page's offer history is the engine's, with its caveat, and never calls an offer a deal", () => {
    for (const card of catalog.cards) {
      const html = unescape(
        readFileSync(path.join(out, 'cards', `${card.id}.html`), 'utf8'),
      )
      expect(html, card.id).not.toMatch(/\b(good|great|best) (deal|offer)\b/i)
      const history = offerHistoryText(catalog, card, today)
      if (history === null) {
        expect(html, card.id).not.toContain('Offer history')
        continue
      }
      expect(html, card.id).toContain(history.lead)
      expect(html, card.id).toContain(OFFER_HISTORY_CAVEAT)
      for (const e of history.earlier)
        expect(html, card.id).toContain(`${dateRange(e.from, e.to)}</time>: `)
    }
  })

  test('only store pages with something of their own are indexed', () => {
    const page = (slug: string) =>
      readFileSync(path.join(out, 'best', `${slug}.html`), 'utf8')
    const noindex = (slug: string) => page(slug).includes('content="noindex')
    // Cards it refuses, a credit there, an answer of its own.
    for (const slug of ['costco', 'lululemon', 'amazon', 'groceries'])
      expect(noindex(slug), slug).toBe(false)
    // Ranked exactly like supermarkets, with nothing about Stater Bros. itself.
    expect(noindex('stater-bros')).toBe(true)
    expect(page('groceries')).toMatch(
      /<span class="store-row" id="stater-bros">Stater Bros\.[^<]*<\/span>/,
    )
    // American Express names Aldi among its example supermarkets, but its
    // answer is still the supermarkets'.
    expect(noindex('aldi')).toBe(true)
    expect(page('groceries')).toContain('id="aldi"')
  })

  test('a category page names a business card that earns more than every personal card, once, and is indexed for it', () => {
    const page = (slug: string) =>
      readFileSync(path.join(out, 'best', `${slug}.html`), 'utf8')
    const office = page('office-supply-stores')
    expect(office).not.toContain('content="noindex')
    const lines = office.match(/<p class="small">For a business: /g) ?? []
    expect(lines).toHaveLength(1)
    expect(office).toMatch(
      /For a business: <a href="\/cards\/chase-ink-business-cash">Ink Business Cash<\/a>, 5%/,
    )
    // The personal ranking above it is unchanged: no business card in it.
    const list = office.slice(0, office.indexOf('For a business'))
    expect(list).not.toContain('chase-ink-business-cash')
    // Where personal cards earn as much, there is no line.
    expect(page('dining')).not.toContain('For a business')
  })

  test('a brand ranked like its parent store links to the parent, which names it', () => {
    const hilton = readFileSync(path.join(out, 'best', 'hilton.html'), 'utf8')
    expect(hilton).toMatch(
      /The top cards are the same at its brands: [^<]*Hampton Inn/,
    )
    const card = readFileSync(path.join(out, 'best', 'index.html'), 'utf8')
    expect(card).toMatch(/<a href="\/best\/hilton">Hampton Inn<\/a>/)
  })

  test("links to a store page that is not indexed go to its row on its category page, or a brand's parent store", () => {
    const best = path.join(out, 'best')
    const stores = new Set(
      [...catalog.merchants.seed, ...catalog.merchants.overrides].map(
        (m) => m.id,
      ),
    )
    const noindex = new Set(
      readdirSync(best)
        .filter((f) => f.endsWith('.html') && f !== 'index.html')
        .filter((f) =>
          readFileSync(path.join(best, f), 'utf8').includes(
            '<meta name="robots" content="noindex, follow" />',
          ),
        )
        .map((f) => f.replace(/\.html$/, ''))
        .filter((slug) => stores.has(slug)),
    )
    expect(noindex.size).toBeGreaterThan(0)
    // A brand whose parent store's page names it.
    const named = (slug: string) => {
      const parent = [
        ...catalog.merchants.seed,
        ...catalog.merchants.overrides,
      ].find((m) => m.id === slug)?.brand_of
      if (!parent || noindex.has(parent)) return false
      const label = [...catalog.merchants.seed, ...catalog.merchants.overrides]
        .filter((m) => m.id === slug)
        .at(-1)?.name
      const html = readFileSync(path.join(best, `${parent}.html`), 'utf8')
      return label !== undefined && html.includes(esc(label))
    }
    const ids = new Map<string, string[]>()
    const idsOn = (slug: string) => {
      let list = ids.get(slug)
      if (list === undefined) {
        const file = path.join(best, `${slug}.html`)
        list = existsSync(file)
          ? [...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map(
              (m) => m[1] ?? '',
            )
          : []
        ids.set(slug, list)
      }
      return list
    }
    const bad: string[] = []
    const rows = new Set<string>()
    for (const { file, html } of pages)
      for (const m of html.matchAll(
        /href="(?:https:\/\/earnrate\.dev)?\/best\/([^"#?/]+)(?:#([^"]*))?"/g,
      )) {
        const [href, slug = '', anchor] = m
        const own = file === path.join(best, `${slug}.html`)
        if (noindex.has(slug) && !own) bad.push(`${file} → ${href}`)
        if (anchor === undefined || !noindex.has(anchor)) continue
        const found = idsOn(slug).filter((id) => id === anchor).length
        if (found !== 1)
          bad.push(`${file} → ${href}: ${String(found)} rows with that id`)
        rows.add(anchor)
      }
    // Every such store is linked from somewhere, by its row or its parent's
    // page.
    for (const slug of noindex)
      if (!rows.has(slug) && !named(slug))
        bad.push(`/best/${slug} has no link to its row`)
    expect(bad).toEqual([])
    const sitemap = readFileSync(path.join(out, 'sitemap.xml'), 'utf8')
    for (const slug of noindex) expect(sitemap).not.toContain(`/best/${slug}<`)
  })

  test("a store page says what an issuer's list of example stores says about it, with the quote", () => {
    const page = (slug: string) =>
      readFileSync(path.join(out, 'best', `${slug}.html`), 'utf8')
    const vons = page('vons')
    expect(vons).toContain(
      'American Express names Vons among its examples of stores that count as a supermarket for the bonus on these cards: ',
    )
    expect(vons).toMatch(/<a href="\/cards\/amex-gold">[^<]+<\/a> \(4x [^)]+\)/)
    expect(vons).toContain(
      "American Express's examples include Smart &amp; Final, Stop &amp; Shop, Trader Joe's, Vons, Whole Foods and Winn-Dixie.",
    )
    expect(vons).toContain(
      'href="https://www.americanexpress.com/us/content/rewards-info/retail.html"',
    )
    const sevenEleven = page('seven-eleven')
    expect(sevenEleven).toContain(
      "American Express names 7-Eleven among its examples of stores that don't count as a supermarket for the bonus on these cards: ",
    )
    expect(sevenEleven).toContain('Convenience stores (e.g., 7Eleven)')
    // The issuer settles how Meijer codes for its own cards.
    const meijer = page('meijer')
    expect(meijer).toContain('American Express names Meijer among its examples')
    expect(meijer).not.toMatch(/amex-gold">[^<]+<\/a>: its [^<]* leaves it out/)
  })

  test('a store named in a long list quotes only its own piece, and a pick says which one covers it', () => {
    const page = (slug: string) =>
      readFileSync(path.join(out, 'best', `${slug}.html`), 'utf8')
    const sprouts = page('sprouts')
    expect(sprouts).toContain(
      "pays its bonus on grocery stores, when that's your pick.",
    )
    expect(sprouts).toContain('Kroger, Sprouts Farmers Market and Fred Meyer.')
    expect(sprouts).not.toContain("Applebee's, Grubhub")
    // The gas list's "Kroger Fuel Center" is about the gas pick.
    const kroger = page('kroger')
    expect(kroger).not.toContain('Phillips 66')
    expect(kroger).not.toContain('Fuel Center')
    // "XFINITY MOBILE" names Xfinity Mobile, not Comcast Xfinity.
    expect(page('comcast')).not.toContain('XFINITY MOBILE')
    const netflix = page('netflix')
    expect(netflix).toContain("when that's one of your picks.")
    expect(netflix).not.toContain('Sonic Chick-fil-A')
    expect(page('target')).toContain(
      'Examples of merchants where you will NOT earn additional rewards include:',
    )
  })

  test("a store page's How it codes reads as its ranking does", () => {
    const page = (slug: string) =>
      unescape(
        readFileSync(path.join(out, 'best', `${slug}.html`), 'utf8').replace(
          /<[^>]+>/g,
          '',
        ),
      )
    const walmart = page('walmart')
    expect(walmart).not.toContain('Counted as a superstore')
    expect(page('best-buy')).not.toContain('Amex Blue Cash Everyday (3%')
    expect(page('netflix')).toContain(
      'Bank of America Customized Cash Rewards (3% cash back, up to 5.25% with BofA Rewards Premier)',
    )
    expect(page('costco')).not.toMatch(/\(3\.5% cash back with/)
    const wholeFoods = page('whole-foods')
    expect(wholeFoods).toContain(
      'Prime Visa: 5% cash back at Whole Foods Market with Amazon Prime, 3% without. “including any physical Whole Foods Market locations',
    )
    expect(wholeFoods).not.toContain('Prime Visa: 3% cash back')
    expect(page('comcast')).toContain(
      'Discover it Cash Back: “purchases made over the phone or online for internet, cable',
    )
    expect(page('starbucks')).toContain(
      "U.S. Bank Cash+: its 2% cash back on restaurants leaves it out: “Excludes most fast food restaurants like McDonald's”",
    )
    expect(walmart).toContain(
      "Verizon says Verizon Visa's 4% bonus is for Verizon store purchases, and names Walmart among the stores that earn 1% instead.",
    )
    expect(page('expedia')).toContain(
      'SoFi says the 3x bonus on SoFi Unlimited 2% is for SoFi Travel purchases, not purchases at Expedia, which earn 2x.',
    )
    expect(page('best-buy')).toContain(
      'My Best Buy Visa: 2.5x My Best Buy rewards (5% back) at Best Buy',
    )
  })

  test("a card page names each pick as the issuer's categories, not its id", () => {
    const html = unescape(
      readFileSync(path.join(out, 'cards', 'usbank-cash-plus.html'), 'utf8'),
    )
    expect(html).toContain(
      'Pick 1 of: gas stations and EV charging; grocery stores; restaurants (each quarter).',
    )
    expect(html).toContain('TV, internet & streaming (each quarter)')
    expect(html).not.toContain('gas ev charging')
  })

  test('an online store page says its rates are for buying online; a store with shops of its own says nothing of it', () => {
    const answer = (slug: string) =>
      /<p class="answer">[\s\S]*?<\/p>/.exec(
        readFileSync(path.join(out, 'best', `${slug}.html`), 'utf8'),
      )?.[0] ?? ''
    expect(answer('amazon')).toContain(
      'These rates are for buying online, since Amazon sells online.',
    )
    expect(answer('chewy')).toContain(
      'These rates are for buying online, since Chewy sells online.',
    )
    const chewyRanking = /<ol class="cards">[\s\S]*?<\/ol>/.exec(
      readFileSync(path.join(out, 'best', 'chewy.html'), 'utf8'),
    )?.[0]
    expect(chewyRanking).toContain('amex-blue-cash-everyday')
    expect(answer('petco')).not.toBe('')
    expect(answer('petco')).not.toContain('buying online')
  })

  test("a card page gives the rotating categories' own rate, not one that stacks on an everyday rate", () => {
    const flex = readFileSync(
      path.join(out, 'cards', 'chase-freedom-flex.html'),
      'utf8',
    )
    expect(flex).toContain(
      '5% cash back on categories that rotate each quarter',
    )
    expect(flex).not.toMatch(/7% cash back on categories that rotate/)
  })

  test("a store page names the store's own cards earnrate holds, and claims nothing where it holds none", () => {
    const page = (slug: string) =>
      readFileSync(path.join(out, 'best', `${slug}.html`), 'utf8')
    const kohls = page('kohls')
    expect(kohls).toContain("Kohl's own cards, ")
    expect(kohls).toContain('href="/cards/capital-one-kohls-card"')
    expect(page('target')).toContain("is Target's own card.")
    const nordstrom = page('nordstrom')
    expect(nordstrom).toContain("Nordstrom's own cards are")
    expect(nordstrom).not.toContain('among the top')
    const vons = page('vons')
    const said = [
      /<p class="answer">[\s\S]*?<\/p>/.exec(vons)?.[0],
      /<meta name="description" content="[^"]*"/.exec(vons)?.[0],
    ].join(' ')
    expect(said).not.toMatch(/own card|store card|no card/i)
    expect(/<title>([^<]*)<\/title>/.exec(vons)?.[1]).toMatch(
      /^Best credit card for Vons: .+, \d/,
    )
  })

  test('a time-limited winning rate is titled only with its quarter, and the description gives its end', () => {
    const html = readFileSync(path.join(out, 'best', 'dining.html'), 'utf8')
    const title = unescape(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '')
    const description = unescape(
      /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '',
    )
    const r = exploreCards(
      catalog,
      {
        merchant: null,
        category: 'dining',
        amount: null,
        channel: null,
        date: today,
      },
      { filters: ALL_PERSONAL_CARDS, memberships: [], valuations: {} },
    )
    const [top] = r.ranked
    const end = catalog.cards
      .find((c) => c.id === top?.cardId)
      ?.rules.find((rule) => rule.id === top?.matchedRule)?.valid_to
    if (end === undefined) return
    if (title.includes('%')) expect(title).toContain(`in ${quarterYear(today)}`)
    expect(description).toContain(`through ${longDate(end)}`)
  })

  test('a comparison description gives a dollar figure only with the spending it assumes', () => {
    const missing = htmlFiles(path.join(out, 'compare'))
      .map((file) =>
        unescape(
          /<meta name="description" content="([^"]*)"/.exec(
            readFileSync(file, 'utf8'),
          )?.[1] ?? '',
        ),
      )
      .filter((d) => d.includes('$') && !d.includes('at typical U.S. spending'))
    expect(missing).toEqual([])
  })

  test("a card page's rate rows say when activation opens and closes", () => {
    const flex = catalog.cards.find((c) => c.id === 'chase-freedom-flex')
    const html = readFileSync(
      path.join(out, 'cards', 'chase-freedom-flex.html'),
      'utf8',
    )
    for (const rule of flex?.rules ?? []) {
      if (rule.requires?.activation !== true) continue
      if (rule.activate_from !== undefined && rule.activate_from > today)
        expect(html, rule.id).toContain(
          `Activate it with Chase starting ${shortDate(rule.activate_from)}`,
        )
      if (rule.activate_by !== undefined && rule.activate_by >= today)
        expect(html, rule.id).toContain(`by ${shortDate(rule.activate_by)}`)
    }
  })

  test('a card page lists its fees and rewards near the top', () => {
    const html = readFileSync(
      path.join(out, 'cards', 'paypal-cashback-mastercard.html'),
      'utf8',
    )
    const facts = /<dl class="facts">[\s\S]*?<\/dl>/.exec(html)?.[0] ?? ''
    expect(html.indexOf('<dl class="facts">')).toBeLessThan(
      html.indexOf('<h2>'),
    )
    for (const label of ['Annual fee', 'Foreign transaction fee', 'Rewards'])
      expect(facts).toContain(`<dt>${label}</dt>`)
  })

  test("a card page lists the credits earnrate can't match to a purchase with the rest, says so, and counts them in the year's total", () => {
    const section = (id: string) => {
      const html = readFileSync(path.join(out, 'cards', `${id}.html`), 'utf8')
      const start = html.indexOf('<h2>Statement credits</h2>')
      return unescape(html.slice(start, html.indexOf('</ul>', start)))
    }
    const platinum = section('amex-platinum')
    expect(platinum).toContain(
      "earnrate can't tell which purchases the airline fee and hotel credits pay on, so it never counts them toward one; say in your wallet which you use.",
    )
    expect(platinum).toContain(
      '$200 back each calendar year on incidental fees charged by the one airline you select',
    )
    expect(platinum).toContain(
      '$300 back each half year on prepaid Fine Hotels + Resorts, The Hotel Collection and Airbnb Luxe bookings through Amex Travel',
    )
    const card = catalog.cards.find((c) => c.id === 'amex-platinum')
    const year = card ? allCreditsYear(catalog, card, today, {}).yearly : 0
    expect(platinum).toContain(
      `${wholeDollars(year)} a year if you'd use them all`,
    )
    const globe = section('citi-aadvantage-globe')
    expect(globe).toMatch(
      /^<h2>Statement credits<\/h2><p>Dollars back on these purchases: \$200 a year if you'd use them all\. earnrate can't tell which purchases they pay on, so it never counts them toward one\./,
    )
    expect(globe).not.toContain('counts one toward a purchase')
  })

  test("rent's page links the cards its note names", () => {
    const html = readFileSync(path.join(out, 'best', 'rent.html'), 'utf8')
    for (const id of ['bilt-blue', 'bilt-obsidian', 'bilt-palladium'])
      expect(html).toContain(`href="/cards/${id}"`)
  })

  test('grocery stores and supermarkets share one page, and the other address redirects', () => {
    const best = readdirSync(path.join(out, 'best'))
    expect(best.filter((f) => /^grocer(y|ies)\.html$/.test(f))).toEqual([
      'groceries.html',
    ])
    const redirects = readFileSync(path.join(out, '_redirects'), 'utf8')
    expect(redirects).toContain('/best/grocery /best/groceries 301\n')
    const sitemap = readFileSync(path.join(out, 'sitemap.xml'), 'utf8')
    expect(sitemap).not.toContain('/best/grocery<')
  })

  test('every redirect leaves a missing address for a built page', () => {
    const file = (p: string) => path.join(out, `${p}.html`)
    const lines = readFileSync(path.join(out, '_redirects'), 'utf8')
      .trim()
      .split('\n')
    for (const line of lines) {
      const [from = '', to = '', status] = line.split(' ')
      expect(status, line).toBe('301')
      expect(existsSync(file(from)), line).toBe(false)
      expect(existsSync(file(to)), line).toBe(true)
    }
  })

  test('pages carry breadcrumbs and no review, rating or FAQ markup', () => {
    for (const { file, html } of pages) {
      expect(html, file).not.toMatch(/FAQPage|"Review"|AggregateRating/)
      if (file.startsWith(out) && !file.endsWith('404.html')) {
        expect(html, file).toContain('"@type":"BreadcrumbList"')
        expect(html, file).toContain('aria-label="Breadcrumb"')
      }
    }
  })

  test("Safari's Notify Me line is hidden on the pages worth watching: the quarter hub while a card's next quarter is missing, a card's offer and /changes", () => {
    const read = (...p: string[]) => readFileSync(path.join(out, ...p), 'utf8')
    const tip = (html: string) =>
      /<p class="muted" data-notify-tip hidden>([^<]*)<\/p><script>/.exec(
        html,
      )?.[1]
    const all = quarters(catalog, today)
    const now = all.find((q) => q.start <= today && today <= q.end)
    const nextKey = periodKey('quarter', addDays(now?.end ?? today, 1), null)
    const next = all.find((q) => q.key === nextKey)
    const waiting =
      next === undefined ||
      next.cards.some((c) => c.kind === 'rotating' && c.rules.length === 0)
    const hub = read('quarterly', 'index.html')
    expect(hub).toContain(
      `Next quarter: Q${nextKey?.slice(-1) ?? ''} ${nextKey?.slice(0, 4) ?? ''}`,
    )
    expect(tip(hub)).toBe(
      waiting
        ? "On a Mac or iPhone, Safari's Notify Me (in the page menu) can tell you when next quarter's categories are posted."
        : undefined,
    )
    for (const qc of next?.cards ?? [])
      if (qc.kind === 'rotating' && qc.rules.length === 0)
        expect(hub).toContain(
          `">${esc(ctx.shortName(qc.card.id))}</a>: not posted yet.`,
        )
    expect(tip(read('cards', 'amex-gold.html'))).toBe(
      "Safari's Notify Me (in the page menu) can tell you when this offer changes.",
    )
    const offerless = catalog.cards.find(
      (c) => !c.welcome_offer || !inEffect(c.welcome_offer, today),
    )
    if (offerless)
      expect(tip(read('cards', `${offerless.id}.html`))).toBeUndefined()
    expect(tip(read('changes.html'))).toBe(
      "Safari's Notify Me (in the page menu) can tell you when something new is added here.",
    )
  })

  test("every built page's header opens the app's tabs by their names, and the home page has only the tabs", () => {
    const nav = TABS.map((t) => `<a href="${t.href}">${t.name}</a>`).join('')
    for (const { file, html } of pages) {
      if (file.startsWith(out)) expect(html, file).toContain(nav)
      if (file === path.join(ROOT, 'site', 'index.html'))
        expect(html, file).not.toContain('class="app-nav"')
    }
  })
})

test("a card page's offer history names the higher offer it fell from, and lists earlier ones", () => {
  const card = CardSchema.parse({
    id: 'hotel',
    name: 'Hotel Card',
    issuer: 'chase',
    network: 'visa',
    currency: 'hotel-points',
    last_verified: '2026-11-17',
    verified_by: 'test',
    source_urls: ['https://example.com/card'],
    base_rate: 1,
    foreign_transaction_fee: 0,
    annual_fee: 0,
    welcome_offer: { points: 140000, spend: 3000, months: 3 },
  })
  const offer = (points: number, spend: number) => ({
    points,
    spend,
    months: 3,
  })
  const releases = ChangesFileSchema.parse([
    {
      version: '2026.11.17',
      date: '2026-11-17',
      changes: [
        {
          cause: 'issuer',
          card: 'hotel',
          field: 'welcome_offer',
          was: offer(180000, 3000),
          now: offer(140000, 3000),
          source: 'https://example.com/card',
          detected: '2026-11-16',
        },
      ],
    },
    {
      version: '2026.11.01',
      date: '2026-11-01',
      changes: [
        {
          cause: 'issuer',
          card: 'hotel',
          field: 'welcome_offer',
          was: offer(100000, 2000),
          now: offer(180000, 3000),
          source: 'https://example.com/card',
        },
      ],
    },
    {
      version: '2026.10.27',
      date: '2026-10-27',
      changes: [
        {
          cause: 'addition',
          card: 'hotel',
          field: 'welcome_offer',
          summary: 'Public welcome offers.',
        },
      ],
    },
  ])
  const fixture = {
    ...catalog,
    cards: [card],
    currencies: [
      { id: 'hotel-points', name: 'Hotel points', value_cents: 0.5 },
    ],
    offerRecords: offerRecords(releases),
  } as Catalog
  const html = unescape(
    offerHistorySection(
      { catalog: fixture, today: '2026-11-17' } as PageContext,
      card,
    ),
  )
  expect(html).toContain(
    "<h3>Offer history</h3><p>It's been the public offer since Nov 16, 2026. Lower than the 180,000 Hotel points after $3,000 in purchases within 3 months seen Nov 1 – Nov 15, 2026.</p>",
  )
  expect(html).toContain(
    '<li><time datetime="2026-11-01">Nov 1 – Nov 15, 2026</time>: 180,000 Hotel points after $3,000 in purchases within 3 months</li><li><time datetime="2026-10-27">Oct 27 – Oct 31, 2026</time>: 100,000 Hotel points after $2,000 in purchases within 3 months</li>',
  )
  expect(html).toContain(OFFER_HISTORY_CAVEAT)
})

describe('quarterly pages', () => {
  const pages = quarterlyPages(
    ctx,
    { category: () => null, merchant: () => null },
    () => today,
  )

  test('state each rotating rule as the card file has it', () => {
    for (const q of quarters(catalog, today)) {
      const page = pages.find((p) => p.path === `/quarterly/${q.slug}`)
      expect(page, q.key).toBeDefined()
      const html = page?.html ?? ''
      for (const qc of q.cards) {
        expect(html).toContain(`/cards/${qc.card.id}`)
        if (qc.kind === 'rotating' && qc.rules.length === 0) {
          expect(html).toContain(
            esc(rotationGapText(ctx.shortName(qc.card.id), q.key)),
          )
          continue
        }
        if (qc.kind === 'rotating')
          expect(html).toContain(
            `Up to $${qc.cap.amount.toLocaleString('en-US')} of combined purchases`,
          )
        for (const rule of qc.rules) {
          expect(html).toContain(
            esc(earnText(catalog, rule.rate, qc.card.currency)),
          )
          if (rule.activate_by)
            expect(html).toContain(`by ${shortDate(rule.activate_by)}`)
          if (rule.note) expect(html).toContain(esc(rule.note))
          for (const e of qc.card.evidence.filter((e) => e.rule === rule.id))
            expect(html).toContain(esc(quoteText(e.quote)))
        }
      }
    }
  })

  test('the hub is the current quarter', () => {
    const hub = pages.find((p) => p.path === '/quarterly/')
    const current = quarters(catalog, today).find(
      (q) => q.start <= today && today <= q.end,
    )
    expect(hub?.html).toContain(`/quarterly/${current?.slug ?? ''}`)
    expect(hub?.html).toContain(current?.label ?? '?')
  })
})

describe('year-end pages', () => {
  const year = Number(today.slice(0, 4))
  const y = yearEnd(ctx, year)
  const pages = yearEndPages(ctx, () => today)
  const hub = pages.find((p) => p.path === '/year-end/')?.html ?? ''
  const block = (section: string, cardId: string) => {
    const start = hub.indexOf(`data-anchor="${section}-${cardId}"`)
    return start === -1
      ? ''
      : hub.slice(start, hub.indexOf('</section>', start))
  }

  test('the hub and the permanent address are this year', () => {
    expect(pages.map((p) => p.path)).toContain(`/year-end/${String(year)}`)
    expect(hub).toContain(`December 31, ${String(year)}`)
    expect(hub).toContain(`href="/year-end/${String(year)}"`)
  })

  test("list every credit whose period ends December 31, the monthly ones apart and collapsed, with the issuer's quote and note", () => {
    for (const card of catalog.cards)
      for (const credit of card.credits) {
        const monthly = credit.period === 'month'
        const section = monthly ? y.monthly : y.credits
        const listed = section.some(
          (c) =>
            c.card.id === card.id &&
            c.items.some((i) => i.credit.id === credit.id),
        )
        const ends =
          inEffect(credit, y.end) &&
          currentPeriodEnd(credit.period, y.end, null) === y.end
        expect(listed, `${card.id}/${credit.id}`).toBe(ends)
        if (!ends) continue
        const html = block(monthly ? 'monthly' : 'credits', card.id)
        expect(html, card.id).toContain(
          esc(
            `${money(periodAmount(credit, periodKey(credit.period, y.end, null)))} back ${creditWhere(catalog, credit)}`,
          ),
        )
        if (credit.note) expect(html, credit.id).toContain(esc(credit.note))
        const quotes = card.evidence.filter((e) => e.rule === credit.id)
        const december = credit.month_amounts?.['12'] !== undefined
        const quote =
          (december
            ? quotes.find((e) => e.quote.includes('December'))
            : undefined) ?? quotes[0]
        if (quote) expect(html, credit.id).toContain(esc(quote.quote))
      }
    expect(
      [...y.credits, ...y.monthly].flatMap((c) =>
        c.items.filter((i) => i.credit.period === 'cardmember_year'),
      ),
    ).toEqual([])
    const details = hub.indexOf('<details class="ye-monthly">')
    expect(details).toBeGreaterThan(hub.indexOf('id="spend"'))
    expect(hub.indexOf('data-anchor="monthly-')).toBeGreaterThan(details)
    // Inside the monthly list, only each credit's own row opens.
    expect(hub.slice(details + 1, hub.indexOf('<h2', details))).not.toMatch(
      /<details(?! class="ye-row")/,
    )
  })

  test('state each calendar-year spend bonus as what has to happen by December 31', () => {
    for (const card of catalog.cards)
      for (const m of card.milestones.filter(
        (m) => m.period === 'calendar_year' && inEffect(m, y.end),
      ))
        expect(block('spend', card.id), m.id).toContain(
          `${wholeDollars(m.spend)} on the card in ${String(year)}`,
        )
  })

  test("give next quarter's rotating categories only where the data has them", () => {
    const next = quarters(catalog, today).find(
      (q) => q.key === `${String(year + 1)}-Q1`,
    )
    for (const r of y.rotation) {
      const html = block('rotating', r.card.id)
      const posted = next?.cards.find(
        (qc) => qc.card.id === r.card.id && qc.kind === 'rotating',
      )
      if (posted?.kind !== 'rotating') continue
      if (posted.rules.length === 0)
        expect(html).not.toContain(next?.label ?? '?')
      for (const rule of posted.rules)
        if (rule.note) expect(html).toContain(esc(rule.note))
    }
  })

  test('saved cards come first in the browser, and nothing is sent', () => {
    const scripts = [...hub.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1] ?? '',
    )
    const wallet = scripts.findIndex((t) =>
      t.includes("localStorage.getItem('earnrate:wallet')"),
    )
    expect(wallet).toBeGreaterThan(-1)
    expect(scripts[wallet]).not.toMatch(/fetch|sendBeacon|XMLHttpRequest/)
    // It goes to a linked block once the page is laid out: after the send
    // script has shown its rows.
    const send = scripts.findIndex((t) => t.includes('[data-send]'))
    expect(send).toBeGreaterThan(-1)
    expect(send).toBeLessThan(wallet)
    expect(hub).toContain('data-ye-list')
    // With saved cards it shows only those until the visitor picks all.
    expect(hub).toContain('data-ye-mode="yours"')
    expect(hub).toContain('data-ye-mode="all"')
    expect(scripts[wallet]).toContain('document.body.dataset.yeOnly')
  })

  describe("each card's own page", () => {
    const cardPages = pages.filter((p) =>
      p.path.startsWith(`/year-end/${String(year)}/`),
    )
    const pageOf = (id: string) =>
      cardPages.find((p) => p.path === `/year-end/${String(year)}/${id}`)
    const title = (html: string) =>
      unescape(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '')
    const description = (html: string) =>
      unescape(
        /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '',
      )

    test('leads its title with the card and the count of credits it lists, and fits', () => {
      expect(cardPages.length).toBeGreaterThan(0)
      for (const page of cardPages) {
        const t = title(page.html)
        const d = description(page.html)
        expect(t.length, t).toBeLessThanOrEqual(TITLE_MAX)
        expect(d.length, d).toBeLessThanOrEqual(DESCRIPTION_MAX)
        const n = /: (\d+) (?:monthly )?credits? (?:that )?ends? /.exec(t)?.[1]
        if (n === undefined) continue
        const listed = page.html.match(/<strong>\$[\d,.]+ back /g) ?? []
        expect(listed.length, t).toBe(Number(n))
        expect(d, t).toMatch(new RegExp(`^(${n}|One) credits? on the `))
      }
      expect(title(pageOf('amex-platinum')?.html ?? '')).toMatch(
        /^Amex Platinum: \d+ credits that end Dec 31, \d{4}/,
      )
    })

    test("shows only that card's items, as the year's page words them", () => {
      for (const { card, items } of [...y.credits, ...y.monthly]) {
        const html = pageOf(card.id)?.html ?? ''
        for (const { credit } of items)
          expect(html, credit.id).toContain(
            esc(
              `${money(periodAmount(credit, periodKey(credit.period, y.end, null)))} back ${creditWhere(catalog, credit)}`,
            ),
          )
      }
      const platinum = pageOf('amex-platinum')?.html ?? ''
      expect(platinum).not.toContain('data-card="amex-gold"')
      expect(platinum).not.toMatch(/data-anchor="[a-z]+-amex-gold"/)
      expect(platinum).toContain('href="/cards/amex-platinum"')
      expect(platinum).toContain('href="/year-end/#')
      expect(platinum).toContain('href="/#wallet&amp;add=amex-platinum"')
      expect(platinum).toContain(
        `"item":"https://earnrate.dev/year-end/${String(year)}"`,
      )
    })

    test("counts a monthly credit at December's own amount, and says when next quarter's activation opens", () => {
      const platinum = pageOf('amex-platinum')?.html ?? ''
      const card = catalog.cards.find((c) => c.id === 'amex-platinum')
      const credits = [...y.credits, ...y.monthly]
        .filter((c) => c.card.id === 'amex-platinum')
        .flatMap((c) => c.items)
      const total = credits.reduce(
        (sum, i) => sum + periodAmount(i.credit, i.key),
        0,
      )
      expect(card?.credits.find((c) => c.id === 'uber-cash')).toMatchObject({
        month_amounts: { '12': 35 },
      })
      if (year === 2026) expect(platinum).toContain('$35 back at Uber')
      expect(platinum).toContain(`worth up to ${wholeDollars(total)} together`)
      const flex = pageOf('chase-freedom-flex')?.html ?? ''
      const opens = catalog.cards
        .find((c) => c.id === 'chase-freedom-flex')
        ?.rules.find((r) => r.activate_from !== undefined)?.activate_from
      if (opens !== undefined && opens > today && flex !== '')
        expect(flex).toContain(
          `Activate with Chase starting ${shortDate(opens)}`,
        )
    })

    test("says what kinds of credit the lists leave out before they start, and links each card's issuer page", () => {
      const scope = /<p class="ye-scope">([^<]*)/
      const sentence = scope.exec(hub)?.[1] ?? ''
      const said = unescape(sentence)
      const lead =
        "This page lists credits paid each month, quarter, half year or year, including ones earnrate can't tie to a purchase. It leaves out a few others, among them credits that pay only after other purchases and ones limited per booking or stay"
      expect(said.startsWith(lead)).toBe(true)
      const bofa = catalog.cards.find(
        (c) => c.id === 'bank-of-america-premium-rewards',
      )
      const unread = /Bank of America Premium Rewards/
      expect(unread.test(said)).toBe(bofa?.credits.length === 0)
      for (const page of cardPages) {
        const own = unescape(scope.exec(page.html)?.[1] ?? '')
        const id = page.path.split('/').at(-1) ?? ''
        expect(own.startsWith(lead), id).toBe(true)
        expect(unread.test(own), id).toBe(
          id === bofa?.id && bofa.credits.length === 0,
        )
        expect(own.split('. ').length, id).toBeLessThanOrEqual(3)
      }
      const platinum = unescape(pageOf('amex-platinum')?.html ?? '')
      for (const id of ['airline-fee', 'hotel']) {
        const credit = catalog.cards
          .find((c) => c.id === 'amex-platinum')
          ?.credits.find((c) => c.id === id)
        expect(credit?.listed, id).toBeDefined()
        if (credit)
          expect(platinum, id).toContain(`back ${creditWhere(catalog, credit)}`)
      }
      expect(hub.indexOf('class="ye-scope"')).toBeLessThan(
        hub.indexOf('<h2 id="credits">'),
      )
      for (const page of cardPages) {
        const id = page.path.split('/').at(-1) ?? ''
        const card = catalog.cards.find((c) => c.id === id)
        expect(page.html.indexOf('class="ye-scope"'), id).toBeLessThan(
          page.html.indexOf('<h2 id='),
        )
        const href = unescape(
          /class="ye-issuer" href="([^"]*)"/.exec(page.html)?.[1] ?? '',
        )
        expect(card?.source_urls, id).toContain(href)
        const label = unescape(
          /class="ye-issuer"[^>]*>([^<]*)</.exec(page.html)?.[1] ?? '',
        )
        const host = new URL(href).hostname.replace(/^www\./, '')
        expect(label, id).toMatch(/ page (for the .+|on [a-z0-9.-]+)$/)
        if (label.includes(' page on ')) expect(label, id).toContain(host)
        if (card?.only_at) expect(label, id).toContain(card.name)
        expect(href, id).not.toMatch(/terms|pricing|disclosure|faq/i)
      }
    })

    test('no id or class carries a card id, and every link into a year-end page lands on an id or a data-anchor', () => {
      const ids = new Set(catalog.cards.map((c) => c.id))
      const named = (html: string) =>
        [...html.matchAll(/\s(?:id|class)="([^"]*)"/g)].flatMap((m) =>
          (m[1] ?? '').split(/\s+/),
        )
      for (const page of pages) {
        const leaks = named(page.html).filter((n) =>
          [...ids].some((id) => n === id || n.includes(id)),
        )
        expect(leaks, page.path).toEqual([])
      }
      const yearPage = pages.find((p) => p.path === `/year-end/${String(year)}`)
      const targets = (html: string) =>
        new Set(
          [...html.matchAll(/\s(?:id|data-anchor)="([^"]*)"/g)].map(
            (m) => m[1] ?? '',
          ),
        )
      const onPage = new Map([
        ['/year-end/', targets(hub)],
        [`/year-end/${String(year)}`, targets(yearPage?.html ?? '')],
      ])
      const sources = [
        ...pages.map((p) => ({ path: p.path, html: p.html })),
        ...[...yearEndLinks(ctx).values()].map((l) => ({
          path: 'card page',
          html: l.html,
        })),
      ]
      for (const { path: from, html } of sources)
        for (const m of html.matchAll(
          /href="(\/year-end\/[^"#]*)?#([^"]+)"/g,
        )) {
          const page = m[1] ?? from
          const found = onPage.get(page)
          if (!found) continue
          expect(found.has(m[2] ?? ''), `${from} → ${page}#${m[2] ?? ''}`).toBe(
            true,
          )
        }
    })

    test('is indexed only when 3 or more of its credits end with the year', () => {
      let indexed = 0
      for (const page of cardPages) {
        const id = page.path.split('/').at(-1) ?? ''
        const credits = (page.html.match(/<strong>\$[\d,.]+ back /g) ?? [])
          .length
        expect(page.noindex ?? false, id).toBe(credits < 3)
        expect(page.html.includes('noindex'), id).toBe(credits < 3)
        if (credits >= 3) indexed++
      }
      expect(indexed).toBeGreaterThan(5)
      expect(pageOf('amex-platinum')?.noindex ?? false).toBe(false)
    })

    test("sends the card's own address and title, counts only that it was used, and nothing about the visitor", () => {
      for (const page of cardPages) {
        const url = `https://earnrate.dev${page.path}`
        expect(page.html).toContain(`class="ye-send" data-url="${url}"`)
        expect(page.html).toContain(
          `data-title="${esc(title(page.html).replace(/ \| earnrate$/, ''))}"`,
        )
        expect(hub).toContain(`class="ye-send" data-url="${url}"`)
      }
      for (const html of [hub, pageOf('amex-platinum')?.html ?? '']) {
        const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
          .map((m) => m[1] ?? '')
          .join('\n')
        expect(scripts).toContain('navigator.share({ url, title })')
        const beacons = scripts.match(/sendBeacon\([^)]*\)/g) ?? []
        expect(beacons).toEqual(["sendBeacon('/count', 'year-end-share')"])
        expect(EVENTS).toContain('year-end-share')
        expect(scripts).not.toMatch(/fetch|XMLHttpRequest/)
      }
    })
  })

  test('in January the hub is the new year, and last year keeps an address', () => {
    const january = pageContext(catalog, {
      today: `${String(year + 1)}-01-05`,
      dataVersion: 'test',
    })
    const later = yearEndPages(january, () => january.today)
    const hubLater = later.find((p) => p.path === '/year-end/')?.html ?? ''
    expect(hubLater).toContain(`December 31, ${String(year + 1)}`)
    const past = later.find((p) => p.path === `/year-end/${String(year)}`)
    expect(past?.html).toContain('href="/year-end/"')
    expect(hubLater).toContain(`href="/year-end/${String(year)}"`)
    expect(
      later.filter((p) => p.path.startsWith(`/year-end/${String(year)}/`)),
    ).toEqual([])
    expect(yearEndRedirects(january)).toContain(
      `/year-end/${String(year)}/* /year-end/${String(year)}`,
    )
  })
})

describe('is the annual fee worth it', () => {
  const kit = feeWorthKit(catalog, today)
  const personal = catalog.cards.filter(
    (c) => !c.business && (c.annual_fee ?? 0) > 0,
  )
  const options = {
    filters: {
      kind: 'any' as const,
      business: false,
      noAnnualFee: true,
      issuer: null,
      includeClosed: false,
    },
    memberships: [],
    valuations: {},
    start: today,
  }
  const noFee = catalog.cards.filter(
    (c) =>
      c.annual_fee === 0 &&
      !c.business &&
      c.applications_closed === undefined &&
      c.requires_membership === undefined,
  )
  const first = (wanted: (w: FeeWorth) => boolean) => {
    for (const card of personal) {
      const w = kit.feeWorth(card)
      if (w && wanted(w)) return w
    }
    return null
  }
  const lead = (worth: FeeWorth, monthly: number) => {
    const lines = worth.lines.map((l) => ({
      ...l,
      monthly: l.monthly * monthly,
    }))
    const own =
      simulateSingles(catalog, [worth.card], lines, options)[0]?.net ?? 0
    const best = simulateSingles(catalog, noFee, lines, options)[0]?.net ?? 0
    return own - best
  }

  test('a break-even matches the engine run directly', () => {
    const worth = first((w) => w.breakEven !== null)
    if (!worth) return
    const breakEven = worth.breakEven ?? 0
    expect(lead(worth, breakEven), worth.card.id).toBeGreaterThan(0)
    expect(lead(worth, breakEven - 10), worth.card.id).toBeLessThanOrEqual(0)
  }, 60_000)

  test('a card that never comes out ahead is behind at every amount', () => {
    const worth = first((w) => w.breakEven === null)
    if (!worth) return
    for (const m of [STEP, 1000, MAX_MONTHLY])
      expect(lead(worth, m), worth.card.id).toBeLessThanOrEqual(0)
  }, 60_000)
})

describe('cheaper cards in the annual-fee section', () => {
  const kit = feeWorthKit(catalog, today)
  const byId = (id: string) => {
    const card = catalog.cards.find((c) => c.id === id)
    if (!card) throw new Error(`no card ${id}`)
    return card
  }
  const answer = (id: string) => {
    const worth = kit.feeWorth(byId(id))
    if (!worth) throw new Error(`no fee section for ${id}`)
    const cheaper = cheaperCards(catalog, worth, today)
    if (!cheaper) throw new Error(`no cheaper cards for ${id}`)
    return cheaper
  }
  const nets = (card: Card, lines: ResolvedLine[]) => {
    const [sim] = simulateSingles(catalog, [card], lines, {
      filters: { ...ALL_PERSONAL_CARDS, business: card.business },
      memberships: [],
      valuations: {},
      start: today,
    })
    return (sim?.rewards ?? 0) - (card.annual_fee ?? 0)
  }

  test("the Amex Gold's table is the engine's, on the section's typical spending", () => {
    const gold = byId('amex-gold')
    const c = answer('amex-gold')
    expect(c.lines.length).toBeGreaterThan(0)
    expect(c.own.net).toBeCloseTo(nets(gold, c.lines), 0)
    expect(c.rows.length).toBeGreaterThan(0)
    expect(c.rows.length).toBeLessThanOrEqual(3)
    expect(c.cents).not.toBeNull()
    expect(c.own.transferNet).not.toBeNull()
    const html = unescape(cheaperCardsTable(ctx, c))
    expect(html).toContain(
      `<tr><td><strong>${ctx.shortName('amex-gold')}</strong></td><td>${wholeDollars(gold.annual_fee ?? 0)}</td><td>${wholeDollars(c.own.net)}, or ${wholeDollars(c.own.transferNet ?? 0)} at ${String(c.cents)}¢</td></tr>`,
    )
    let last = Infinity
    for (const r of c.rows) {
      const card = byId(r.cardId)
      expect(r.fee).toBeLessThan(gold.annual_fee ?? 0)
      expect(card.business).toBe(false)
      expect(card.requires_membership).toBeUndefined()
      expect(r.net).toBeCloseTo(nets(card, c.lines), 0)
      expect(r.net).toBeLessThanOrEqual(last)
      last = r.net
      expect(html).toContain(`<a href="/cards/${r.cardId}">`)
    }
    expect(html).toMatch(
      /Use all \$[\d,]+ of its statement credits and it nets about/,
    )
  }, 60_000)

  test('a premium card that nets below zero still gets the table, with its credits', () => {
    const c = answer('amex-platinum')
    expect(c.own.net).toBeLessThan(0)
    const html = unescape(cheaperCardsTable(ctx, c))
    expect(html).toContain(
      `<td>${wholeDollars(c.own.net).replace('−', '−⁠')}, or `,
    )
    expect(html).toContain('a cheaper card nets more')
    expect(html).toContain(
      `it nets about ${wholeDollars(c.own.net + c.k.unsaid.yearly)}.`,
    )
  }, 60_000)

  test("a business card's cheaper cards are business cards", () => {
    for (const r of answer('amex-business-gold').rows)
      expect(byId(r.cardId).business, r.cardId).toBe(true)
  }, 60_000)
})

test("a card page's recent changes list earnrate's recent corrections, where the to-do list links", () => {
  const releases = ChangesFileSchema.parse([
    {
      version: '2026.11.20',
      date: '2026-11-20',
      changes: [
        {
          cause: 'correction',
          card: 'chase-prime-visa',
          field: 'rules.amazon',
          summary: '5% at Audible.com with Prime.',
        },
      ],
    },
    {
      version: '2026.09.01',
      date: '2026-09-01',
      changes: [
        {
          cause: 'correction',
          card: 'chase-prime-visa',
          field: 'rules.whole-foods',
          summary: 'An older fix.',
        },
      ],
    },
  ])
  const html = recentChangesSection(ctx, releases, 'chase-prime-visa')
  expect(cardChangesUrl('chase-prime-visa')).toMatch(/#recent-changes$/)
  expect(html).toMatch(/^<h2 id="recent-changes">Recent changes<\/h2>/)
  expect(html).toContain(
    "Corrections earnrate made to its own data about this card; Chase didn't change anything:",
  )
  expect(html).toContain('5% at Audible.com with Prime.')
  expect(html).not.toContain('An older fix.')
  expect(recentChangesSection(ctx, releases, 'amex-gold')).toBe('')
})

describe("Safari's Notify Me line", () => {
  const UA = {
    macSafari:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
    iPhoneSafari:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
    iPadSafari:
      'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
    iPhoneChrome:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1',
    iPhoneFirefox:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15',
    iPhoneGoogleApp:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/392.0.802498612 Mobile/15E148 Safari/604.1',
    macChrome:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    macEdge:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
    macFirefox:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0',
    windowsChrome:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    androidChrome:
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  }
  const safari = new Set(['macSafari', 'iPhoneSafari', 'iPadSafari'])

  test('is for Safari on a Mac, iPhone or iPad only', () => {
    for (const [name, ua] of Object.entries(UA))
      expect(safariOnApple(ua), name).toBe(safari.has(name))
  })

  test("the page's script shows it exactly where safariOnApple says, reading nothing but the user agent", () => {
    expect(NOTIFY_SCRIPT).not.toMatch(
      /fetch|sendBeacon|XMLHttpRequest|Storage|cookie/,
    )
    for (const [name, ua] of Object.entries(UA)) {
      const tip = {
        hidden: true,
        hasAttribute: (a: string) => a === 'data-notify-tip',
      }
      const document = { currentScript: { previousElementSibling: tip } }
      runInNewContext(NOTIFY_SCRIPT, {
        document,
        navigator: { userAgent: ua },
      })
      expect(tip.hidden, name).toBe(!safariOnApple(ua))
    }
  })
})
