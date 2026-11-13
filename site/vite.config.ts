import { readFile } from 'node:fs/promises'
import { defineConfig, type Plugin } from 'vite'
import {
  DATA_DIR,
  loadCatalog,
  loadChanges,
  loadWallet,
} from '../src/data/load.ts'
import { localToday } from '../src/engine/periods.ts'
import { landingFacts, renderLanding } from '../scripts/landing.ts'
import { companyParts } from '../scripts/pages/changes.ts'
import { PAGE_HEADER, siteFooter } from '../scripts/pages/site.ts'

const CATALOG = 'virtual:catalog'

// The card data ships inside the bundle, built from data/ at build time, so
// the page never fetches anything about cards or wallets.
export function catalogModule(): Plugin {
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

const FILLED = ['/index.html', '/companies.html']

// Every page's shared footer (renderLanding fills it too, for the pages it
// fills). The home page's counts, sample cheat sheet and quoted answer, and the
// companies page's counts and recent changes, come from the card data, the
// change record and the example wallet, filled in when the page is built.
export function landingPage(): Plugin {
  return {
    name: 'earnrate-landing',
    async transformIndexHtml(source, ctx) {
      const html = source
        .replace('<!--earnrate:footer-->', siteFooter())
        .replace('<!--earnrate:header-->', PAGE_HEADER)
      if (!FILLED.some((f) => ctx.filename.endsWith(f))) return html
      const [catalog, sample, releases, version] = await Promise.all([
        loadCatalog(),
        loadWallet(`${import.meta.dirname}/../wallet.example.yaml`),
        loadChanges(),
        readFile(`${DATA_DIR}VERSION`, 'utf8'),
      ])
      return renderLanding(
        html,
        landingFacts(catalog, sample, localToday()),
        ctx.filename.endsWith('/companies.html')
          ? companyParts(catalog, releases)
          : { data_version: version.trim() },
      )
    },
  }
}

// /rate shares the home page's chunks (the card data, the engine, Preact).
// Find a card and /rate's report work out their answers in workers, which
// get the card data from the page rather than a second copy of it.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [catalogModule(), landingPage()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  worker: { format: 'es' },
  build: {
    outDir: '../site-dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        index: `${import.meta.dirname}/index.html`,
        rate: `${import.meta.dirname}/rate.html`,
        sheet: `${import.meta.dirname}/sheet.html`,
        privacy: `${import.meta.dirname}/privacy.html`,
        terms: `${import.meta.dirname}/terms.html`,
        companies: `${import.meta.dirname}/companies.html`,
        support: `${import.meta.dirname}/support.html`,
      },
    },
  },
})
