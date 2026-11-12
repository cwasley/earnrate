import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadCatalog, loadWallet } from '../src/data/load.ts'
import { cheatSheet } from '../src/engine/cheat-sheet.ts'
import type { Wallet } from '../src/schema/wallet.ts'
import {
  decodeSheet,
  encodeSheet,
  ranOut,
  sendable,
  sheetPart,
} from '../site/sheet/link.ts'
import { shortCode } from '../site/rate/link.ts'
import { EXAMPLE_WALLET, ROOT } from './helpers.ts'

const catalog = await loadCatalog()
const example = await loadWallet(EXAMPLE_WALLET)
const TODAY = '2026-11-12'

const holding = (id: string, more: Partial<Wallet['cards'][number]> = {}) => ({
  id,
  cap_usage: {},
  activated: [],
  ...more,
})

const COUPLE: Wallet = {
  valuations: { UR: 1.7 },
  memberships: ['amazon-prime', 'costco'],
  cards: [
    holding('chase-freedom-flex', {
      activated: ['q4-2026-grocery', 'q4-2026-dining', 'q3-2026-gas'],
      checkout_label: 'Blue Chase',
      cap_usage: {
        'five-percent-quarterly': { period: '2026-Q4', spent: 900 },
      },
    }),
    holding('usbank-cash-plus', {
      chosen: {
        period: '2026-Q4',
        picks: {
          'five-percent': ['tv-internet-streaming', 'movie-theaters'],
          'two-percent': ['gas-ev-charging'],
        },
      },
    }),
    holding('chase-prime-visa'),
    holding('chase-sapphire-preferred', {
      bonus: { opened: '2026-10-01', spent: 1200 },
    }),
    holding('citi-double-cash'),
  ],
}

const rows = (wallet: Wallet, date = TODAY) =>
  cheatSheet(catalog, wallet, date).rows.map((r) => [
    r.label,
    r.cardId,
    r.effectiveReturnPct,
  ])

const open = (wallet: Wallet, date = TODAY) => {
  const decoded = decodeSheet(catalog, `#${encodeSheet(catalog, wallet, date)}`)
  if (!decoded.ok) throw new Error(decoded.message)
  return decoded.link
}

describe('a sent cheat sheet', () => {
  test('opens to the same sheet on another phone', () => {
    const link = open(COUPLE)
    expect(link.made).toBe(TODAY)
    expect(rows(link.wallet)).toEqual(
      rows({
        ...COUPLE,
        cards: COUPLE.cards.map((c) => ({ ...c, cap_usage: {} })),
      }),
    )
    expect(rows(open(example).wallet)).toEqual(
      rows({
        ...example,
        cards: example.cards.map((c) => ({ ...c, cap_usage: {} })),
      }),
    )
  })

  test('carries picks, live activations and only the memberships and point values that change the sheet', () => {
    const { wallet } = open(COUPLE)
    expect(wallet.memberships).toEqual(['amazon-prime'])
    expect(wallet.valuations).toEqual({ UR: 1.7 })
    const flex = wallet.cards.find((c) => c.id === 'chase-freedom-flex')
    expect(flex?.activated).toEqual(['q4-2026-grocery', 'q4-2026-dining'])
    expect(
      wallet.cards.find((c) => c.id === 'usbank-cash-plus')?.chosen,
    ).toEqual({
      period: '2026-Q4',
      picks: {
        'five-percent': ['tv-internet-streaming', 'movie-theaters'],
        'two-percent': ['gas-ev-charging'],
      },
    })
  })

  test('holds no labels, totals, bonuses or anything else from the wallet', () => {
    const text = encodeSheet(catalog, COUPLE, TODAY)
    expect(text).toMatch(
      /^s=1\/2026-11-12\/[0-9a-z]{4}(\.[pa][0-9a-z]{4})*(,[0-9a-z]{4}(\.[pa][0-9a-z]{4})*)*\/[0-9a-z]{4}\/[0-9a-z]{4}:1\.7$/,
    )
    expect(text).not.toMatch(/Blue|900|1200|chase|amex|UR/)
    for (const held of open(COUPLE).wallet.cards)
      expect(Object.keys(held).sort()).toEqual(
        held.chosen
          ? ['activated', 'cap_usage', 'chosen', 'id']
          : ['activated', 'cap_usage', 'id'],
      )
  })

  test("leaves out picks from an earlier period, and says when a link's picks have run out", () => {
    const stale: Wallet = {
      ...COUPLE,
      cards: COUPLE.cards.map((c) =>
        c.chosen ? { ...c, chosen: { ...c.chosen, period: '2026-Q3' } } : c,
      ),
    }
    expect(
      open(stale).wallet.cards.find((c) => c.id === 'usbank-cash-plus')?.chosen,
    ).toBeUndefined()

    const fromQ3 = open(
      {
        ...COUPLE,
        cards: [
          holding('usbank-cash-plus', {
            chosen: {
              period: '2026-Q3',
              picks: { 'five-percent': ['movie-theaters'] },
            },
          }),
        ],
      },
      '2026-09-20',
    )
    expect(ranOut(catalog, fromQ3, '2026-09-30')).toBe(false)
    expect(ranOut(catalog, fromQ3, TODAY)).toBe(true)
    expect(ranOut(catalog, open(COUPLE), TODAY)).toBe(false)
    expect(ranOut(catalog, open(COUPLE), '2027-01-02')).toBe(true)
  })

  test('is offered only for cards earnrate knows, and not past the most a link holds', () => {
    expect(sendable(catalog, COUPLE)).toBe(true)
    expect(sendable(catalog, { ...COUPLE, cards: [holding('no-such')] })).toBe(
      false,
    )
    expect(sendable(catalog, { ...COUPLE, cards: [] })).toBe(false)
    const many = catalog.cards.slice(0, 31).map((c) => holding(c.id))
    expect(sendable(catalog, { ...COUPLE, cards: many })).toBe(false)
  })

  test('refuses links it cannot read, saying why, and never throws', () => {
    const good = encodeSheet(catalog, COUPLE, TODAY)
    const [, , cards = ''] = good.slice(2).split('/')
    const card = shortCode('card', 'citi-double-cash')
    const refused = (fragment: string) => {
      const d = decodeSheet(catalog, fragment)
      return d.ok ? null : d.message
    }
    expect(refused(`#${good}`)).toBeNull()
    expect(refused('#s=2/2026-11-12/abcd')).toMatch(/newer version/)
    for (const bad of [
      '',
      '#w=1/abcd',
      '#s=1',
      '#s=1/2026-11-12',
      '#s=0/2026-11-12/abcd',
      `#s=1/2026-02-30/${card}`,
      `#s=1/yesterday/${card}`,
      `#s=1/2026-11-12/${card},${card}`,
      `#s=1/2026-11-12/${card}.q0000`,
      `#s=1/2026-11-12/${card}/////`,
      `#s=1/2026-11-12/${cards}/x`,
    ])
      expect(refused(bad), bad).toMatch(/damaged/)
    expect(refused('#s=1/2026-11-12/zzzz')).toMatch(/doesn't list/)
    expect(refused(`#s=1/2026-11-12/${card}.p0000`)).toMatch(/doesn't list/)
    expect(refused(`#s=1/2026-11-12/${card}.a0000`)).toMatch(/doesn't list/)
    const plus = shortCode('card', 'usbank-cash-plus')
    const two = ['gas-ev-charging', 'grocery-stores'].map(
      (o) => `p${shortCode('option', `two-percent/${o}`)}`,
    )
    expect(refused(`#s=1/2026-11-12/${plus}.${two.join('.')}`)).toMatch(
      /damaged/,
    )

    let seed = 7
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const alphabet = 'abcdz0129.,/:-%pa'
    for (let i = 0; i < 2000; i++) {
      const text = Array.from(
        { length: Math.floor(random() * 50) },
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join('')
      expect(() => decodeSheet(catalog, `s=1/2026-11-12/${text}`)).not.toThrow()
    }
  })

  test('is found among other parts of the address', () => {
    expect(sheetPart('#s=1/2026-11-12/abcd')).toBe('1/2026-11-12/abcd')
    expect(sheetPart('#x&s=1/a')).toBe('1/a')
    expect(sheetPart('#w=1/abcd')).toBeNull()
  })

  test("the page reads only its address: nothing it runs touches the visitor's storage or the network, beyond the event counter", () => {
    const dir = path.join(ROOT, 'site/sheet')
    expect(readdirSync(dir)).toContain('Sheet.tsx')
    const seen = new Set<string>()
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const source = readFileSync(file, 'utf8')
      for (const m of source.matchAll(
        /(?:from|import)\s+'(\.{1,2}\/[^']+\.tsx?)'/g,
      ))
        walk(path.resolve(path.dirname(file), m[1] ?? ''))
    }
    walk(path.join(dir, 'main.tsx'))
    const reached = [...seen].map((f) => path.relative(ROOT, f))
    expect(reached).toContain('site/sheet/Sheet.tsx')
    expect(reached).toContain('site/app/track.ts')
    for (const f of reached) {
      const source = readFileSync(path.join(ROOT, f), 'utf8')
      expect(source, f).not.toMatch(
        /localStorage|sessionStorage|indexedDB|document\.cookie|XMLHttpRequest|WebSocket|\bfetch\s*\(/,
      )
      if (f !== 'site/app/track.ts') expect(source, f).not.toMatch(/sendBeacon/)
    }
  })
})
