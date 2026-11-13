import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import {
  compareSources,
  formatReport,
  hasChanges,
  sourceUrls,
  type PageSnapshot,
  type SourcesLock,
} from '../src/sources/check.ts'
import {
  containsQuote,
  earningLines,
  errorPage,
  lineKey,
  normalizeText,
  splitPage,
} from '../src/sources/text.ts'

const realCatalog = await loadCatalog()
const sofi = realCatalog.cards.find((c) => c.id === 'sofi-unlimited-2')
if (!sofi) throw new Error('sofi card missing')
const [page] = sofi.source_urls
if (page === undefined) throw new Error('no source url')
const card = {
  ...sofi,
  source_urls: [page],
  evidence: sofi.evidence.filter((e) => e.url === page),
}
const catalog = { ...realCatalog, cards: [card] }
const [url] = [...sourceUrls(catalog).keys()]
if (url === undefined) throw new Error('no source url')

const quotes = card.evidence.map((e) => e.quote).join('. ')
const PAGE = `SoFi Unlimited 2% Credit Card\n${quotes}.\nVariable APR 19.99% to 29.99%.\nEarn 2% cash back on every purchase when you redeem into SoFi.`

const ok = (...texts: string[]): PageSnapshot => ({
  url,
  ok: true,
  loads: texts.map((t) => ({ innerText: t, fullText: t, pageData: '' })),
})

describe('text', () => {
  test('normalization ignores trademark marks, curly quotes and spacing', () => {
    expect(normalizeText('Card Members’ 5X  Points ® on “flights” .')).toBe(
      'card members\' 5x points on "flights".',
    )
    expect(
      containsQuote(['Amex Travel App ™ . Earn more'], 'Amex Travel App.'),
    ).toBe(true)
  })

  test("an issuer's error page is recognized", () => {
    expect(
      errorPage(
        'Log In Loading Error Sorry, we are unable to load this page at this time. Please try again later.',
      ),
    ).toMatch(/unable to load this page/)
    expect(
      errorPage(
        'Target Circle We’re sorry! This page is currently unavailable. Please try again later.',
      ),
    ).toMatch(/currently unavailable/)
    expect(errorPage(PAGE)).toBeNull()
  })

  test('page text leaves script, style, template and noscript contents out', () => {
    const html = [
      '<html><head><title>Card</title><script>var s = "<body>in head"</script></head>',
      '<body class="page" data-note="a > b"><h1>Earn&nbsp;5X &amp; more</h1>',
      '<!-- <script> -->',
      '<script id="__NEXT_DATA__" type="application/json">{"offer":"old offer"}</script>',
      '<style>.offer::after { content: "styled" }</style>',
      '<template><p>outer <template>inner</template> template</p></template>',
      '<noscript><p>Turn on JavaScript</p></noscript>',
      '<p>Card Members&#8217; &#x2018;offer&#x2019; &lt;terms&gt;</p></body></html>',
    ].join('')
    const { text, data } = splitPage(html)
    expect(text).toBe('Earn\u00a05X & moreCard Members’ ‘offer’ <terms>')
    expect(data).toContain('{"offer":"old offer"}')
    expect(data).toContain('outer  template')
    expect(data).toContain('inner')
    expect(data).not.toContain('styled')
  })

  test('list items read apart even with no space between them in the markup', () => {
    const { text } = splitPage(
      '<body><ul><li>Amazon</li><li>Crate &amp; Barrel</li><li>Walmart</li></ul></body>',
    )
    expect(containsQuote([text], 'Amazon Crate & Barrel Walmart')).toBe(true)
  })

  test('earning lines skip APRs and short fragments', () => {
    const lines = earningLines(PAGE)
    expect(lines).toContain(
      'Earn 2% cash back on every purchase when you redeem into SoFi.',
    )
    expect(lines.join(' ')).not.toMatch(/APR/)
  })
})

describe('compareSources', () => {
  const baseline = (innerText: string): SourcesLock =>
    compareSources(
      catalog,
      new Map([[url, ok(innerText)]]),
      { version: 1, pages: {} },
      '2026-10-24',
    ).nextLock

  test('an unchanged page reports nothing', () => {
    const { report } = compareSources(
      catalog,
      new Map([[url, ok(PAGE)]]),
      baseline(PAGE),
      '2026-10-31',
    )
    expect(hasChanges(report)).toBe(false)
    expect(formatReport(report, '2026-10-31')).toMatch(
      /Every rule is still backed/,
    )
  })

  test('the lock stores hashes, not the issuer text', () => {
    const lock = baseline(PAGE)
    expect(JSON.stringify(lock)).not.toMatch(/cash back/)
    expect(lock.pages[url]?.lines).toContain(
      lineKey('Earn 2% cash back on every purchase when you redeem into SoFi.'),
    )
  })

  test('a quote that disappears flags its rule', () => {
    const first = card.evidence[0]
    if (!first) throw new Error('no evidence')
    const changed = PAGE.replace(first.quote, 'something else entirely')
    const { report } = compareSources(
      catalog,
      new Map([[url, ok(changed)]]),
      baseline(PAGE),
      '2026-10-31',
    )
    expect(report.missingEvidence).toEqual([
      expect.objectContaining({ cardId: 'sofi-unlimited-2', rule: first.rule }),
    ])
    expect(formatReport(report, '2026-10-31')).toMatch(/backing text is gone/)
  })

  describe('a quote only in hidden text', () => {
    const first = card.evidence[0]
    if (!first) throw new Error('no evidence')
    const visible = PAGE.replace(first.quote, '')
    const check = (hidden: string, inPopup = false) => {
      const html = `<html><body><main>${visible}</main>${hidden}</body></html>`
      const { text, data } = splitPage(html)
      const load = { innerText: visible, fullText: text, pageData: data }
      const evidence = card.evidence.map((e) =>
        e === first && inPopup ? { ...e, in_popup: true as const } : e,
      )
      return compareSources(
        { ...catalog, cards: [{ ...card, evidence }] },
        new Map([[url, { url, ok: true, loads: [load, load] }]]),
        baseline(PAGE),
        '2026-10-31',
      ).report
    }
    const missing = (hidden: string, inPopup = false) =>
      check(hidden, inPopup).missingEvidence.map((m) => m.rule)
    const data = JSON.stringify({ props: { offer: first.quote } })
    const script = `<script id="__NEXT_DATA__" type="application/json">${data}</script>`

    test('fails when it is only in page data inside a script', () => {
      const report = check(script)
      expect(report.missingEvidence).toEqual([
        expect.objectContaining({ rule: first.rule, onlyInPageData: true }),
      ])
      expect(formatReport(report, '2026-10-31')).toMatch(
        /only in the page's embedded data/,
      )
    })

    test('passes in page data when marked in_popup', () => {
      expect(missing(script, true)).toEqual([])
    })

    test('fails when marked in_popup but gone from the page data too', () => {
      expect(missing('', true)).toEqual([first.rule])
      expect(check('').missingEvidence[0]?.onlyInPageData).toBe(false)
    })

    test('passes in a collapsed section, since it is not an offer quote', () => {
      expect(
        missing(`<details><summary>Terms</summary>${first.quote}</details>`),
      ).toEqual([])
    })

    test('passes in an overlay hidden with display: none', () => {
      expect(
        missing(
          `<div role="dialog" style="display: none"><p>${first.quote}</p></div>`,
        ),
      ).toEqual([])
    })
  })

  describe('an offer quote', () => {
    const offer = 'Earn a $200 bonus after you spend $500 in the first 3 months'
    const check = (
      shown: string,
      hidden: string,
      flags: { in_collapsed?: true; in_popup?: true } = {},
      rule = 'welcome_offer',
    ) => {
      const html = `<html><body><main>${PAGE}\n${shown}</main>${hidden}</body></html>`
      const { text, data } = splitPage(html)
      const load = {
        innerText: `${PAGE}\n${shown}`,
        fullText: text,
        pageData: data,
      }
      const withOffer = {
        ...card,
        welcome_offer: { dollars: 200, spend: 500, months: 3 },
        evidence: [...card.evidence, { rule, url, quote: offer, ...flags }],
      }
      return compareSources(
        { ...catalog, cards: [withOffer] },
        new Map([[url, { url, ok: true, loads: [load, load] }]]),
        baseline(PAGE),
        '2026-10-31',
      ).report
    }
    const details = `<details><summary>Offer terms</summary>${offer}</details>`
    const stale = `<div class="offer-v1" style="display: none">${offer}</div>`

    test('passes where the page shows it', () => {
      expect(check(offer, '').missingEvidence).toEqual([])
    })

    test('fails when only stale hidden copy has it, and says so', () => {
      const report = check('Earn a $250 bonus after you spend $500', stale)
      expect(report.missingEvidence).toEqual([
        expect.objectContaining({
          rule: 'welcome_offer',
          onlyInHiddenText: true,
          onlyInPageData: false,
        }),
      ])
      expect(formatReport(report, '2026-10-31')).toMatch(
        /only in the page's hidden text, not what it shows\. .*`in_collapsed: true`.*stale copy and the offer has changed/,
      )
    })

    test('fails in a collapsed section unless marked in_collapsed', () => {
      expect(check('', details).missingEvidence.map((m) => m.rule)).toEqual([
        'welcome_offer',
      ])
      expect(
        check('', details, { in_collapsed: true }).missingEvidence,
      ).toEqual([])
    })

    test('holds the first-year fee and offer exclusions to the same rule', () => {
      for (const rule of ['first_year_fee', 'not_with'])
        expect(
          check('', stale, {}, rule).missingEvidence.map((m) => m.rule),
        ).toEqual([rule])
    })

    test('marked in_collapsed but gone from the page altogether still fails', () => {
      const [m] = check('', '', { in_collapsed: true }).missingEvidence
      expect(m).toMatchObject({ onlyInHiddenText: false })
      expect(formatReport(check('', ''), '2026-10-31')).not.toMatch(
        /hidden text/,
      )
    })

    test('marked in_popup, it matches hidden text and page data as before', () => {
      expect(check('', stale, { in_popup: true }).missingEvidence).toEqual([])
    })
  })

  test('a new earning line and a removed one are both reported', () => {
    const changed = PAGE.replace(
      'Earn 2% cash back on every purchase when you redeem into SoFi.',
      'Earn 3% cash back at restaurants through 12/31/27.',
    )
    const { report } = compareSources(
      catalog,
      new Map([[url, ok(changed)]]),
      baseline(PAGE),
      '2026-10-31',
    )
    expect(report.newLines).toEqual([
      { url, lines: ['Earn 3% cash back at restaurants through 12/31/27.'] },
    ])
    const gone =
      'Earn 2% cash back on every purchase when you redeem into SoFi.'
    expect(report.removedLines).toEqual([{ url, keys: [lineKey(gone)] }])
    expect(formatReport(report, '2026-10-31')).toContain(`- ${url}: 1 line(s)`)
    expect(formatReport(report, '2026-10-31', { [url]: [gone] })).toContain(
      `  - ${gone}`,
    )
  })

  test('copy that varies between loads is neither new nor removed', () => {
    const promo = 'Limited time: earn 10% back on select purchases this week.'
    const lock = baseline(PAGE)
    const withPromo = `${PAGE}\n${promo}`
    const firstOnly = compareSources(
      catalog,
      new Map([[url, ok(withPromo, PAGE)]]),
      lock,
      '2026-10-31',
    ).report
    expect(firstOnly.newLines).toEqual([])

    const shownOnce = PAGE.replace(
      'Earn 2% cash back on every purchase when you redeem into SoFi.',
      '',
    )
    const stillThere = compareSources(
      catalog,
      new Map([[url, ok(shownOnce, PAGE)]]),
      lock,
      '2026-10-31',
    ).report
    expect(stillThere.removedLines).toEqual([])
  })

  test("a page that can't be fetched is reported, not treated as changed", () => {
    const { report, nextLock } = compareSources(
      catalog,
      new Map([[url, { url, ok: false, reason: 'HTTP 403' }]]),
      baseline(PAGE),
      '2026-10-31',
    )
    expect(hasChanges(report)).toBe(false)
    expect(report.unreachable).toEqual([
      {
        url,
        reason: 'HTTP 403',
        cards: ['sofi-unlimited-2'],
        lastRead: '2026-10-24',
        quotes: card.evidence.map((e) => ({
          cardId: 'sofi-unlimited-2',
          rule: e.rule,
          quote: e.quote,
        })),
      },
    ])
    expect(nextLock.pages[url]?.checked).toBe('2026-10-24')
    const text = formatReport(report, '2026-10-31')
    expect(text).toMatch(/HTTP 403; last read 2026-10-24/)
    expect(text).toContain(`"${card.evidence[0]?.quote ?? ''}"`)
  })

  test('only the named cards are checked; other pages keep their lock entries', () => {
    const other = 'https://other.example.com/'
    const lock = baseline(PAGE)
    const withOther: SourcesLock = {
      ...lock,
      pages: { ...lock.pages, [other]: { checked: '2026-01-01', lines: [] } },
    }
    const twoCards = {
      ...catalog,
      cards: [
        ...catalog.cards,
        { ...card, id: 'someone-else', source_urls: [other], evidence: [] },
      ],
    }
    const { report, nextLock } = compareSources(
      twoCards,
      new Map([[url, ok(PAGE)]]),
      withOther,
      '2026-10-31',
      new Set(['sofi-unlimited-2']),
    )
    expect(report.unreachable).toEqual([])
    expect(nextLock.pages[other]?.checked).toBe('2026-01-01')
    expect(nextLock.pages[url]?.checked).toBe('2026-10-31')
  })

  test('pages that are no longer sources drop out of the lock', () => {
    const lock = baseline(PAGE)
    const stale: SourcesLock = {
      ...lock,
      pages: {
        ...lock.pages,
        'https://old.example.com/': { checked: '2026-01-01', lines: [] },
      },
    }
    const { nextLock } = compareSources(
      catalog,
      new Map([[url, ok(PAGE)]]),
      stale,
      '2026-10-31',
    )
    expect(Object.keys(nextLock.pages)).toEqual([url])
  })

  test('an offer shown on some visits but not others is reported', () => {
    const offer = 'Earn a $300 bonus after you spend $3,000'
    const withOffer = {
      ...catalog,
      cards: [
        {
          ...card,
          welcome_offer: { dollars: 300, spend: 3000, months: 3 },
          evidence: [
            ...card.evidence,
            { rule: 'welcome_offer', url, quote: offer },
          ],
        },
      ],
    }
    const loads = new Map([[url, ok(`${PAGE}\n${offer}.`, PAGE)]])
    const { report } = compareSources(withOffer, loads, baseline(PAGE), 'today')
    expect(report.varyingOffers).toEqual([
      { cardId: card.id, url, quote: offer },
    ])
    expect(hasChanges(report)).toBe(true)
    expect(formatReport(report, 'today')).toMatch(/differed between visits/)

    const marked = {
      ...withOffer,
      cards: withOffer.cards.map((c) => ({
        ...c,
        welcome_offer: { ...c.welcome_offer, varies: true as const },
      })),
    }
    expect(
      compareSources(marked, loads, baseline(PAGE), 'today').report
        .varyingOffers,
    ).toEqual([])
  })
})
