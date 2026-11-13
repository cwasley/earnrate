// Checks the built site (yarn site:build first) in Chromium and WebKit: a
// saved wallet adds no element id or class that names a card the visitor
// holds or marks one as held. Cloudflare's analytics script sends the id and
// class path of the element behind the slowest interaction and the biggest
// layout shift, so those must say nothing about the visitor. Ids every
// visitor gets, like a public page's anchor for each card, are page content.
//
//   yarn site:check-selectors
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { Browser, Page } from 'playwright'
import { loadCatalog } from '../src/data/load.ts'
import { localToday } from '../src/engine/periods.ts'
import { encodeReport } from './rate/link.ts'
import { encodeSheet } from './sheet/link.ts'

const DIST = path.join(import.meta.dirname, '..', 'site-dist')
const HELD = ['chase-freedom-flex', 'amex-platinum', 'citi-custom-cash']
// Classes that once marked a held card; that state goes in data-* now.
const STATE = /(^|\s)(kept|ye-held)(\s|$)/
const SAVED = {
  'earnrate:wallet': JSON.stringify({
    valuations: {},
    memberships: ['amazon-prime'],
    cards: HELD.map((id) => ({ id, cap_usage: {}, activated: [] })),
  }),
  'earnrate:spending': JSON.stringify([
    { what: 'Groceries', monthly: 500 },
    { what: 'Everything else', monthly: 900 },
  ]),
}

const catalog = await loadCatalog()
const SENT = encodeSheet(
  catalog,
  JSON.parse(SAVED['earnrate:wallet']) as Parameters<typeof encodeSheet>[1],
  localToday(),
)
// A report someone shared on the same cards, with credits answered both ways.
const REPORT = encodeReport(catalog, {
  input: {
    cards: [
      { id: 'amex-platinum', picks: {}, used: ['uber-cash'] },
      ...HELD.filter((id) => id !== 'amex-platinum').map((id) => ({
        id,
        picks: {},
      })),
    ],
    memberships: [],
    valuations: {},
  },
  lines: null,
})

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/count') {
      res.writeHead(204).end()
      return
    }
    const base = path.join(DIST, decodeURIComponent(url.pathname))
    for (const file of [base, `${base}.html`, path.join(base, 'index.html')])
      try {
        if (!(await stat(file)).isFile()) continue
        res.writeHead(200, {
          'content-type': TYPES[path.extname(file)] ?? 'text/plain',
        })
        res.end(await readFile(file))
        return
      } catch {
        // the next candidate
      }
    res.writeHead(404).end()
  })()
})
await new Promise<void>((r) => server.listen(0, r))
const BASE = `http://localhost:${String((server.address() as AddressInfo).port)}`

// Each element's id and class, as Cloudflare's selector would read them.
const marks = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[id], [class]')].map(
      (el) => `id="${el.id}" class="${el.getAttribute('class') ?? ''}"`,
    ),
  )

async function wallet(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  await context.addInitScript((saved: Record<string, string>) => {
    if (sessionStorage.getItem('seeded')) return
    for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v)
    sessionStorage.setItem('seeded', '1')
  }, SAVED)
  return context
}

type Step = {
  name: string
  url: string
  ready: string
  act?: (page: Page) => Promise<void>
}

const STEPS: Step[] = [
  { name: 'My wallet', url: '/#wallet', ready: '.held-row' },
  {
    name: "a held card's Settings and Keep or replace?",
    url: '/#wallet&card=amex-platinum',
    ready: 'fieldset.keep',
    act: async (page) => {
      await page
        .getByRole('button', { name: 'Compare with cheaper cards' })
        .click()
      await page.waitForSelector('.keep-answer')
    },
  },
  {
    name: 'A new card for my wallet, at a card',
    url: '/#wallet&whatif=chase-sapphire-preferred',
    ready: '.new-card .result',
  },
  {
    name: 'At a store from your own cards',
    url: '/#best=groceries',
    ready: '.results .verdict',
  },
  {
    name: 'At a store from every card, with yours marked',
    url: '/#best=groceries',
    ready: '.results',
    act: async (page) => {
      await page.getByText('Every card', { exact: true }).click()
      await page.waitForSelector('.results [data-yours]')
    },
  },
  {
    name: 'the add flow with held cards in it',
    url: '/#wallet',
    ready: '.held-row',
    act: async (page) => {
      await page.getByRole('button', { name: 'Add a card' }).click()
      await page.waitForSelector('.quick-cards')
    },
  },
  {
    name: 'Best setups at a card',
    url: '/#spending&card=amex-platinum',
    ready: '.result-list',
  },
  { name: 'a card page', url: '/cards/amex-platinum', ready: 'main' },
  {
    name: 'Rate my wallet on the saved wallet, with the share box',
    url: '/rate',
    ready: '.rate-share',
    act: async (page) => {
      await page.waitForFunction(
        () => !document.body.innerText.includes('Working it out'),
      )
    },
  },
  {
    name: 'Rate my wallet after tapping credits, All and None',
    url: '/rate',
    ready: '.credit-tile',
    act: async (page) => {
      const settle = () =>
        page.waitForFunction(
          () => document.querySelector('[aria-busy="true"]') === null,
        )
      const classes = async () =>
        (await marks(page)).map((m) => /class="([^"]*)"/.exec(m)?.[1] ?? '')
      await settle()
      const before = new Set(await classes())
      await page.locator('.credit-use').first().click()
      await page.locator('.credit-use').nth(1).click()
      await page.waitForSelector('.credit-use[aria-pressed="true"]')
      await page
        .getByRole('button', { name: /^I don't use .* other credits/ })
        .first()
        .click()
      await page.waitForSelector('.credit-use[data-answer="skipped"]')
      await page
        .getByRole('button', { name: /^I use all of/ })
        .first()
        .click()
      await page
        .getByRole('button', { name: /^I use none of/ })
        .first()
        .click()
      await page.waitForSelector('.credit-use:not([aria-pressed="true"])')
      await settle()
      const added = (await classes()).filter((c) => !before.has(c))
      check(
        'marking credits on Rate my wallet adds no class',
        added.length === 0,
        added.join(' '),
      )
    },
  },
  {
    name: 'the year-end page',
    url: '/year-end/',
    ready: 'main',
    act: async (page) => {
      const shown = await page.evaluate(() =>
        [...document.querySelectorAll('.ye-mark')].map(
          (m) =>
            (m.closest('[data-held]') !== null) ===
            (getComputedStyle(m).display !== 'none'),
        ),
      )
      check(
        'the year-end page marks your cards, and only those',
        shown.length > 0 && shown.every(Boolean),
      )
    },
  },
  // Last: tapping saves the answers, which Rate my wallet would then fold.
  {
    name: "a held card's Settings after tapping credits, All and None",
    url: '/#wallet&card=amex-platinum',
    ready: '.editor .credit-picks',
    act: async (page) => {
      // Credits answered on Rate my wallet start folded to one line.
      const line = page.locator('.editor .credit-picks-line')
      if ((await line.count()) > 0) await line.click()
      await page.waitForSelector('.editor .credit-use')
      const classes = async () =>
        (await marks(page)).map((m) => /class="([^"]*)"/.exec(m)?.[1] ?? '')
      const before = new Set(await classes())
      await page.locator('.editor .credit-use').first().click()
      await page.waitForSelector('.editor .credit-use[aria-pressed="true"]')
      await page
        .getByRole('button', { name: /^I (use none of|don't use)/ })
        .first()
        .click()
      await page.waitForTimeout(300)
      const added = (await classes()).filter((c) => !before.has(c))
      check(
        "marking credits in a card's Settings adds no class",
        added.length === 0,
        added.join(' '),
      )
    },
  },
]

const { chromium, webkit } = await import('playwright')
for (const [name, type] of [
  ['chromium', chromium],
  ['webkit', webkit],
] as const) {
  const browser = await type.launch()
  const plain = await (
    await browser.newContext({ viewport: { width: 390, height: 844 } })
  ).newPage()
  const saved = await (await wallet(browser)).newPage()
  for (const step of STEPS) {
    await plain.goto(`${BASE}${step.url}`)
    await plain.waitForSelector('main')
    const everyone = new Set(await marks(plain))
    await saved.goto(`${BASE}${step.url}`)
    await saved.waitForSelector(step.ready)
    await step.act?.(saved)
    const found = [
      ...new Set(
        (await marks(saved)).filter(
          (m) =>
            STATE.test(/class="([^"]*)"/.exec(m)?.[1] ?? '') ||
            (!everyone.has(m) && HELD.some((id) => m.includes(id))),
        ),
      ),
    ]
    check(`${name}: ${step.name}`, found.length === 0, found.join(' '))
  }

  // Rate my wallet with no saved wallet: cards tapped in, then rated, with
  // the share box showing. Nothing here should name a card in an id or class.
  const named = async () =>
    (await marks(plain)).filter((m) => HELD.some((id) => m.includes(id)))
  await plain.goto(`${BASE}/rate`)
  await plain.waitForSelector('.quick-cards')
  for (const card of ['Chase Freedom Flex', 'Amex Platinum'])
    await plain
      .getByRole('button', { name: new RegExp(card) })
      .first()
      .click()
  check(
    `${name}: Rate my wallet's picker after tapping cards`,
    (await named()).length === 0,
    (await named()).join(' '),
  )
  await plain.getByRole('button', { name: /^Rate them$/ }).click()
  await plain.waitForSelector('.rate-share')
  await plain.waitForFunction(
    () => !document.body.innerText.includes('Working it out'),
  )
  check(
    `${name}: the rated cards and the share box`,
    (await named()).length === 0,
    (await named()).join(' '),
  )
  await plain.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', {
      value: undefined,
      configurable: true,
    })
  })
  const [image] = await Promise.all([
    plain.waitForEvent('download'),
    plain.getByRole('button', { name: 'Save as image' }).click(),
  ])
  check(
    `${name}: Save as image on Rate my wallet, then the page`,
    image.suggestedFilename() === 'earnrate-wallet-report.png' &&
      (await named()).length === 0,
    `${image.suggestedFilename()} ${(await named()).join(' ')}`,
  )

  // A cheat sheet someone sent, in an empty profile and beside a saved
  // wallet: its cards come from the link, so no page without one shows
  // them; none may be in an id or class, and storage stays as it was.
  const fresh = await (
    await browser.newContext({ viewport: { width: 390, height: 844 } })
  ).newPage()
  const storage = (page: Page) =>
    page.evaluate(() =>
      JSON.stringify(
        [localStorage, sessionStorage].map((s) =>
          Array.from({ length: s.length }, (_, i) => {
            const key = s.key(i) ?? ''
            return [key, s.getItem(key)]
          }),
        ),
      ),
    )
  await saved.goto(`${BASE}/#wallet`)
  await saved.waitForSelector('.held-row')
  const before = await storage(saved)
  for (const [who, page] of [
    ['an empty profile', fresh],
    ['a saved wallet', saved],
  ] as const) {
    await page.goto(`${BASE}/sheet#${SENT}`)
    await page.waitForSelector('.sent-sheet .sheet-rows li')
    const found = (await marks(page)).filter((m) =>
      HELD.some((id) => m.includes(id)),
    )
    check(
      `${name}: a sent cheat sheet, with ${who}`,
      found.length === 0,
      found.join(' '),
    )
  }
  check(
    `${name}: opening a sent cheat sheet stores nothing`,
    (await storage(fresh)) === '[[],[]]' && (await storage(saved)) === before,
  )

  // A shared report, read only: its credits are lines, not tiles, and
  // nothing names a card in an id or class or touches storage.
  for (const [who, page] of [
    ['an empty profile', fresh],
    ['a saved wallet', saved],
  ] as const) {
    await page.goto(`${BASE}/rate#${REPORT}`)
    await page.waitForSelector('.rate-credit-lines li')
    await page.waitForFunction(
      () => document.querySelector('[aria-busy="true"]') === null,
    )
    const found = (await marks(page)).filter((m) =>
      HELD.some((id) => m.includes(id)),
    )
    check(
      `${name}: a shared report, with ${who}`,
      found.length === 0 && (await page.locator('.credit-use').count()) === 0,
      found.join(' '),
    )
  }
  check(
    `${name}: opening a shared report stores nothing`,
    (await storage(fresh)) === '[[],[]]' && (await storage(saved)) === before,
  )
  await browser.close()
}
server.close()
console.log(failed === 0 ? 'All checks passed.' : `${String(failed)} failed.`)
process.exit(failed === 0 ? 0 : 1)
