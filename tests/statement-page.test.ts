import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { analyzeStatement } from '../src/import/analyze.ts'
import {
  checkWallet,
  cleanSlate,
  MAX_BYTES,
  PACE_MIN_DAYS,
  OTHER_REFUSED,
  PDF_REFUSED,
  readStatement,
  refusal,
  runCheck,
  savedCards,
  TOO_BIG_REFUSED,
  UNKNOWN_FORMAT,
  yearlyPace,
  gainByCard,
  GAIN_CHART_MIN_PURCHASES,
  dateRange,
} from '../site/statement/check.ts'
import preview from '../site/preview-worker.ts'
import {
  FALLBACK_POLICY,
  headerPolicy,
  statementPolicy,
  STATEMENT_PATHS,
  withStatementHeaders,
  type PageHashes,
} from '../site/statement-policy.ts'
import { ROOT } from './helpers.ts'
import { AMEX_CSV, CHASE_CSV, OTHER_CSV } from './statement-fixtures.ts'

const catalog = await loadCatalog()
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

// What the page's code may not contain: any way to send or fetch, any write
// to the browser's storage, and any import that loads later.
const FORBIDDEN: [string, RegExp][] = [
  ['fetch', /\bfetch\s*\(/],
  ['sendBeacon', /sendBeacon/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['WebSocket', /WebSocket/],
  ['EventSource', /EventSource/],
  ['storage write', /\.(setItem|removeItem)\s*\(|localStorage\.clear/],
  ['sessionStorage', /sessionStorage/],
  ['IndexedDB', /indexedDB/],
  ['cookie', /document\.cookie/],
  ['dynamic import', /\bimport\s*\(/],
  ['service worker', /serviceWorker/],
  ['cache storage', /\bcaches\./],
  ['window.open', /\bwindow\.open\s*\(/],
  ['form submit', /\.submit\s*\(/],
]

function moduleGraph(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const visit = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    if (file.endsWith('.css')) return
    const source = readFileSync(file, 'utf8')
    const specifiers = [
      ...source.matchAll(
        /^\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'|^\s*import\s+'([^']+)'/gm,
      ),
    ].map((m) => m[1] ?? m[2] ?? '')
    for (const s of specifiers) {
      if (s.startsWith('.')) visit(path.resolve(path.dirname(file), s))
      else packages.add(s)
    }
  }
  visit(entry)
  return { files: [...files], packages: [...packages] }
}

describe("the statement check's code", () => {
  const graph = moduleGraph(path.join(ROOT, 'site/statement/main.tsx'))
  const rel = graph.files.map((f) => path.relative(ROOT, f))

  test('has nothing in its module graph that sends, stores or loads later', () => {
    expect(rel).toContain('site/statement/Statement.tsx')
    expect(rel).toContain('src/import/analyze.ts')
    const found: string[] = []
    for (const file of graph.files) {
      const source = readFileSync(file, 'utf8')
      for (const [name, pattern] of FORBIDDEN)
        if (pattern.test(source))
          found.push(`${path.relative(ROOT, file)}: ${name}`)
    }
    expect(found).toEqual([])
  })

  test("doesn't import the usage counting, the wallet sync or the app's settings", () => {
    for (const file of [
      'site/app/track.ts',
      'site/app/sync.ts',
      'site/app/Sync.tsx',
      'site/api.ts',
      'site/app/settings.ts',
      'site/app/App.tsx',
      'site/app/main.tsx',
    ])
      expect(rel).not.toContain(file)
    expect(graph.packages.sort()).toEqual([
      'preact',
      'preact/hooks',
      'virtual:catalog',
      'zod',
    ])
  })
})

// Hashed here on its own, not with the build's code, so the test checks it.
function inlineHashes(html: string): PageHashes {
  const hashes: PageHashes = { scripts: [], styles: [] }
  for (const m of html.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/g))
    (m[1] === 'script' ? hashes.scripts : hashes.styles).push(
      createHash('sha256')
        .update(m[2] ?? '', 'utf8')
        .digest('base64'),
    )
  return hashes
}

describe('the built statement check', () => {
  let out = ''
  let html = ''
  let policy = ''

  const build = () =>
    execFileSync(
      path.join(ROOT, 'node_modules/.bin/vite'),
      [
        'build',
        'site',
        '--config',
        'site/statement.config.ts',
        '--outDir',
        out,
        '--logLevel',
        'silent',
      ],
      { cwd: ROOT, stdio: 'pipe' },
    )

  beforeAll(() => {
    out = mkdtempSync(path.join(tmpdir(), 'earnrate-statement-'))
    // As after the rest of the site's build, which copies site/public.
    writeFileSync(
      path.join(out, '_headers'),
      readFileSync(path.join(ROOT, 'site/public/_headers'), 'utf8'),
    )
    build()
    build() // a second build replaces its block rather than adding one
    html = readFileSync(path.join(out, 'statement.html'), 'utf8')
    policy = statementPolicy(inlineHashes(html))
  }, 120_000)

  afterAll(() => {
    rmSync(out, { recursive: true, force: true })
  })

  test('its policy forbids every request and names its one script and its styles', () => {
    const hashes = inlineHashes(html)
    expect(hashes.scripts).toHaveLength(1)
    expect(hashes.styles.length).toBeGreaterThan(0)
    const parts = policy.split('; ')
    expect(parts).toContain("default-src 'none'")
    expect(parts).toContain("connect-src 'none'")
    expect(parts).toContain("form-action 'none'")
    expect(parts).toContain("frame-ancestors 'none'")
    expect(parts).toContain(`script-src 'sha256-${hashes.scripts[0] ?? ''}'`)
    // No source that names a place to load from, earnrate.dev included.
    expect(policy).not.toMatch(/'self'|'unsafe-|https?:|\*|blob:/)
    expect(html).not.toMatch(/\sstyle="/)
  })

  test('the page carries it, less frame-ancestors, and shows it', () => {
    expect(html).toContain(
      `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${statementPolicy(inlineHashes(html), { meta: true })}" />`,
    )
    expect(headerPolicy(html)).toBe(policy)
    expect(html).toContain(`<pre><code>${policy}</code></pre>`)
  })

  test("earnrate.dev's _headers sends it for the page", () => {
    const text = readFileSync(path.join(out, '_headers'), 'utf8')
    const blocks = new Map<string, string[]>()
    let current: string[] = []
    for (const line of text.split('\n')) {
      if (line.startsWith('/')) blocks.set(line.trim(), (current = []))
      else if (line.startsWith('  ')) current.push(line.trim())
    }
    for (const p of STATEMENT_PATHS)
      expect(blocks.get(p), p).toEqual([`Content-Security-Policy: ${policy}`])
    expect(blocks.get('/*')?.[0]).toMatch(/^Content-Security-Policy: /)
    expect(text.match(/statement-check: end/g)).toHaveLength(1)
    // Served from the static files, where _headers applies, not the Worker.
    expect(read('wrangler.jsonc')).toContain(
      '"run_worker_first": ["/count", "/api/*"]',
    )
  })

  test("preview.earnrate.dev's Worker sends it for the page and nowhere else", async () => {
    const env = {
      ASSETS: {
        fetch: () =>
          Promise.resolve(
            new Response(html, { headers: { 'content-type': 'text/html' } }),
          ),
      },
    }
    for (const p of STATEMENT_PATHS) {
      const res = await preview.fetch(
        new Request(`https://preview.earnrate.dev${p}`),
        env,
      )
      expect(res.headers.get('content-security-policy'), p).toBe(policy)
      expect(await res.text()).toBe(html)
    }
    const home = await preview.fetch(
      new Request('https://preview.earnrate.dev/'),
      env,
    )
    expect(home.headers.get('content-security-policy')).toBeNull()
  })

  test('without its own policy the page gets one that runs nothing', () => {
    expect(headerPolicy('<p>page</p>')).toBe(FALLBACK_POLICY)
    expect(withStatementHeaders('', 'x').startsWith('# statement-check')).toBe(
      true,
    )
  })

  test('is one file that loads nothing else', () => {
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toMatch(
      /<link[^>]+rel="(stylesheet|modulepreload|preload|manifest|apple-touch-icon)"/,
    )
    for (const m of html.matchAll(/<link[^>]+href="([^"]*)"/g))
      expect(m[1]).toMatch(/^(data:|https:\/\/earnrate\.dev\/statement$)/)
    expect(html).not.toMatch(/\ssrc="/)
  })

  test('its script contains nothing that sends, stores or loads later', () => {
    const scripts = [
      ...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g),
    ]
    expect(scripts).toHaveLength(1)
    const code = scripts[0]?.[1] ?? ''
    for (const [name, pattern] of FORBIDDEN)
      expect(pattern.test(code), name).toBe(false)
    expect([...code.matchAll(/localStorage\.(\w+)/g)].map((m) => m[1])).toEqual(
      ['getItem'],
    )
  })
})

describe('reading a file', () => {
  test('PDFs and other files are refused before they are opened', () => {
    expect(
      refusal({ name: 'Statement.pdf', type: 'application/pdf', size: 10 }),
    ).toBe(PDF_REFUSED)
    expect(refusal({ name: 'activity.PDF', type: '', size: 10 })).toBe(
      PDF_REFUSED,
    )
    expect(refusal({ name: 'activity.xlsx', type: '', size: 10 })).toBe(
      OTHER_REFUSED,
    )
    expect(
      refusal({ name: 'activity.csv', type: 'text/csv', size: MAX_BYTES + 1 }),
    ).toBe(TOO_BIG_REFUSED)
    expect(refusal({ name: 'Chase_Activity.CSV', type: '', size: 10 })).toBe(
      null,
    )
    expect(PDF_REFUSED).toContain('card number')
  })

  test('an Amex file: the columns read and the ones ignored', () => {
    const file = readStatement(AMEX_CSV)
    if (typeof file === 'string') throw new Error(file)
    expect(file.issuer).toBe('amex')
    expect(file.read).toEqual(['Date', 'Description', 'Amount', 'Category'])
    expect(file.ignored).toEqual([
      'Extended Details',
      'Appears On Your Statement As',
      'Address',
      'City/State',
      'Zip Code',
      'Country',
      'Reference',
    ])
    expect(file.rows).toBe(12)
    expect(file.lines).toHaveLength(10) // less the payment and the fee
    expect(JSON.stringify(file.lines)).not.toMatch(/SAMPLE ST|SAMPLETOWN|00000/)
  })

  test('a Chase file: purchases and returns only', () => {
    const file = readStatement(CHASE_CSV)
    if (typeof file === 'string') throw new Error(file)
    expect(file.issuer).toBe('chase')
    expect(file.read).toEqual([
      'Transaction Date',
      'Description',
      'Category',
      'Type',
      'Amount',
    ])
    expect(file.ignored).toEqual(['Post Date', 'Memo'])
    expect(file.lines.map((l) => l.amount)).toEqual([
      6.45, 73.2, 18.99, 45, 27.8, 38.1, -12, 51.75,
    ])
  })

  test('another bank’s CSV is named as such', () => {
    expect(readStatement(OTHER_CSV)).toBe(UNKNOWN_FORMAT)
  })
})

describe('the check', () => {
  const amex = readStatement(AMEX_CSV)
  const chase = readStatement(CHASE_CSV)
  if (typeof amex === 'string' || typeof chase === 'string')
    throw new Error('fixtures')
  const entries = [
    ...amex.lines.map((line) => ({ cardId: 'amex-platinum', line })),
    ...chase.lines.map((line) => ({
      cardId: 'chase-sapphire-preferred',
      line,
    })),
  ]

  test("is the CLI's analysis of the tapped cards and each file's card", () => {
    const wallet = checkWallet(
      null,
      ['amex-blue-cash-preferred', 'citi-double-cash'],
      ['amex-platinum', 'chase-sapphire-preferred'],
    )
    expect(wallet.cards.map((c) => c.id)).toEqual([
      'amex-blue-cash-preferred',
      'citi-double-cash',
      'amex-platinum',
      'chase-sapphire-preferred',
    ])
    const check = runCheck(catalog, wallet, entries, '2026-11-11')
    expect(check.analysis).toEqual(
      analyzeStatement(catalog, wallet, entries, '2026-11-11'),
    )
    expect(check.analysis.best).toBeGreaterThan(check.analysis.earned)
    expect(check.unknown.map((s) => s.name)).toContain('HARBOR NOODLE BAR')
    expect(
      check.unknown.find((s) => s.name === 'HARBOR NOODLE BAR'),
    ).toMatchObject({ category: 'dining', count: 1, spend: 38.75 })
  })

  test('a saved wallet is used as it is, with a file card it lacks added for the check', () => {
    const saved = savedCards(catalog, {
      valuations: { MR: 2 },
      memberships: [],
      cards: [
        { id: 'amex-gold', cap_usage: {}, activated: [] },
        { id: 'no-such-card', cap_usage: {}, activated: [] },
      ],
    })
    expect(saved?.cards.map((c) => c.id)).toEqual(['amex-gold'])
    const wallet = checkWallet(saved, ['citi-double-cash'], ['amex-platinum'])
    expect(wallet.valuations).toEqual({ MR: 2 })
    expect(wallet.cards.map((c) => c.id)).toEqual([
      'amex-gold',
      'amex-platinum',
    ])
    expect(savedCards(catalog, { cards: [] })).toBeNull()
    expect(savedCards(catalog, null)).toBeNull()
  })

  test('replays from a clean slate: no saved totals or bonus progress', () => {
    const saved = savedCards(catalog, {
      valuations: {},
      memberships: ['costco'],
      cards: [
        {
          id: 'amex-gold',
          checkout_label: 'Gold',
          cap_usage: { 'us-supermarkets': { period: '2026', spent: 24000 } },
          activated: [],
          bonus: { opened: '2026-09-01', spent: 900 },
          milestone_usage: { x: { period: '2026', spent: 100 } },
          credit_usage: { dunkin: { period: '2026-10', used: 7 } },
        },
      ],
    })
    if (!saved) throw new Error('wallet')
    expect(cleanSlate(saved)).toEqual({
      valuations: {},
      memberships: ['costco'],
      cards: [
        {
          id: 'amex-gold',
          checkout_label: 'Gold',
          cap_usage: {},
          activated: [],
        },
      ],
    })
    const amexOnly = entries.filter((e) => e.cardId === 'amex-platinum')
    const gold = amexOnly.map((e) => ({ ...e, cardId: 'amex-gold' }))
    const full = checkWallet(saved, [], ['amex-gold'])
    expect(runCheck(catalog, full, gold, '2026-11-11').analysis).toEqual(
      analyzeStatement(catalog, cleanSlate(full), gold, '2026-11-11'),
    )
  })

  test('a purchase at a store earnrate has not taking the card is counted and listed', () => {
    const wallet = checkWallet(null, ['citi-double-cash'], ['amex-platinum'])
    const { analysis } = runCheck(
      catalog,
      wallet,
      entries.slice(0, 10),
      '2026-11-11',
    )
    expect(analysis.notTaken).toEqual([
      { merchant: 'Costco', cardId: 'amex-platinum', count: 1, spend: 88.4 },
    ])
    expect(analysis.byCard[0]?.purchases).toBe(9)
  })

  test('the yearly pace needs four weeks of purchases', () => {
    const wallet = checkWallet(
      null,
      ['amex-blue-cash-preferred', 'citi-double-cash'],
      ['amex-platinum', 'chase-sapphire-preferred'],
    )
    const amexOnly = runCheck(
      catalog,
      wallet,
      entries.filter((e) => e.cardId === 'amex-platinum'),
      '2026-11-11',
    ).analysis
    expect(amexOnly.from).toBe('2026-10-02')
    expect(amexOnly.to).toBe('2026-10-26')
    expect(yearlyPace(amexOnly)).toBeNull()
    const both = runCheck(catalog, wallet, entries, '2026-11-11').analysis
    const days = 31 // Oct 2 to Nov 1
    expect(days).toBeGreaterThanOrEqual(PACE_MIN_DAYS)
    expect(yearlyPace(both)).toBeCloseTo(
      ((both.best - both.earned) * 365) / days,
      1,
    )
  })

  test('the gain by card to use adds up to the stores where another card wins', () => {
    const wallet = checkWallet(
      null,
      ['amex-blue-cash-preferred', 'citi-double-cash'],
      ['amex-platinum', 'chase-sapphire-preferred'],
    )
    const { analysis } = runCheck(catalog, wallet, entries, '2026-11-11')
    const gains = gainByCard(analysis)
    if (!gains) throw new Error('no chart')
    expect(gains.length).toBeGreaterThanOrEqual(2)
    expect(gains.map((g) => g.gain)).toEqual(
      [...gains.map((g) => g.gain)].sort((a, b) => b - a),
    )
    const total = analysis.missed.reduce((n, m) => n + m.best - m.earned, 0)
    expect(gains.reduce((n, g) => n + g.gain, 0)).toBeCloseTo(total, 1)
  })

  test('the gain chart waits for enough purchases and two cards to switch to', () => {
    const wallet = checkWallet(
      null,
      ['amex-blue-cash-preferred', 'citi-double-cash'],
      ['amex-platinum'],
    )
    const few = runCheck(
      catalog,
      wallet,
      entries.filter((e) => e.cardId === 'amex-platinum').slice(0, 5),
      '2026-11-11',
    ).analysis
    expect(few.purchases).toBeLessThan(GAIN_CHART_MIN_PURCHASES)
    expect(gainByCard(few)).toBeNull()
    const oneCard = checkWallet(
      null,
      ['amex-blue-cash-preferred'],
      ['amex-platinum'],
    )
    const single = runCheck(
      catalog,
      oneCard,
      [...entries, ...entries]
        .filter((e) => e.cardId === 'amex-platinum')
        .map((e, i) => ({
          ...e,
          line: {
            ...e.line,
            description: `${e.line.description} ${String(i)}`,
          },
        })),
      '2026-11-11',
    ).analysis
    expect(single.purchases).toBeGreaterThanOrEqual(GAIN_CHART_MIN_PURCHASES)
    expect(new Set(single.missed.map((m) => m.bestCardId)).size).toBe(1)
    expect(gainByCard(single)).toBeNull()
  })

  test('date ranges name the year once when they share it', () => {
    expect(dateRange('2026-10-02', '2026-11-01')).toBe('Oct 2 – Nov 1, 2026')
    expect(dateRange('2025-12-20', '2026-01-05')).toBe(
      'Dec 20, 2025 – Jan 5, 2026',
    )
    expect(dateRange('2026-10-02', '2026-10-02')).toBe('Oct 2, 2026')
  })
})
