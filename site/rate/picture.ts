import {
  drawBarRow,
  drawCardArt,
  drawFooter,
  drawHeader,
  fit,
  FONT,
  newPicture,
  PAD,
  sizeToFit,
  wrap,
} from '../app/picture.ts'
import type { RatePicture } from './picture-text.ts'

export const WIDTH = 1080
// As tall as the report needs, from square to 4:5.
const MIN_HEIGHT = 1080
const MAX_HEIGHT = 1350
export const FILE_NAME = 'earnrate-wallet-report.png'

// Past this many cards, the last place says how many more there are, so
// the comparison and the footer keep their room.
const SHOWN = 6
const ART = 64
const CARD_ROW = 64

export function drawRatePicture(
  text: RatePicture,
  dark: boolean,
  colorOf: (cardId: string) => string,
): HTMLCanvasElement | null {
  const picture = newPicture(WIDTH, MAX_HEIGHT, dark)
  if (!picture) return null
  const { ctx, width, colors } = picture
  const inner = width - PAD * 2
  drawHeader(picture, text.title, text.subtitle)

  const over = text.cards.length > SHOWN
  const shown = over ? text.cards.slice(0, SHOWN - 1) : text.cards
  const places = [
    ...shown,
    ...(over
      ? [
          {
            cardId: null,
            name: `+${String(text.cards.length - shown.length)} more`,
          },
        ]
      : []),
  ]
  const columns = places.length === 1 ? 1 : 2
  const column = (inner - 24 * (columns - 1)) / columns
  ctx.textBaseline = 'middle'
  places.forEach((place, i) => {
    const x = PAD + (i % columns) * (column + 24)
    const top = 324 + Math.floor(i / columns) * CARD_ROW
    if (place.cardId !== null)
      drawCardArt(ctx, x, top, ART, colorOf(place.cardId))
    ctx.fillStyle = place.cardId === null ? colors.muted : colors.ink
    ctx.font = `600 30px ${FONT}`
    const left = place.cardId === null ? 0 : ART + 18
    ctx.fillText(
      fit(ctx, place.name, column - left),
      x + left,
      top + (ART * 54) / 86 / 2,
    )
  })
  ctx.textBaseline = 'alphabetic'
  let y = 324 + Math.ceil(places.length / columns) * CARD_ROW + 100

  ctx.fillStyle = colors.accent
  sizeToFit(ctx, text.figure, inner, 700, 120)
  ctx.fillText(text.figure, PAD, y)
  ctx.fillStyle = colors.muted
  ctx.font = `400 34px ${FONT}`
  for (const line of wrap(ctx, text.per, inner)) {
    y += 48
    ctx.fillText(line, PAD, y)
  }
  if (text.upTo !== null) {
    ctx.fillStyle = colors.ink
    ctx.font = `600 34px ${FONT}`
    y += 12
    for (const line of wrap(ctx, text.upTo, inner)) {
      y += 48
      ctx.fillText(line, PAD, y)
    }
  }

  y += 96
  const max = Math.max(0, ...text.rows.map((r) => r.value))
  for (const row of text.rows) {
    drawBarRow(picture, row, max, y)
    y += 116
  }

  ctx.font = `400 26px ${FONT}`
  const footer = text.notes.flatMap((n) => wrap(ctx, n, inner)).length
  const height = Math.round(
    Math.min(
      MAX_HEIGHT,
      Math.max(MIN_HEIGHT, y - 68 + 90 + 26 + 36 * (footer - 1) + 112),
    ),
  )
  drawFooter({ ...picture, height }, text.notes, text.link)
  if (height === MAX_HEIGHT) return picture.canvas
  const cropped = document.createElement('canvas')
  cropped.width = WIDTH
  cropped.height = height
  cropped.getContext('2d')?.drawImage(picture.canvas, 0, 0)
  return cropped
}
