// What earnrate's shareable pictures share: colors, type, the branded
// header and footer, and handing the finished file to the visitor. Drawn in
// the browser so nothing leaves the device. The statement check bundles this
// into its one file, so it may import nothing that stores, sends or loads.
import {
  CARD_CHIP,
  CARD_CHIP_LINES,
  CARD_SHEEN,
  cardArtTones,
} from '../../src/format/card-art.ts'

export const PAD = 72
export const BAND = 280

export type Palette = {
  paper: string
  ink: string
  muted: string
  line: string
  accent: string
  quiet: string
}

export const LIGHT: Palette = {
  paper: '#ffffff',
  ink: '#1d1b19',
  muted: '#625d58',
  line: '#e8e1d9',
  accent: '#9a5020',
  quiet: '#a1978e',
}
export const DARK: Palette = {
  paper: '#1c1a18',
  ink: '#eeebe6',
  muted: '#a8a29c',
  line: '#2e2a27',
  accent: '#e8a877',
  quiet: '#6d655e',
}

export const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

export const prefersDark = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches

export function fit(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
) {
  if (ctx.measureText(text).width <= width) return text
  let out = text
  while (out.length > 1 && ctx.measureText(`${out}…`).width > width)
    out = out.slice(0, -1)
  return `${out.trimEnd()}…`
}

// The text in lines that fit the width, broken between words.
export function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line === '' ? word : `${line} ${word}`
    if (line !== '' && ctx.measureText(next).width > width) {
      lines.push(line)
      line = word
    } else line = next
  }
  return [...lines, line]
}

// The largest size, up to `max` pixels, at which the text fits the width
// in the given weight; sets the context's font to it.
export function sizeToFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  weight: number,
  max: number,
): number {
  let size = max
  ctx.font = `${String(weight)} ${String(size)}px ${FONT}`
  while (size > 12 && ctx.measureText(text).width > width) {
    size -= 2
    ctx.font = `${String(weight)} ${String(size)}px ${FONT}`
  }
  return size
}

// The stacked-cards mark (Logo.tsx), in its 120 × 80 box at (x, y): stroke
// and fill in the current stroke color, the chip in `chip`.
export function drawLogo(
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

export type Picture = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  colors: Palette
}

// A blank picture of width × height on the paper color. `scale` draws the
// same picture smaller, into `canvas` when given, for a preview.
export function newPicture(
  width: number,
  height: number,
  dark: boolean,
  {
    scale = 1,
    canvas = document.createElement('canvas'),
  }: { scale?: number; canvas?: HTMLCanvasElement } = {},
): Picture | null {
  const colors = dark ? DARK : LIGHT
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (scale !== 1) ctx.scale(scale, scale)
  ctx.fillStyle = colors.paper
  ctx.fillRect(0, 0, width, height)
  return { canvas, ctx, width, height, colors }
}

// The accent band across the top: the brand, a title, a line under it and
// the mark on the right.
export function drawHeader(
  { ctx, width, colors }: Picture,
  title: string,
  subtitle: string,
) {
  const { paper, accent } = colors
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, width, BAND)
  ctx.fillStyle = paper
  ctx.font = `700 40px ${FONT}`
  ctx.fillText('earnrate', PAD, 104)
  ctx.font = `700 66px ${FONT}`
  ctx.fillText(fit(ctx, title, width - PAD * 2 - 240), PAD, 192)
  ctx.globalAlpha = 0.82
  ctx.font = `400 30px ${FONT}`
  ctx.fillText(fit(ctx, subtitle, width - PAD * 2), PAD, 240)
  ctx.globalAlpha = 1
  ctx.strokeStyle = paper
  drawLogo(ctx, width - PAD - 205, 52, 1.8, accent)
}

// Small print at the bottom, its last line just above the link; a note too
// long for one line takes two or more.
export function drawFooter(
  { ctx, width, height, colors }: Picture,
  notes: string[],
  link: string,
) {
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = colors.muted
  ctx.font = `400 26px ${FONT}`
  const lines = notes.flatMap((note) => wrap(ctx, note, width - PAD * 2))
  lines.forEach((line, i) => {
    ctx.fillText(
      fit(ctx, line, width - PAD * 2),
      PAD,
      height - 112 - 36 * (lines.length - 1 - i),
    )
  })
  ctx.fillStyle = colors.accent
  ctx.font = `700 32px ${FONT}`
  ctx.fillText(link, PAD, height - 64)
}

export type BarRow = {
  label: string
  amount: string
  value: number
  quiet: boolean
}

// A label with its amount on the right, and a bar under them from zero to
// value / max on the full width.
export function drawBarRow(
  { ctx, width, colors }: Picture,
  row: BarRow,
  max: number,
  y: number,
) {
  const inner = width - PAD * 2
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = colors.ink
  ctx.font = `700 40px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillText(row.amount, width - PAD, y)
  const amountWidth = ctx.measureText(row.amount).width
  ctx.textAlign = 'left'
  ctx.fillStyle = colors.muted
  ctx.font = `500 30px ${FONT}`
  ctx.fillText(fit(ctx, row.label, inner - amountWidth - 24), PAD, y)
  const barY = y + 24
  ctx.fillStyle = colors.line
  ctx.beginPath()
  ctx.roundRect(PAD, barY, inner, 24, 6)
  ctx.fill()
  const filled = max > 0 ? Math.max(0, Math.min(1, row.value / max)) : 0
  if (filled > 0) {
    ctx.fillStyle = row.quiet ? colors.quiet : colors.accent
    ctx.beginPath()
    ctx.roundRect(PAD, barY, Math.max(12, inner * filled), 24, 6)
    ctx.fill()
  }
}

// earnrate's drawing of a card (src/format/card-art.ts), `width` wide.
export function drawCardArt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  color: string,
) {
  const { edge, stripe } = cardArtTones(color)
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(width / 86, width / 86)
  ctx.beginPath()
  ctx.roundRect(0.5, 0.5, 85, 53, 5)
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = edge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.globalAlpha = 0.07
  ctx.fillStyle = '#fff'
  ctx.fill(new Path2D(CARD_SHEEN))
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.roundRect(10, 17, 14, 11, 2)
  ctx.fillStyle = CARD_CHIP
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 0.6
  ctx.stroke()
  ctx.stroke(new Path2D(CARD_CHIP_LINES))
  ctx.globalAlpha = 0.28
  ctx.beginPath()
  ctx.roundRect(10, 40, 30, 3, 1.5)
  ctx.fillStyle = stripe
  ctx.fill()
  ctx.restore()
}

export const pngBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })

// The PNG at once, where awaiting toBlob would let a tap go stale.
export function pngNow(canvas: HTMLCanvasElement): Blob {
  const data = atob(canvas.toDataURL('image/png').split(',')[1] ?? '')
  const bytes = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i)
  return new Blob([bytes], { type: 'image/png' })
}

export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  // Some browsers start the download after click() returns.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 10_000)
}

// To the share sheet where the browser can share a file, so a phone can
// save it to Photos or send it; a download everywhere else. Only the file
// is shared: no link, no text.
export async function savePicture(
  blob: Blob,
  fileName: string,
  { share = false } = {},
): Promise<void> {
  const file = new File([blob], fileName, { type: 'image/png' })
  if (
    share &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  download(blob, fileName)
}
