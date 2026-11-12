import {
  drawFooter,
  drawHeader,
  fit,
  FONT,
  newPicture,
  PAD,
  sizeToFit,
  type Picture,
} from '../app/picture.ts'
import type { PictureText } from './picture-text.ts'

export const SIZE = 1080
export const FILE_NAME = 'earnrate-statement-check.png'

function drawRow(
  { ctx, width, colors }: Picture,
  row: PictureText['rows'][number],
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

// The picture, drawn at `scale` (1 for the saved file, smaller for the
// preview) into `canvas` when given.
export function drawPicture(
  text: PictureText,
  dark: boolean,
  options: { scale?: number; canvas?: HTMLCanvasElement } = {},
): HTMLCanvasElement | null {
  const picture = newPicture(SIZE, SIZE, dark, options)
  if (!picture) return null
  const { ctx, width, colors } = picture
  drawHeader(picture, text.title, text.subtitle)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = colors.accent
  sizeToFit(ctx, text.figure, width - PAD * 2, 700, 132)
  ctx.fillText(text.figure, PAD, 440)
  ctx.fillStyle = colors.muted
  ctx.font = `400 34px ${FONT}`
  ctx.fillText(fit(ctx, text.caption, width - PAD * 2), PAD, 500)
  let y = 590
  if (text.pace !== null) {
    ctx.fillStyle = colors.ink
    ctx.font = `600 36px ${FONT}`
    ctx.fillText(fit(ctx, text.pace, width - PAD * 2), PAD, 560)
    y = 660
  }
  const max = Math.max(...text.rows.map((r) => r.value))
  for (const row of text.rows) {
    drawRow(picture, row, max, y)
    y += 116
  }

  drawFooter(picture, text.notes, text.link)
  return picture.canvas
}
