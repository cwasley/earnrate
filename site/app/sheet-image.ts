import type { CheatSheet } from '../../src/engine/cheat-sheet.ts'

// A branded, shareable picture of a cheat sheet, drawn in the browser so
// nothing leaves the device. Fixed light colors: the image is the same in
// either theme.

const W = 1080
const H = 1350
const PAD = 72
const INK = '#1c1d1f'
const MUTED = '#5f6368'
const LINE = '#e6e2da'
const ACCENT = '#1f6f54'
const PAPER = '#fbfaf7'
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text
  let out = text
  while (out.length > 1 && ctx.measureText(`${out}…`).width > width)
    out = out.slice(0, -1)
  return `${out.trimEnd()}…`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export function cheatSheetImage(
  sheet: CheatSheet,
  cardName: (cardId: string) => string,
  pct: (n: number) => string,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)

  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, W, H)

  // Header band with the wordmark and a card outline like the site's icon.
  ctx.fillStyle = ACCENT
  ctx.fillRect(0, 0, W, 280)
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 40px ${FONT}`
  ctx.fillText('earnrate', PAD, 104)
  ctx.font = `700 66px ${FONT}`
  ctx.fillText('My card cheat sheet', PAD, 192)
  ctx.globalAlpha = 0.82
  ctx.font = `400 30px ${FONT}`
  ctx.fillText(`${sheet.quarter} · the card to use for each purchase`, PAD, 240)
  ctx.globalAlpha = 1
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 4
  roundRect(ctx, W - PAD - 132, 62, 132, 84, 12)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(W - PAD - 132, 82, 132, 12)

  const top = 330
  const bottom = H - 170
  const rowH = Math.min(104, (bottom - top) / Math.max(sheet.rows.length, 1))
  sheet.rows.forEach((row, i) => {
    const y = top + i * rowH
    const mid = y + rowH / 2
    ctx.textBaseline = 'middle'
    ctx.fillStyle = MUTED
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(fit(ctx, row.label, 280), PAD, mid)
    ctx.fillStyle = INK
    ctx.font = `650 34px ${FONT}`
    const name =
      row.cardId === null ? 'None of your cards' : cardName(row.cardId)
    ctx.fillText(fit(ctx, name, 470), PAD + 300, mid)
    if (row.effectiveReturnPct !== null) {
      ctx.fillStyle = ACCENT
      ctx.font = `700 40px ${FONT}`
      ctx.textAlign = 'right'
      ctx.fillText(pct(row.effectiveReturnPct), W - PAD, mid)
      ctx.textAlign = 'left'
    }
    if (i < sheet.rows.length - 1) {
      ctx.fillStyle = LINE
      ctx.fillRect(PAD, y + rowH - 1, W - PAD * 2, 2)
    }
  })

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = MUTED
  ctx.font = `400 26px ${FONT}`
  ctx.fillText(
    "Rates from each issuer's own terms, as of " +
      new Date(`${sheet.date}T12:00:00`).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }) +
      '. No affiliate links.',
    PAD,
    H - 112,
  )
  ctx.fillStyle = ACCENT
  ctx.font = `700 32px ${FONT}`
  ctx.fillText('earnrate.dev', PAD, H - 64)

  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
}
