import { readFile } from 'node:fs/promises'
import { defineConfig, type Plugin } from 'vite'
import { DATA_DIR, loadCatalog, loadWallet } from '../src/data/load.ts'
import { localToday } from '../src/engine/periods.ts'
import { landingFacts, renderLanding } from '../scripts/landing.ts'

const CATALOG = 'virtual:catalog'

// The card data ships inside the bundle, built from data/ at build time, so
// the page never fetches anything about cards or wallets.
function catalogModule(): Plugin {
  return {
    name: 'earnrate-catalog',
    resolveId: (id) => (id === CATALOG ? `\0${CATALOG}` : null),
    async load(id) {
      if (id !== `\0${CATALOG}`) return null
      const [catalog, version] = await Promise.all([
        loadCatalog(),
        readFile(`${DATA_DIR}VERSION`, 'utf8'),
      ])
      return [
        `export const catalog = JSON.parse(${JSON.stringify(JSON.stringify(catalog))})`,
        `export const dataVersion = ${JSON.stringify(version.trim())}`,
      ].join('\n')
    },
  }
}

// The home page's counts, sample cheat sheet and quoted answer come from the
// card data and the example wallet, filled in when the page is built.
function landingPage(): Plugin {
  return {
    name: 'earnrate-landing',
    async transformIndexHtml(html, ctx) {
      if (!ctx.filename.endsWith('/index.html')) return html
      const [catalog, sample] = await Promise.all([
        loadCatalog(),
        loadWallet(`${import.meta.dirname}/../wallet.example.yaml`),
      ])
      return renderLanding(html, landingFacts(catalog, sample, localToday()))
    },
  }
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [catalogModule(), landingPage()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: '../site-dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        index: `${import.meta.dirname}/index.html`,
        privacy: `${import.meta.dirname}/privacy.html`,
        terms: `${import.meta.dirname}/terms.html`,
      },
    },
  },
})
