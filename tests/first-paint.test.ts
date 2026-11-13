import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, test } from 'vitest'
import { TABS, tabFor } from '../site/tabs.ts'
import { ROOT } from './helpers.ts'

const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const words = (text: string) => text.replace(/\s+/g, ' ').trim()

// The inline scripts a page runs before its first paint.
const inlineScripts = (html: string) =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')

type Run = { dataset: Record<string, string>; read: string[] }

// Runs a first-paint script against a stand-in page: the element it sits
// in, the address and what's saved in this browser.
function run(
  script: string,
  place: { pathname?: string; hash: string },
  saved: string | null,
): Run {
  const dataset: Record<string, string> = {}
  const read: string[] = []
  const h1 = { textContent: '' }
  const element = {
    dataset,
    querySelector: () => h1,
    parentElement: { dataset },
  }
  const storage = {
    getItem: (key: string) => {
      read.push(key)
      return saved
    },
    setItem: () => {
      throw new Error('a first-paint script wrote to storage')
    },
    removeItem: () => {
      throw new Error('a first-paint script wrote to storage')
    },
  }
  runInNewContext(script, {
    document: { currentScript: { parentElement: element } },
    location: { pathname: '/', ...place },
    localStorage: storage,
    addEventListener: () => undefined,
    URLSearchParams,
  })
  return { dataset, read }
}

const WALLET = JSON.stringify({ cards: [{ id: 'amex-gold' }] })
const EMPTY = JSON.stringify({ cards: [], memberships: ['amazon-prime'] })

describe("the home page's first paint", () => {
  const html = read('site/index.html')
  const [script = ''] = inlineScripts(html)

  test.each([
    '',
    '#',
    '#best',
    '#best=costco',
    '#wallet',
    '#wallet=costco',
    '#wallet&add=amex-gold',
    '#wallet&sync=on',
    '#wallet&card=amex-platinum',
    '#spending',
    '#spending&card=amex-gold',
    '#whatif',
    '#claude',
  ])('opens the tab the app opens for %j', (hash) => {
    for (const saved of [WALLET, EMPTY, null, 'not json']) {
      const holds = saved === WALLET
      const { dataset } = run(script, { hash }, saved)
      expect(dataset.tab, `${hash} ${String(saved)}`).toBe(tabFor(hash, holds))
      expect('saved' in dataset).toBe(holds)
      expect('loading' in dataset).toBe(true)
    }
  })

  test('only reads the saved wallet', () => {
    expect(run(script, { hash: '' }, WALLET).read).toEqual(['earnrate:wallet'])
  })

  test("the outline's tabs are the app's", () => {
    const names = [
      ...html.matchAll(/<span data-frame-tab="([a-z]+)">([^<]+)<\/span>/g),
    ].map((m) => [m[1], m[2]])
    expect(names).toEqual(TABS.map((t) => [t.id, t.name]))
  })

  test('the headline shows with saved cards too', () => {
    const css = read('site/app/app.css')
    expect(css).not.toMatch(/header\.hero > (h1|\.lede)/)
    expect(read('site/app/main.tsx')).not.toContain('data-returning')
  })
})

describe("/rate's first paint", () => {
  const [script = ''] = inlineScripts(read('site/rate.html'))

  test('picks the outline from the address and the saved wallet', () => {
    expect(run(script, { hash: '' }, WALLET).dataset.rate).toBe('own')
    expect(run(script, { hash: '' }, EMPTY).dataset.rate).toBe('pick')
    expect(run(script, { hash: '' }, null).dataset.rate).toBe('pick')
  })

  test("a shared report doesn't read this browser's storage", () => {
    for (const place of [
      { pathname: '/r/abcd2345', hash: '' },
      { hash: '#w=1/abc' },
      { hash: '#x&w=1/abc' },
    ]) {
      const { dataset, read } = run(script, place, WALLET)
      expect(dataset.rate).toBe('shared')
      expect(read).toEqual([])
    }
  })
})

describe("/sheet's first paint", () => {
  const [script = ''] = inlineScripts(read('site/sheet.html'))

  test('shows the outline only for a sent sheet, reading nothing', () => {
    const sent = run(script, { hash: '#s=1/abc' }, WALLET)
    expect('loading' in sent.dataset).toBe(true)
    expect(sent.read).toEqual([])
    expect('loading' in run(script, { hash: '' }, WALLET).dataset).toBe(false)
  })
})

test("/statement's first panel matches the one its script draws", () => {
  const html = read('site/statement.html')
  const frame = /<div class="check check-frame"[\s\S]*?<\/section>/.exec(
    html,
  )?.[0]
  expect(frame).toBeDefined()
  const source = words(read('site/statement/Statement.tsx'))
  const texts = [...(frame ?? '').matchAll(/>([^<>]+)</g)]
    .map((m) => words(m[1] ?? ''))
    .filter((t) => t !== '')
  expect(texts.length).toBeGreaterThan(4)
  for (const text of texts) expect(source).toContain(text)
  expect(inlineScripts(html)).toEqual([])
})
