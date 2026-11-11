import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { esc } from '../scripts/pages/site.ts'
import {
  statementPolicy,
  withStatementHeaders,
  type PageHashes,
} from './statement-policy.ts'
import { catalogModule, landingPage } from './vite.config.ts'

const sha256 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('base64')

// In document order, each whole, so a tag's name inside a script's text
// isn't taken for another tag.
export function pageHashes(html: string): PageHashes {
  const hashes: PageHashes = { scripts: [], styles: [] }
  for (const m of html.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/g))
    (m[1] === 'script' ? hashes.scripts : hashes.styles).push(
      sha256(m[2] ?? ''),
    )
  return hashes
}

// The statement check is built on its own, after the rest of the site, into
// one HTML file: its script, its styles and its icon are written into the
// page, so once it has loaded it needs nothing more and its policy can
// forbid every request and name the exact script and styles it may run.
// Don't give it a shared chunk, a stylesheet link, a lazy import or a style
// attribute: the policy would block them and the page wouldn't work.
function singleFile(): Plugin {
  let policy = ''
  return {
    name: 'earnrate-single-file',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'pre',
      handler: async (html) =>
        html.replace(
          '<link rel="stylesheet" href="/pages.css" />',
          `<style>${await readFile(`${import.meta.dirname}/public/pages.css`, 'utf8')}</style>`,
        ),
    },
    async generateBundle(_options, bundle) {
      const page = bundle['statement.html']
      if (page?.type !== 'asset') throw new Error('statement.html not built')
      let html = String(page.source)
      const inline = (code: string) =>
        code.replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
      for (const [file, output] of Object.entries(bundle)) {
        if (file === 'statement.html') continue
        const tag = new RegExp(
          `<(script|link)[^>]*(src|href)="/${file.replace(/[.]/g, '\\.')}"[^>]*>(</script>)?`,
        )
        const found = tag.exec(html)
        if (!found) throw new Error(`${file} isn't linked from the page`)
        const text =
          output.type === 'chunk' ? output.code : String(output.source)
        html = html.replace(found[0], () =>
          found[1] === 'script'
            ? `<script type="module">${inline(text)}</script>`
            : `<style>${inline(text)}</style>`,
        )
        Reflect.deleteProperty(bundle, file)
      }
      const icon = await readFile(
        `${import.meta.dirname}/public/favicon.svg`,
        'utf8',
      )
      html = html.replace(
        'href="/favicon.svg?v=2"',
        `href="data:image/svg+xml,${encodeURIComponent(icon.trim())}"`,
      )
      if (/<(script|link)[^>]+(src|href)="\//.test(html))
        throw new Error('statement.html still loads a file')
      if (/\sstyle="/.test(html))
        throw new Error('statement.html has a style attribute')
      // Hashed last: nothing below changes a script or a style.
      const hashes = pageHashes(html)
      policy = statementPolicy(hashes)
      html = html
        .replace('<!--earnrate:statement-policy-->', esc(policy))
        .replace(
          '<meta charset="utf-8" />',
          `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${statementPolicy(hashes, { meta: true })}" />`,
        )
      page.source = html
    },
    async writeBundle(options) {
      const file = path.join(options.dir ?? '', '_headers')
      const headers = await readFile(file, 'utf8').catch(() => '')
      await writeFile(file, withStatementHeaders(headers, policy))
    },
  }
}

export default defineConfig({
  root: import.meta.dirname,
  publicDir: false,
  plugins: [catalogModule(), landingPage(), singleFile()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: '../site-dist',
    emptyOutDir: false,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    rolldownOptions: {
      input: { statement: `${import.meta.dirname}/statement.html` },
    },
  },
})
