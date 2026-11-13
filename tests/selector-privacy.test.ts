import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { ROOT } from './helpers.ts'

// Cloudflare's analytics script sends the id and class path of the element
// behind the slowest interaction and the biggest layout shift. Ids and
// classes that the app or a page's wallet script makes must therefore never
// carry a card, a pick or anything the visitor typed; that goes in data-*.
// yarn site:check-selectors checks the rendered pages in real browsers.

const sources = (dir: string, ext: RegExp) =>
  readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => ext.test(f))
    .map((f) => ({
      file: `${dir}/${f}`,
      text: readFileSync(path.join(ROOT, dir, f), 'utf8'),
    }))

// Ids made from a value, in a lowercase (DOM) element's attributes. Only a
// row's position may go in one.
const ALLOWED_IDS = [/^`[a-z-]+-\$\{String\(i\)\}`$/]

describe('ids and classes say nothing about the visitor', () => {
  test("the app's elements get no id made from a card or anything else the visitor has", () => {
    const bad: string[] = []
    for (const { file, text } of [
      ...sources('site/app', /\.tsx$/),
      ...sources('site/rate', /\.tsx$/),
      ...sources('site/sheet', /\.tsx$/),
    ])
      for (const m of text.matchAll(
        /<([a-z][a-z0-9]*)\b[^<]*?\sid=\{(`[^`]*`|[^}]*)\}/g,
      )) {
        const value = (m[2] ?? '').trim()
        if (!ALLOWED_IDS.some((a) => a.test(value)))
          bad.push(`${file}: <${m[1] ?? ''} id={${value}}>`)
      }
    expect(bad).toEqual([])
  })

  test("the app's classes are fixed words, never a card or a value", () => {
    const bad: string[] = []
    for (const { file, text } of [
      ...sources('site/app', /\.tsx$/),
      ...sources('site/rate', /\.tsx$/),
      ...sources('site/sheet', /\.tsx$/),
    ])
      for (const m of text.matchAll(/\sclass(?:Name)?=\{(`[^`]*`|[^}]*)\}/g))
        if (/\.id\b|cardId|held|\$\{(?![a-z.]*\s*\?)/i.test(m[1] ?? ''))
          bad.push(`${file}: class={${m[1] ?? ''}}`)
    expect(bad).toEqual([])
  })

  test('in Rate my wallet and My wallet, no class switches on what the visitor holds or answered', () => {
    // Each switches on the page's own state, never on the wallet.
    const allowed = new Set([
      "quiet ? 'rate-bar quiet' : 'rate-bar'", // the first row is always yours
      "`${shown.error ? 'callout' : 'muted'} message-line`", // a refused change
      "settled ? 'credit-picks settled' : 'credit-picks'", // after first paint
      "rank === 1 ? 'result hero' : 'result'", // a ranking's first row
    ])
    const bad: string[] = []
    for (const { file, text } of [
      ...sources('site/rate', /\.tsx$/),
      ...sources(
        'site/app',
        /^(MyWallet|CreditPicks|CardSettings|NewCard|WalletAnswer|QuickCards)\.tsx$/,
      ),
    ])
      for (const m of text.matchAll(/\sclass(?:Name)?=\{(`[^`]*`|[^}]*)\}/g)) {
        const value = (m[1] ?? '').replace(/\s+/g, ' ').trim()
        if (/\?|&&|\|\|/.test(value) && !allowed.has(value))
          bad.push(`${file}: class={${value}}`)
      }
    expect(bad).toEqual([])
  })

  test('the add-card grid draws every tile with the same elements and classes', () => {
    // An element only a held tile draws puts its class in that tile's path.
    const text = readFileSync(
      path.join(ROOT, 'site/app/QuickCards.tsx'),
      'utf8',
    )
    const body = text.slice(text.indexOf('export function QuickCards'))
    expect(body).not.toMatch(/(\?|&&|\|\||:)\s*(\(\s*)?<[A-Za-z]/)
    expect(body).not.toMatch(/\?\s*\(\s*$/m)
  })

  test("the static pages' browser scripts mark a held card with data-*, not an id or class", () => {
    const bad: string[] = []
    for (const { file, text } of sources('scripts/pages', /\.ts$/))
      for (const m of text.matchAll(/const [A-Z_]+_SCRIPT = `([\s\S]*?)`\n/g)) {
        const script = m[1] ?? ''
        if (
          /classList|className|\.id\s*=|setAttribute\(\s*['"](id|class)/.test(
            script,
          )
        )
          bad.push(file)
      }
    expect(bad).toEqual([])
  })
})
