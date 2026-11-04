// After a deploy, tells search engines that use IndexNow (Bing, which ChatGPT
// search and Copilot read, plus Yandex and others) which pages changed: those
// whose sitemap lastmod differs from the last run's. Only public page URLs are
// sent. A failure warns but never fails the deploy.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const HOST = 'earnrate.dev'
// Gitignored: what was last sent from this machine.
const SENT = path.join(ROOT, '.indexnow-sent.json')

const key = (await readdir(path.join(ROOT, 'site/public')))
  .map((f) => /^([0-9a-f]{32})\.txt$/.exec(f)?.[1])
  .find((k) => k !== undefined)
if (!key) throw new Error('No IndexNow key file in site/public')

const sitemap = await readFile(path.join(ROOT, 'site-dist/sitemap.xml'), 'utf8')
const pages = Object.fromEntries(
  [...sitemap.matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map(
    (m) => [m[1] ?? '', m[2] ?? ''],
  ),
)
let sent: Record<string, string> = {}
try {
  sent = JSON.parse(await readFile(SENT, 'utf8')) as Record<string, string>
} catch {
  // first run: send everything
}
const urlList = Object.keys(pages).filter((u) => sent[u] !== pages[u])
if (urlList.length === 0) {
  console.log('IndexNow: no changed pages.')
  process.exit(0)
}
try {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key,
      keyLocation: `https://${HOST}/${key}.txt`,
      urlList,
    }),
  })
  if (res.status !== 200 && res.status !== 202) {
    console.warn(`IndexNow refused the ping: HTTP ${String(res.status)}`)
    process.exit(0)
  }
  await writeFile(SENT, `${JSON.stringify(pages, null, 2)}\n`)
  console.log(`IndexNow: sent ${String(urlList.length)} changed pages.`)
} catch (e) {
  console.warn(`IndexNow ping failed: ${String(e)}`)
}
