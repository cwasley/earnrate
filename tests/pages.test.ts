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
import {
  feeWorthKit,
  type FeeWorth,
  MAX_MONTHLY,
  STEP,
} from '../src/engine/fee-worth.ts'
import { quarterlyPages, quarters } from '../scripts/pages/quarterly.ts'
import { yearEnd, yearEndPages } from '../scripts/pages/year-end.ts'
import { creditWhere } from '../src/engine/rule-text.ts'
import { currentPeriodEnd, inEffect } from '../src/engine/periods.ts'
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

  test('the year-end page is linked from the cards it lists and from the footer', () => {
    const year = yearEnd(ctx, Number(today.slice(0, 4)))
    for (const { card } of year.credits)
      expect(
        readFileSync(path.join(out, 'cards', `${card.id}.html`), 'utf8'),
        card.id,
      ).toContain(`href="/year-end/#credits-${card.id}"`)
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
    // Ranked exactly like supermarkets, with nothing about Aldi itself.
    expect(noindex('aldi')).toBe(true)
    // Its category page lists it, so it's still reachable and answerable.
    expect(page('groceries')).toContain('href="/best/aldi"')
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
    const start = hub.indexOf(`id="${section}-${cardId}"`)
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
          esc(`${money(credit.amount)} back ${creditWhere(catalog, credit)}`),
        )
        if (credit.note) expect(html, credit.id).toContain(esc(credit.note))
        const quote = card.evidence.find((e) => e.rule === credit.id)
        if (quote) expect(html, credit.id).toContain(esc(quote.quote))
      }
    expect(
      [...y.credits, ...y.monthly].flatMap((c) =>
        c.items.filter((i) => i.credit.period === 'cardmember_year'),
      ),
    ).toEqual([])
    const details = hub.indexOf('<details class="ye-monthly">')
    expect(details).toBeGreaterThan(hub.indexOf('id="spend"'))
    expect(hub.indexOf('id="monthly-')).toBeGreaterThan(details)
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
    const script = /<script>\(\(\) => \{[\s\S]*?<\/script>/.exec(hub)?.[0]
    expect(script).toContain("localStorage.getItem('earnrate:wallet')")
    expect(script).not.toMatch(/fetch|sendBeacon|XMLHttpRequest/)
    expect(hub).toContain('data-ye-list')
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
