import { catalog } from 'virtual:catalog'
import { cardArtSvg, cardColor } from '../../src/format/card-art.ts'

// earnrate's drawing of the card, in its color; never the issuer's art.
export function CardArt({ id, width = 40 }: { id: string; width?: number }) {
  return (
    <span
      class="card-art"
      // The SVG is built from card data only.
      dangerouslySetInnerHTML={{
        __html: cardArtSvg(cardColor(catalog, id), width),
      }}
    />
  )
}
