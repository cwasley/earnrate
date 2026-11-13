// Checks the built statement check (yarn site:build first) in real browsers:
// served with site-dist/_headers the way earnrate.dev serves it, it makes no
// request after it loads, its policy blocks one when the page's own code
// tries, it reads a file and answers with the network off, and it leaves the
// browser's storage as it found it. Synthetic files only.
//
//   yarn site:check-statement [--shots <dir>] [--shots-in webkit]
//
// --shots also saves screenshots at 390px and 1280px, light and dark (in
// Chromium, or WebKit with --shots-in webkit), and the page's text as
// page-text.md, for review.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { Browser, Page } from 'playwright'
import { AMEX_CSV, CHASE_CSV, OTHER_CSV } from '../tests/statement-fixtures.ts'
import { headerPolicy } from './statement-policy.ts'

const DIST = path.join(import.meta.dirname, '..', 'site-dist')
const { values } = parseArgs({
  options: {
    shots: { type: 'string' },
    'shots-in': { type: 'string' },
    prefix: { type: 'string' },
  },
})
const shots = values.shots ? path.resolve(values.shots) : null
const prefix = values.prefix ?? ''
const shotsIn = (values['shots-in'] ?? 'chromium').toLowerCase()

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

// site-dist/_headers, applied as Cloudflare does: every matching block, so a
// header two blocks set is sent twice and both apply.
async function headerRules() {
  const rules: { path: string; headers: [string, string][] }[] = []
  for (const line of (
    await readFile(path.join(DIST, '_headers'), 'utf8')
  ).split('\n')) {
    if (line.startsWith('/')) rules.push({ path: line.trim(), headers: [] })
    else if (line.startsWith('  ') && rules.length > 0) {
      const [name = '', ...rest] = line.trim().split(':')
      rules.at(-1)?.headers.push([name, rest.join(':').trim()])
    }
  }
  return (url: string) =>
    rules
      .filter((r) => r.path === url || r.path === '/*')
      .flatMap((r) => r.headers)
}

type Logged = { at: number; method: string; url: string }

async function serve() {
  const headersFor = await headerRules()
  const log: Logged[] = []
  const server = createServer((req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    log.push({ at: Date.now(), method: req.method ?? '', url: url.pathname })
    if (url.pathname === '/count') {
      res.writeHead(204).end()
      return
    }
    const file =
      url.pathname === '/statement'
        ? 'statement.html'
        : url.pathname === '/blank'
          ? null
          : url.pathname.slice(1)
    const headers = new Map<string, string[]>()
    for (const [name, value] of headersFor(url.pathname))
      headers.set(name, [...(headers.get(name) ?? []), value])
    for (const [name, list] of headers) res.setHeader(name, list)
    if (file === null) {
      res.setHeader('content-type', 'text/html')
      res.end('<!doctype html><title>blank</title>')
      return
    }
    readFile(path.join(DIST, file))
      .then((body) => {
        res.setHeader(
          'content-type',
          file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain',
        )
        res.end(body)
      })
      .catch(() => res.writeHead(404).end())
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { origin: `http://127.0.0.1:${String(port)}`, log, server }
}

const WALLET = JSON.stringify({
  valuations: {},
  memberships: [],
  cards: [
    'amex-gold',
    'amex-blue-cash-preferred',
    'chase-sapphire-preferred',
    'chase-freedom-unlimited',
    'citi-double-cash',
  ].map((id) => ({ id, cap_usage: {}, activated: [] })),
})

const csv = (name: string, text: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text),
})

type Storage = {
  local: Record<string, string>
  session: number
  cookie: string
  databases: string[]
  caches: string[]
}

const storage = (page: Page) =>
  page.evaluate(async (): Promise<Storage> => {
    const local: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? ''
      local[key] = localStorage.getItem(key) ?? ''
    }
    const databases =
      'databases' in indexedDB
        ? (await indexedDB.databases()).map((d) => d.name ?? '')
        : []
    return {
      local,
      session: sessionStorage.length,
      cookie: document.cookie,
      databases,
      caches: 'caches' in globalThis ? await caches.keys() : [],
    }
  })

async function open(
  browser: Browser,
  origin: string,
  options: {
    width: number
    dark?: boolean
    wallet?: boolean
  },
) {
  const context = await browser.newContext({
    viewport: { width: options.width, height: 900 },
    colorScheme: options.dark ? 'dark' : 'light',
    ...(options.wallet
      ? {
          storageState: {
            cookies: [],
            origins: [
              {
                origin,
                localStorage: [{ name: 'earnrate:wallet', value: WALLET }],
              },
            ],
          },
        }
      : {}),
  })
  await context.addInitScript(() => {
    const seen: string[] = []
    Object.defineProperty(window, '__violations', { value: seen })
    document.addEventListener('securitypolicyviolation', (e) =>
      seen.push(`${e.effectiveDirective} ${e.blockedURI}`),
    )
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const requests: string[] = []
  const response = await page.goto(`${origin}/statement`, {
    waitUntil: 'load',
  })
  const policy = (await response?.headersArray())
    ?.filter((h) => h.name.toLowerCase() === 'content-security-policy')
    .map((h) => h.value)
  await page.locator('#choose-title').waitFor()
  page.on('request', (r) => requests.push(r.url()))
  const violations = () =>
    page.evaluate(
      () => (window as unknown as { __violations: string[] }).__violations,
    )
  return { context, page, errors, requests, violations, policy: policy ?? [] }
}

const fileInput = (page: Page) => page.locator('input[type=file]')

// The file waiting for its card: one with its card folds to a line.
async function pickFileCard(page: Page, name: string) {
  await page
    .locator('fieldset.which')
    .first()
    .getByRole('button', { name, exact: true })
    .click()
}

async function tapCard(page: Page, name: string) {
  await page
    .locator('.quick-cards')
    .getByRole('button', { name, exact: true })
    .click()
}

// A PNG's width and height, from its header.
const pngSize = (bytes: Buffer) =>
  bytes.subarray(1, 4).toString() === 'PNG'
    ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    : null

// Save as image where the browser can't share a file: a download.
async function saveByDownload(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', {
      value: undefined,
      configurable: true,
    })
  })
  const [saved] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as image' }).click(),
  ])
  const file = await saved.path()
  return {
    name: saved.suggestedFilename(),
    bytes: await readFile(file),
  }
}

type Shared = {
  keys: string[]
  files: { name: string; type: string; size: number }[]
}

// Save as image where it can: what reaches the share sheet, which is
// stubbed so no real one opens.
async function saveByShare(page: Page): Promise<Shared | null> {
  await page.evaluate(() => {
    const record = window as unknown as { __shared?: Shared }
    Object.defineProperty(navigator, 'canShare', {
      value: () => true,
      configurable: true,
    })
    Object.defineProperty(navigator, 'share', {
      value: (data: ShareData) => {
        record.__shared = {
          keys: Object.keys(data),
          files: (data.files ?? []).map((f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
          })),
        }
        return Promise.resolve()
      },
      configurable: true,
    })
  })
  await page.getByRole('button', { name: 'Save as image' }).click()
  await page.waitForTimeout(300)
  return page.evaluate(
    () => (window as unknown as { __shared?: Shared }).__shared ?? null,
  )
}

async function privacyChecks(
  browser: Browser,
  label: string,
  origin: string,
  log: Logged[],
) {
  const { context, page, errors, requests, violations, policy } = await open(
    browser,
    origin,
    { width: 390, wallet: true },
  )
  const expected = headerPolicy(
    await readFile(path.join(DIST, 'statement.html'), 'utf8'),
  )
  check(
    `${label}: the page arrives with its own policy as a header`,
    expected.includes("script-src 'sha256-") && policy.includes(expected),
    policy.join(' | '),
  )
  const loaded = Date.now()
  const before = await storage(page)

  // Code run in the page tries to send something; the policy stops it.
  const attempt = await page.evaluate(async () => {
    const seen: string[] = []
    document.addEventListener('securitypolicyviolation', (e) =>
      seen.push(e.effectiveDirective),
    )
    let fetched = 'sent'
    try {
      await fetch('/count', { method: 'POST', body: 'statement-check' })
    } catch {
      fetched = 'blocked'
    }
    navigator.sendBeacon('/count', 'statement-check')
    const image = new Image()
    image.src = '/count?image'
    const script = document.createElement('script')
    script.src = '/count?script'
    document.head.append(script)
    // A script and a style written into the page after it loaded, as an
    // injection would: neither matches a hash the policy names.
    const injected = document.createElement('script')
    injected.textContent = 'document.body.dataset.injected = "ran"'
    document.head.append(injected)
    const style = document.createElement('style')
    style.textContent = 'body { outline: 9px solid red }'
    document.head.append(style)
    await new Promise((r) => setTimeout(r, 500))
    return {
      fetched,
      seen: [...new Set(seen)],
      injectedRan: document.body.dataset.injected === 'ran',
      styled: getComputedStyle(document.body).outlineWidth === '9px',
    }
  })
  check(
    `${label}: fetch('/count') run in the page is refused`,
    attempt.fetched === 'blocked',
  )
  check(
    `${label}: the browser reports its policy stopped a fetch, a beacon, an image and a script`,
    ['connect-src', 'img-src', 'script-src-elem'].every((d) =>
      attempt.seen.includes(d),
    ),
    attempt.seen.join(', '),
  )
  check(
    `${label}: a script added to the page doesn't run, and a style added isn't applied`,
    !attempt.injectedRan &&
      !attempt.styled &&
      attempt.seen.includes('style-src-elem'),
  )
  check(
    `${label}: none of those reached the server`,
    !log.some((l) => l.at >= loaded),
  )

  // Online: two files for two cards, an answer, then Forget.
  requests.length = 0
  await fileInput(page).setInputFiles([csv('activity.csv', AMEX_CSV)])
  await pickFileCard(page, 'Amex Gold')
  await page.locator('#result-title').waitFor({ timeout: 10_000 })
  await fileInput(page).setInputFiles([csv('Chase_Activity.CSV', CHASE_CSV)])
  await pickFileCard(page, 'Chase Sapphire Preferred')
  const byCard = await page
    .locator('table[aria-label="By card used"] tbody tr')
    .count()
  check(`${label}: two files for two cards`, byCard === 2, String(byCard))
  await page.locator('#best-title').waitFor({ timeout: 10_000 })
  check(
    `${label}: with a saved wallet, the best cards follow the best of yours`,
    (await bestRows(page)) === 3 &&
      (await page.locator('#result-title').count()) === 1,
  )
  const canShare = await page.evaluate(
    () =>
      typeof navigator.canShare === 'function' &&
      navigator.canShare({
        files: [new File([''], 'x.png', { type: 'image/png' })],
      }),
  )
  console.log(`     ${label} can share files itself: ${String(canShare)}`)
  const violationsBefore = (await violations()).length
  const saved = await saveByDownload(page)
  const size = pngSize(saved.bytes)
  check(
    `${label}: Save as image downloads a 1080px square PNG`,
    saved.name === 'earnrate-statement-check.png' &&
      size?.width === 1080 &&
      size.height === 1080,
    `${saved.name} ${JSON.stringify(size)}`,
  )
  if (shots) {
    await mkdir(shots, { recursive: true })
    await writeFile(
      path.join(shots, `${prefix}picture-${label.toLowerCase()}.png`),
      saved.bytes,
    )
  }
  const shared = await saveByShare(page)
  check(
    `${label}: where files can be shared, the share sheet gets the PNG alone`,
    shared !== null &&
      shared.keys.join() === 'files' &&
      shared.files.length === 1 &&
      shared.files[0]?.type === 'image/png' &&
      shared.files[0].name === 'earnrate-statement-check.png' &&
      shared.files[0].size > 0,
    JSON.stringify(shared),
  )
  check(
    `${label}: saving the image broke nothing in the page's policy`,
    (await violations()).length === violationsBefore,
    (await violations()).slice(violationsBefore).join(', '),
  )
  await page.getByRole('button', { name: 'Forget this file' }).first().click()
  await page.getByRole('button', { name: 'Forget this file' }).first().click()
  check(
    `${label}: Forget clears both files`,
    (await page.locator('#result-title').count()) === 0 &&
      (await page.locator('fieldset.which').count()) === 0,
  )
  check(
    `${label}: reading files, answering and saving the image made no request`,
    requests.length === 0,
    requests.join(', '),
  )
  check(
    `${label}: the server received nothing after the page loaded`,
    !log.some((l) => l.at >= loaded),
    log
      .filter((l) => l.at >= loaded)
      .map((l) => `${l.method} ${l.url}`)
      .join(', '),
  )
  const after = await storage(page)
  check(
    `${label}: storage is the same before and after`,
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(after).slice(0, 100),
  )
  check(`${label}: no page errors`, errors.length === 0, errors.join(' | '))
  await context.close()

  // Offline: a visitor with no saved wallet turns the network off after the
  // page loads, then checks a file.
  const offline = await open(browser, origin, { width: 390 })
  const empty = await storage(offline.page)
  await offline.context.setOffline(true)
  await fileInput(offline.page).setInputFiles([csv('activity.csv', AMEX_CSV)])
  await pickFileCard(offline.page, 'Amex Platinum')
  await tapCard(offline.page, 'Amex Blue Cash Preferred')
  const answer = offline.page.locator('#result-title')
  await answer.waitFor({ timeout: 10_000 })
  check(
    `${label}: offline, with no saved wallet, an Amex file gets an answer`,
    (await offline.page.locator('table.missed tbody tr').count()) > 0,
  )
  await offline.page.locator('#best-title').waitFor({ timeout: 10_000 })
  check(
    `${label}: offline, the best cards for the file's purchases show, each linked to its page`,
    (await bestRows(offline.page)) === 3 &&
      (
        await offline.page
          .locator('.best-cards .best-name a')
          .evaluateAll((links) => links.map((a) => a.getAttribute('href')))
      ).every((href) => href?.startsWith('/cards/')),
  )
  check(
    `${label}: offline, no request was attempted`,
    offline.requests.length === 0,
    offline.requests.join(', '),
  )
  check(
    `${label}: offline, storage stays empty`,
    JSON.stringify(empty) === JSON.stringify(await storage(offline.page)),
  )
  check(
    `${label}: offline, nothing the page did broke its policy`,
    (await offline.violations()).length === 0,
    (await offline.violations()).join(', '),
  )
  check(
    `${label}: offline, no page errors`,
    offline.errors.length === 0,
    offline.errors.join(' | '),
  )
  await offline.context.close()

  // A best card's name is a link: the policy lets the page navigate to it,
  // which is the visitor leaving, not the page sending anything.
  const leaving = await open(browser, origin, { width: 390 })
  await fileInput(leaving.page).setInputFiles([csv('activity.csv', AMEX_CSV)])
  await pickFileCard(leaving.page, 'Amex Gold')
  const link = leaving.page.locator('.best-cards .best-name a').first()
  await link.waitFor({ timeout: 10_000 })
  const href = (await link.getAttribute('href')) ?? ''
  const violationsBeforeLeaving = (await leaving.violations()).length
  await link.click()
  await leaving.page.waitForURL(`${origin}${href}`, { timeout: 10_000 })
  check(
    `${label}: a best card's link opens its card page`,
    href.startsWith('/cards/') &&
      leaving.page.url() === `${origin}${href}` &&
      violationsBeforeLeaving === 0,
    leaving.page.url(),
  )
  await leaving.context.close()
}

const bestRows = (page: Page) =>
  page.locator('.best-cards ol.best-list').first().locator('li').count()

type State = {
  name: string
  wallet: boolean
  run: (page: Page) => Promise<void>
}

const STATES: State[] = [
  { name: '1-before-a-file', wallet: false, run: async () => {} },
  {
    name: '2-amex-no-saved-wallet',
    wallet: false,
    run: async (page) => {
      await fileInput(page).setInputFiles([csv('activity.csv', AMEX_CSV)])
      await pickFileCard(page, 'Amex Platinum')
      await tapCard(page, 'Amex Blue Cash Preferred')
      await tapCard(page, 'Chase Freedom Unlimited')
      await tapCard(page, 'Citi Double Cash')
      await page.getByRole('button', { name: 'Details' }).first().click()
      await page.locator('details.lines summary').first().click()
      await page.locator('#best-title').waitFor()
    },
  },
  {
    name: '2a-amex-file-card-only',
    wallet: false,
    run: async (page) => {
      await fileInput(page).setInputFiles([csv('activity.csv', AMEX_CSV)])
      await pickFileCard(page, 'Amex Gold')
      await page.locator('#best-title').waitFor()
    },
  },
  {
    name: '3-chase-saved-wallet',
    wallet: true,
    run: async (page) => {
      await fileInput(page).setInputFiles([
        csv('Chase_Activity.CSV', CHASE_CSV),
      ])
      await pickFileCard(page, 'Chase Sapphire Preferred')
      await page.locator('#best-title').waitFor()
    },
  },
  {
    name: '4-two-files-two-cards',
    wallet: true,
    run: async (page) => {
      await fileInput(page).setInputFiles([
        csv('activity.csv', AMEX_CSV),
        csv('Chase_Activity.CSV', CHASE_CSV),
      ])
      await pickFileCard(page, 'Amex Gold')
      await pickFileCard(page, 'Chase Sapphire Preferred')
      await page.locator('#best-title').waitFor()
    },
  },
  {
    name: '5-wrong-file-types',
    wallet: false,
    run: async (page) => {
      await fileInput(page).setInputFiles([
        {
          name: 'Statement.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 synthetic'),
        },
        {
          name: 'activity.xlsx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: Buffer.from('synthetic'),
        },
        csv('other-bank.csv', OTHER_CSV),
      ])
    },
  },
  {
    name: '6-after-forget',
    wallet: false,
    run: async (page) => {
      await fileInput(page).setInputFiles([csv('activity.csv', AMEX_CSV)])
      await pickFileCard(page, 'Amex Platinum')
      await page.getByRole('button', { name: 'Forget this file' }).click()
    },
  },
]

async function screenshots(browser: Browser, origin: string, dir: string) {
  await mkdir(dir, { recursive: true })
  const text: string[] = ['# The statement check, every sentence', '']
  for (const state of STATES)
    for (const width of [390, 1280])
      for (const dark of [false, true]) {
        const { context, page, errors, violations } = await open(
          browser,
          origin,
          {
            width,
            dark,
            wallet: state.wallet,
          },
        )
        await state.run(page)
        await page.waitForTimeout(400)
        // Before the screenshot: Playwright's WebKit screenshot adds a style
        // of its own, which the policy refuses.
        const broken = await violations()
        await page.screenshot({
          path: path.join(
            dir,
            `${prefix}${state.name}-${String(width)}-${dark ? 'dark' : 'light'}.png`,
          ),
          fullPage: true,
        })
        if (width === 390 && state.name >= '2' && state.name < '5')
          await writeFile(
            path.join(
              dir,
              `${prefix}${state.name}-picture-${dark ? 'dark' : 'light'}.png`,
            ),
            (await saveByDownload(page)).bytes,
          )
        const wide = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        )
        check(`${state.name} at ${String(width)}px: no sideways scroll`, !wide)
        check(
          `${state.name}: no page errors`,
          errors.length === 0,
          errors.join(' | '),
        )
        check(
          `${state.name}: nothing on the page broke its policy`,
          broken.length === 0,
          broken.join(', '),
        )
        if (width === 390 && !dark) {
          await page.evaluate(() => {
            for (const d of document.querySelectorAll('details')) d.open = false
          })
          const words = (await page.locator('main').innerText())
            .split(/\s+/)
            .filter((w) => /[A-Za-z0-9$]/.test(w)).length
          await page.evaluate(() => {
            for (const d of document.querySelectorAll('details')) d.open = true
          })
          await page.waitForTimeout(400)
          const body =
            state.name === '1-before-a-file'
              ? await page.locator('main').innerText()
              : await page.locator('#check').innerText()
          text.push(
            `## ${state.name}${state.wallet ? ' (a wallet saved in the browser)' : ' (no saved wallet)'}`,
            '',
            `Words a visitor sees at 390px with every disclosure closed: ${String(words)}.`,
            '',
            state.name === '1-before-a-file'
              ? 'The whole page, before a file is chosen, with every collapsed section opened:'
              : 'The check itself (the part of the page that changes), with every collapsed section opened:',
            '',
            '```text',
            body.trim(),
            '```',
            '',
          )
        }
        await context.close()
      }
  await writeFile(path.join(dir, 'page-text.md'), text.join('\n'))
}

const { chromium, webkit } = await import('playwright')
const { origin, log, server } = await serve()
try {
  for (const [label, type] of [
    ['Chromium', chromium],
    ['WebKit', webkit],
  ] as const) {
    const browser = await type.launch()
    try {
      await privacyChecks(browser, label, origin, log)
      if (shots && label.toLowerCase() === shotsIn)
        await screenshots(browser, origin, shots)
    } finally {
      await browser.close()
    }
  }
} finally {
  server.close()
}
if (failed > 0) {
  console.log(`${String(failed)} check(s) failed`)
  process.exitCode = 1
}
