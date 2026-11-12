import {
  drawBarRow,
  drawFooter,
  drawHeader,
  fit,
  FONT,
  newPicture,
  PAD,
  sizeToFit,
} from '../app/picture.ts'
import type { PictureText } from './picture-text.ts'

export const SIZE = 1080
export const FILE_NAME = 'earnrate-statement-check.png'

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
    drawBarRow(picture, row, max, y)
    y += 116
  }

  drawFooter(picture, text.notes, text.link)
  return picture.canvas
}
