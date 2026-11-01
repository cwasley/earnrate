import type { CheatSheet } from '../../src/engine/cheat-sheet.ts'
import { longDate } from '../../src/engine/text.ts'

// A branded, shareable picture of a cheat sheet, drawn in the browser so
// nothing leaves the device. Colors match the page in light and dark mode.

const W = 1080
const H = 1350
const PAD = 72
const LIGHT = {
  paper: '#ffffff',
  ink: '#1c1d1f',
  muted: '#5f6368',
  line: '#e6e2da',
  accent: '#1f6f54',
}
const DARK = {
  paper: '#1a1c1f',
  ink: '#ecebe7',
  muted: '#a2a6ab',
  line: '#2b2e32',
  accent: '#7fd1ad',
}
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text
  let out = text
  while (out.length > 1 && ctx.measureText(`${out}…`).width > width)
    out = out.slice(0, -1)
  return `${out.trimEnd()}…`
}

// The stacked-cards mark (Logo.tsx), in its 120 × 80 box at (x, y): stroke
// and fill in the current stroke color, the chip in `chip`.
function drawLogo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  chip: string,
) {
  const box = (bx: number, by: number, w: number, h: number, r: number) => {
    ctx.beginPath()
    ctx.roundRect(
      x + bx * scale,
      y + by * scale,
      w * scale,
      h * scale,
      r * scale,
    )
  }
  ctx.save()
  ctx.lineWidth = 2 * scale
  ctx.globalAlpha = 0.3
  box(22, 6, 92, 58, 9)
  ctx.stroke()
  ctx.globalAlpha = 0.55
  box(14, 12, 92, 58, 9)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = ctx.strokeStyle
  box(6, 18, 92, 58, 9)
  ctx.fill()
  ctx.fillStyle = chip
  box(18, 34, 16, 12, 2)
  ctx.fill()
  ctx.restore()
}

export function cheatSheetImage(
  sheet: CheatSheet,
  cardName: (cardId: string) => string,
  pct: (n: number) => string,
  dark: boolean,
): Promise<Blob | null> {
  const { paper, ink, muted, line, accent } = dark ? DARK : LIGHT
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)

  ctx.fillStyle = paper
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = accent
  ctx.fillRect(0, 0, W, 280)
  ctx.fillStyle = paper
  ctx.font = `700 40px ${FONT}`
  ctx.fillText('earnrate', PAD, 104)
  ctx.font = `700 66px ${FONT}`
  ctx.fillText('My card cheat sheet', PAD, 192)
  ctx.globalAlpha = 0.82
  ctx.font = `400 30px ${FONT}`
  ctx.fillText(`${sheet.quarter} · the card to use for each purchase`, PAD, 240)
  ctx.globalAlpha = 1
  ctx.strokeStyle = paper
  drawLogo(ctx, W - PAD - 205, 52, 1.8, accent)

  const top = 330
  const bottom = H - 190
  const rowH = Math.min(104, (bottom - top) / Math.max(sheet.rows.length, 1))
  sheet.rows.forEach((row, i) => {
    const y = top + i * rowH
    const mid = y + rowH / 2
    ctx.textBaseline = 'middle'
    ctx.fillStyle = muted
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(fit(ctx, row.label, 280), PAD, mid)
    ctx.fillStyle = ink
    ctx.font = `650 34px ${FONT}`
    const name =
      row.cardId === null ? 'None of your cards' : cardName(row.cardId)
    ctx.fillText(fit(ctx, name, 470), PAD + 300, mid)
    if (row.effectiveReturnPct !== null) {
      ctx.fillStyle = accent
      ctx.font = `700 40px ${FONT}`
      ctx.textAlign = 'right'
      ctx.fillText(pct(row.effectiveReturnPct), W - PAD, mid)
      ctx.textAlign = 'left'
    }
    if (i < sheet.rows.length - 1) {
      ctx.fillStyle = line
      ctx.fillRect(PAD, y + rowH - 1, W - PAD * 2, 2)
    }
  })

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = muted
  ctx.font = `400 26px ${FONT}`
  const asOf = longDate(sheet.date)
  ctx.fillText(
    `Rates from each issuer's own terms, as of ${asOf}.`,
    PAD,
    H - 148,
  )
  ctx.fillText('No affiliate links.', PAD, H - 112)
  ctx.fillStyle = accent
  ctx.font = `700 32px ${FONT}`
  ctx.fillText('earnrate.dev', PAD, H - 64)

  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
}
