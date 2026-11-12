// earnrate's drawing of a card: a plain card in its color with a chip. Not
// the issuer's card art, which isn't earnrate's to show. An SVG string, so
// the site and the static pages draw the same card.
import type { Catalog } from '../schema/catalog.ts'

const FALLBACK = '#5c5650'

export function cardColor(catalog: Catalog, cardId: string): string {
  const card = catalog.cards.find((c) => c.id === cardId)
  if (card?.color) return card.color
  return catalog.issuers.find((i) => i.id === card?.issuer)?.color ?? FALLBACK
}

// Relative luminance, to keep the chip and edge visible on light cards.
function light(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35
}

// The drawing's parts in its 86 x 54 box (a card's 85.6 x 54 mm), shared
// with the canvas pictures (site/app/picture.ts).
export const CARD_SHEEN =
  'M0 40 L56 0 H80 Q85.5 0 85.5 5 V8 L20 54 H5 Q0 54 0 49 Z'
export const CARD_CHIP_LINES = 'M10 22.5 H24 M17 17 V28'
export const CARD_CHIP = '#d9c08a'

export const cardArtTones = (color: string) => ({
  edge: light(color) ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.14)',
  stripe: light(color) ? '#000' : '#fff',
})

// `width` scales it.
export function cardArtSvg(color: string, width = 48): string {
  const height = Math.round((width * 54) / 86)
  const { edge, stripe } = cardArtTones(color)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 86 54" width="${String(width)}" height="${String(height)}" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="85" height="53" rx="5" fill="${color}" stroke="${edge}"/><path d="${CARD_SHEEN}" fill="#fff" opacity="0.07"/><rect x="10" y="17" width="14" height="11" rx="2" fill="${CARD_CHIP}" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/><path d="${CARD_CHIP_LINES}" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/><rect x="10" y="40" width="30" height="3" rx="1.5" fill="${stripe}" opacity="0.28"/></svg>`
}
