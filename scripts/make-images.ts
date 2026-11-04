// Draws earnrate's icons and social preview image from HTML, so a palette or
// wording change is one command: node scripts/make-images.ts
// (The plugin's icon is left alone while the plugin is in directory review.)
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.join(import.meta.dirname, '..')
const ACCENT = '#9a5020'
const PAPER = '#fbf9f6'

// The three-card mark: a white card in front, outlines behind.
const mark = (outlines: number) => `
<svg viewBox="0 0 120 84" xmlns="http://www.w3.org/2000/svg">
  ${outlines > 1 ? '<rect x="30" y="4" width="82" height="54" rx="9" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="4"/>' : ''}
  <rect x="22" y="12" width="82" height="54" rx="9" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="4"/>
  <rect x="8" y="24" width="84" height="56" rx="9" fill="#fff"/>
  <rect x="19" y="38" width="16" height="12" rx="3" fill="${ACCENT}"/>
</svg>`

const icon = (opts: { inset: number; radius: number; outlines: number }) => `
<html><body style="margin:0">
<div style="width:100vw;height:100vh;background:${ACCENT};border-radius:${String(opts.radius)}%;display:grid;place-items:center">
  <div style="width:${String(100 - opts.inset * 2)}%">${mark(opts.outlines)}</div>
</div></body></html>`

// The Wallet pass's logo: the mark alone, on the pass's dark background.
const passLogo = `
<html><body style="margin:0;background:transparent">
<div style="width:100vw;height:100vh;display:grid;place-items:center">
  <div style="width:100%">${mark(1)}</div>
</div></body></html>`

const og = `
<html><body style="margin:0;width:1200px;height:630px;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1b19">
<div style="display:flex;height:100%;padding:0 80px;align-items:center;gap:56px">
  <div style="flex:1.15">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="width:58px;height:58px;border-radius:14px;background:${ACCENT};display:grid;place-items:center"><div style="width:40px">${mark(1)}</div></div>
      <div style="color:${ACCENT};font-weight:700;font-size:32px;letter-spacing:-0.02em">earnrate</div>
    </div>
    <div style="font-size:72px;font-weight:700;line-height:1.02;letter-spacing:-0.035em;margin:30px 0 26px">Which credit card should I use?</div>
    <div style="font-size:26px;line-height:1.4;color:#625d58">It checks every card it knows, or just yours, and tells you which earns the most.</div>
  </div>
  <div style="flex:0.85;display:flex;flex-direction:column;gap:18px">
    <div style="align-self:flex-end;background:${ACCENT};color:#fff;font-size:27px;line-height:1.35;padding:20px 26px;border-radius:26px 26px 6px 26px">Which card at Trader Joe’s?</div>
    <div style="align-self:flex-start;background:#f5e9df;font-size:27px;line-height:1.35;padding:20px 26px;border-radius:26px 26px 26px 6px"><b style="color:${ACCENT}">Blue Cash Preferred:</b> 6% back at U.S. supermarkets.</div>
  </div>
</div></body></html>`

const outputs: {
  file: string
  size: [number, number]
  html: string
  transparent?: boolean
}[] = [
  {
    file: 'site/public/icon-512.png',
    size: [512, 512],
    html: icon({ inset: 18, radius: 0, outlines: 1 }),
  },
  {
    file: 'site/public/icon-192.png',
    size: [192, 192],
    html: icon({ inset: 18, radius: 0, outlines: 1 }),
  },
  {
    file: 'site/public/apple-touch-icon.png',
    size: [180, 180],
    html: icon({ inset: 18, radius: 0, outlines: 1 }),
  },
  // Maskable icons keep their art inside the middle 80%.
  {
    file: 'site/public/icon-maskable-512.png',
    size: [512, 512],
    html: icon({ inset: 26, radius: 0, outlines: 1 }),
  },
  {
    file: 'mcpb/icon.png',
    size: [512, 512],
    html: icon({ inset: 18, radius: 22, outlines: 2 }),
    transparent: true,
  },
  { file: 'site/public/og.png', size: [1200, 630], html: og },
  // Apple Wallet: icon 29pt and logo up to 160x50pt, at 1x, 2x and 3x.
  ...[1, 2, 3].flatMap((scale) => {
    const suffix = scale === 1 ? '' : `@${String(scale)}x`
    return [
      {
        file: `pass/assets/icon${suffix}.png`,
        size: [29 * scale, 29 * scale] as [number, number],
        html: icon({ inset: 18, radius: 0, outlines: 1 }),
      },
      {
        file: `pass/assets/logo${suffix}.png`,
        size: [50 * scale, 35 * scale] as [number, number],
        html: passLogo,
        transparent: true,
      },
    ]
  }),
]

// favicon.ico: a 48px PNG inside an ICO wrapper, which every browser and
// favicon service reads.
function ico(png: Buffer): Buffer {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header.writeUInt8(48, 6)
  header.writeUInt8(48, 7)
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18)
  return Buffer.concat([header, png])
}

const browser = await chromium.launch()
for (const o of outputs) {
  const page = await browser.newPage({
    viewport: { width: o.size[0], height: o.size[1] },
  })
  await page.setContent(o.html)
  await page.screenshot({
    path: path.join(ROOT, o.file),
    omitBackground: o.transparent === true,
  })
  await page.close()
  console.log(o.file)
}
{
  const page = await browser.newPage({ viewport: { width: 48, height: 48 } })
  await page.setContent(icon({ inset: 14, radius: 0, outlines: 1 }))
  const png = await page.screenshot()
  await writeFile(path.join(ROOT, 'site/public/favicon.ico'), ico(png))
  await page.close()
  console.log('site/public/favicon.ico')
}
await browser.close()
