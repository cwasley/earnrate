import { chromium, type Browser } from 'playwright'
import type { PageLoad, PageSnapshot } from './check.ts'

// Headless Chrome's default user agent is often blocked outright.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const MIN_TEXT = 1500

async function load(
  browser: Browser,
  url: string,
): Promise<{ ok: true; load: PageLoad } | { ok: false; reason: string }> {
  // Some issuers' content security policies block page scripts that read the
  // DOM; bypassCSP and the locator text APIs avoid that.
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    bypassCSP: true,
  })
  const page = await context.newPage()
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    const status = response?.status() ?? 0
    if (status >= 400) return { ok: false, reason: `HTTP ${String(status)}` }
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {
      // Pages with long-polling never go idle; what has rendered is enough.
    })
    const body = page.locator('body')
    const read = async () => ({
      innerText: await body.innerText(),
      // Includes collapsed accordions that innerText skips.
      textContent: (await body.textContent()) ?? '',
    })
    const size = (t: { innerText: string; textContent: string }) =>
      Math.max(t.innerText.length, t.textContent.length)
    let text = await read()
    if (size(text) < MIN_TEXT) {
      await page.waitForTimeout(8_000)
      text = await read()
    }
    if (size(text) < MIN_TEXT) {
      return {
        ok: false,
        reason: `only ${String(size(text))} characters of text (likely blocked)`,
      }
    }
    return { ok: true, load: text }
  } catch (e) {
    return {
      ok: false,
      reason:
        e instanceof Error
          ? (e.message.split('\n')[0] ?? e.message)
          : String(e),
    }
  } finally {
    await context.close()
  }
}

const LOADS_PER_PAGE = 2
// Playwright's own timeouts don't cover every hang (a page can stall inside
// a text read), so each load also gets a hard deadline.
const PAGE_DEADLINE_MS = 120_000

function withDeadline<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | { ok: false; reason: string }> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<{ ok: false; reason: string }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, reason: `no response within ${String(ms / 1000)}s` })
    }, ms)
  })
  return Promise.race([work, deadline]).finally(() => {
    clearTimeout(timer)
  })
}

export async function fetchSnapshots(
  urls: string[],
  onPage: (s: PageSnapshot) => void = () => undefined,
): Promise<Map<string, PageSnapshot>> {
  const browser = await chromium.launch()
  const snapshots = new Map<string, PageSnapshot>()
  try {
    for (const url of urls) {
      const loads: PageLoad[] = []
      let failure: string | null = null
      for (let i = 0; i < LOADS_PER_PAGE && failure === null; i++) {
        const result = await withDeadline(load(browser, url), PAGE_DEADLINE_MS)
        if (result.ok) loads.push(result.load)
        else failure = result.reason
      }
      const s: PageSnapshot =
        failure === null
          ? { url, ok: true, loads }
          : { url, ok: false, reason: failure }
      snapshots.set(url, s)
      onPage(s)
    }
  } finally {
    await browser.close()
  }
  return snapshots
}
