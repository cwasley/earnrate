// The store card's strip image: the cheat sheet as a table, drawn as SVG at
// 375x144 points and rasterized by the Worker at 1x, 2x and 3x. Wallet
// fields can't align a table or keep long card names whole, so the front's
// rows live here.

export type StripRow = { label: string; card: string; rate: string }

export const STRIP = { width: 375, height: 144 }

const COLORS = {
  background: '#242120',
  rule: 'rgba(255,255,255,0.07)',
  label: '#a8a19a',
  card: '#f5f1ec',
  rate: '#e8a877',
}

const esc = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`)

// Inter semibold averages about half an em, so the card column (about 200pt
// before the rate) holds 26 characters at 15px. Longer names shrink to 12px,
// and anything that still doesn't fit is cut short.
const FITS_AT_15 = 26
const MIN_SIZE = 12
const MAX_AT_MIN = Math.floor((FITS_AT_15 * 15) / MIN_SIZE)

export function cardFit(name: string): { text: string; size: number } {
  if (name.length <= FITS_AT_15) return { text: name, size: 15 }
  if (name.length <= MAX_AT_MIN)
    return { text: name, size: (15 * FITS_AT_15) / name.length }
  return { text: `${name.slice(0, MAX_AT_MIN - 1).trimEnd()}…`, size: MIN_SIZE }
}

export function stripSvg(rows: StripRow[]): string {
  const { width, height } = STRIP
  const pad = 14
  const top = 8
  const rowHeight = (height - top * 2) / Math.max(rows.length, 1)
  const labelX = pad
  const cardX = 122
  const rateX = width - pad
  const lines = rows.map((row, i) => {
    const y = top + rowHeight * i
    const baseline = y + rowHeight / 2 + 5
    const fit = cardFit(row.card)
    const rule =
      i < rows.length - 1
        ? `<line x1="${String(pad)}" x2="${String(width - pad)}" y1="${String(y + rowHeight)}" y2="${String(y + rowHeight)}" stroke="${COLORS.rule}" stroke-width="1"/>`
        : ''
    return [
      `<text x="${String(labelX)}" y="${String(baseline)}" font-family="Inter" font-size="13" font-weight="400" fill="${COLORS.label}">${esc(row.label)}</text>`,
      `<text x="${String(cardX)}" y="${String(baseline)}" font-family="Inter" font-size="${fit.size.toFixed(1)}" font-weight="600" fill="${COLORS.card}">${esc(fit.text)}</text>`,
      `<text x="${String(rateX)}" y="${String(baseline)}" text-anchor="end" font-family="Inter" font-size="15" font-weight="700" fill="${COLORS.rate}">${esc(row.rate)}</text>`,
      rule,
    ].join('')
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}"><rect width="${String(width)}" height="${String(height)}" fill="${COLORS.background}"/>${lines.join('')}</svg>`
}
