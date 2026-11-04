// 1200 x 630 social preview images for card and store pages, drawn in
// Chromium like scripts/make-images.ts. Each image is cached by a hash of its
// HTML, so a build redraws only the ones whose card, name or rate changed.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { cardArtSvg } from '../../src/format/card-art.ts'
import { esc } from './site.ts'

const ACCENT = '#9a5020'
const PAPER = '#fbf9f6'

export type OgImage = {
  file: string // under site-dist: "og/cards/amex-gold.jpg"
  color: string // the drawn card's
  kicker: string // "Best card at" / "Card"
  name: string
  line: string // the headline rate
}

const html = (img: OgImage) => `
<html><body style="margin:0;width:1200px;height:630px;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1b19">
<div style="display:flex;height:100%;padding:0 80px;align-items:center;gap:64px">
  <div style="flex:1;min-width:0">
    <div style="color:${ACCENT};font-weight:700;font-size:30px;letter-spacing:-0.02em">earnrate</div>
    <div style="font-size:28px;color:#625d58;margin-top:34px">${esc(img.kicker)}</div>
    <div style="font-size:${img.name.length > 28 ? '58' : '70'}px;font-weight:700;line-height:1.05;letter-spacing:-0.035em;margin:8px 0 26px;overflow-wrap:anywhere">${esc(img.name)}</div>
    <div style="font-size:34px;line-height:1.3;color:${ACCENT};font-weight:600;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(img.line)}</div>
  </div>
  <div style="flex:none;filter:drop-shadow(0 10px 24px rgba(0,0,0,.22))">${cardArtSvg(img.color, 380).replace('<svg ', '<svg style="border-radius:22px;display:block" ')}</div>
</div></body></html>`

const exists = async (p: string) => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export async function drawImages(
  root: string,
  out: string,
  images: OgImage[],
): Promise<{ drawn: number; bytes: number }> {
  const cache = path.join(root, 'node_modules/.cache/earnrate-og')
  await mkdir(cache, { recursive: true })
  const jobs = images.map((img) => {
    const page = html(img)
    const hash = createHash('sha256').update(page).digest('hex').slice(0, 20)
    return { img, page, cached: path.join(cache, `${hash}.jpg`) }
  })
  const missing: typeof jobs = []
  for (const j of jobs) if (!(await exists(j.cached))) missing.push(j)
  if (missing.length > 0) {
    const { chromium } = await import('playwright')
    // CHROMIUM_PATH: a Chromium other than the one Playwright installed.
    const executablePath = process.env.CHROMIUM_PATH
    const browser = await chromium.launch(
      executablePath ? { executablePath } : {},
    )
    const tab = await browser.newPage({
      viewport: { width: 1200, height: 630 },
    })
    for (const j of missing) {
      await tab.setContent(j.page)
      await writeFile(
        j.cached,
        await tab.screenshot({ type: 'jpeg', quality: 82 }),
      )
    }
    await browser.close()
  }
  let bytes = 0
  for (const j of jobs) {
    const target = path.join(out, j.img.file)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(j.cached, target)
    bytes += (await stat(target)).size
  }
  return { drawn: missing.length, bytes }
}
