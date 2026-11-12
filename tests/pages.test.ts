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
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { localToday } from '../src/engine/periods.ts'
import { rotationGapText } from '../src/engine/rotation.ts'
import { simulateSingles } from '../src/engine/simulate.ts'
import {
  earnText,
  longDate,
  money,
  quarterYear,
  shortDate,
  wholeDollars,
} from '../src/engine/text.ts'
import { ALL_PERSONAL_CARDS, exploreCards } from '../src/engine/explore.ts'
import { pageContext } from '../scripts/pages/context.ts'
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
import { currentPeriodEnd, inEffect, periodKey } from '../src/engine/periods.ts'
import { periodAmount } from '../src/engine/credits.ts'
import { recentChangesSection } from '../scripts/pages/changes.ts'
import { cardChangesUrl } from '../src/engine/changes.ts'
import { ChangesFileSchema } from '../src/schema/changes.ts'
import { DESCRIPTION_MAX, esc, TITLE_MAX } from '../scripts/pages/site.ts'
import { ROOT } from './helpers.ts'

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
      const noindex = readFileSync(file, 'utf8').includes(
        '<meta name="robots" content="noindex, follow" />',
      )
      if (noindex && listed.has(url))
        missing.push(`${url} is noindex but in the sitemap`)
      if (!noindex && !listed.has(url))
        missing.push(`${url} not in the sitemap`)
      if (!linked.has(url)) missing.push(`${url} not linked from any page`)
    }
    expect(missing).toEqual([])
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
    const card = readFileSync(path.join(out, 'cards', 'amex-gold.html'), 'utf8')
    expect(card).toContain('<a href="/rate">Rate my wallet</a>')
    for (const t of TABS) expect(card).toContain(`href="${t.href}"`)
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

  test('the year-end page is linked from the footer, and each card it lists has a page of its own, linked from the card', () => {
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
      expect(hub, id).toContain(`href="${address}"`)
      const card = readFileSync(path.join(out, 'cards', `${id}.html`), 'utf8')
      expect(card, id).toContain(`href="${address}"`)
      const page = readFileSync(path.join(out, `${address}.html`), 'utf8')
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

  test('only store pages with something of their own are indexed', () => {
    const page = (slug: string) =>
      readFileSync(path.join(out, 'best', `${slug}.html`), 'utf8')
    const noindex = (slug: string) => page(slug).includes('content="noindex')
    // Notes on how it codes, a credit there, a ranking of its own.
    for (const slug of ['costco', 'lululemon', 'amazon', 'groceries'])
      expect(noindex(slug), slug).toBe(false)
    // Ranked exactly like supermarkets, with nothing about Ralphs itself.
    expect(noindex('ralphs')).toBe(true)
    // Its category page lists it, so it's still reachable and answerable.
    expect(page('groceries')).toContain('href="/best/ralphs"')
    // American Express names Aldi among its example supermarkets.
    expect(noindex('aldi')).toBe(false)
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
      "Trader Joe's Vons Whole Foods Winn-Dixie This is not a complete list.",
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
    expect(answer('chewy')).toContain('amex-blue-cash-everyday')
    expect(answer('petco')).not.toBe('')
    expect(answer('petco')).not.toContain('buying online')
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

  test("every built page's header opens the app's tabs by their names, and the home page has only the tabs", () => {
    const nav = TABS.map((t) => `<a href="${t.href}">${t.name}</a>`).join('')
    for (const { file, html } of pages) {
      if (file.startsWith(out)) expect(html, file).toContain(nav)
      if (file === path.join(ROOT, 'site', 'index.html'))
        expect(html, file).not.toContain('class="app-nav"')
    }
  })
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
            expect(html).toContain(esc(e.quote))
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
    expect(
      hub.slice(details + 1, hub.indexOf('</details>', details)),
    ).not.toMatch(/<details/)
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
      expect(platinum).toContain(`href="/year-end/${String(year)}#`)
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
      expect(platinum).toContain(`worth up to ${money(total)} together`)
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
      expect(sentence).toMatch(/airline fee credit/)
      expect(sentence).toMatch(/hotel collection/)
      expect(sentence).toMatch(/spending total/)
      expect(hub.indexOf('class="ye-scope"')).toBeLessThan(
        hub.indexOf('<h2 id="credits">'),
      )
      for (const page of cardPages) {
        const id = page.path.split('/').at(-1) ?? ''
        const card = catalog.cards.find((c) => c.id === id)
        expect(scope.exec(page.html)?.[1], id).toContain(sentence)
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

    test('is indexed only when something on it ends with the year', () => {
      for (const page of cardPages) {
        const id = page.path.split('/').at(-1) ?? ''
        const ends = [...y.credits, ...y.ending, ...y.milestones].some(
          (c) => c.card.id === id,
        )
        expect(page.noindex ?? false, id).toBe(!ends)
        expect(page.html.includes('noindex'), id).toBe(!ends)
      }
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
