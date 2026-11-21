import type { CheatSheet } from '../../src/engine/cheat-sheet.ts'
import {
  drawFooter,
  drawHeader,
  fit,
  FONT,
  newPicture,
  PAD,
  pngBlob,
} from './picture.ts'
import {
  NO_CARD_OF_YOURS,
  SHEET_PICTURE_SITE,
  SHEET_PICTURE_TITLE,
  sheetPictureFooter,
  sheetPictureSubtitle,
} from './sheet-picture-text.ts'

const W = 1080
const H = 1350

// A branded, shareable picture of a cheat sheet, in the page's light or dark
// colors.
export function cheatSheetImage(
  sheet: CheatSheet,
  cardName: (cardId: string) => string,
  pct: (n: number) => string,
  dark: boolean,
): Promise<Blob | null> {
  const picture = newPicture(W, H, dark)
  if (!picture) return Promise.resolve(null)
  const { ctx } = picture
  const { ink, muted, line, accent } = picture.colors

  drawHeader(picture, SHEET_PICTURE_TITLE, sheetPictureSubtitle(sheet.quarter))

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
    const name = row.cardId === null ? NO_CARD_OF_YOURS : cardName(row.cardId)
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

  drawFooter(picture, sheetPictureFooter(sheet.date), SHEET_PICTURE_SITE)
  return pngBlob(picture.canvas)
}
