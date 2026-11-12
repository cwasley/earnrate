import { catalog } from 'virtual:catalog'
import { cardColor } from '../../src/format/card-art.ts'
import { pngNow, prefersDark, savePicture } from '../app/picture.ts'
import { track } from '../app/track.ts'
import { drawRatePicture, FILE_NAME } from './picture.ts'
import type { RatePicture } from './picture-text.ts'

// Waits for the comparison to be worked out, which the picture shows.
export function SaveImage({ picture }: { picture: RatePicture | null }) {
  return (
    <button
      type="button"
      disabled={picture === null}
      onClick={() => {
        if (picture === null) return
        // Drawn and encoded within the tap: Safari opens the share sheet
        // only while the tap is fresh.
        const canvas = drawRatePicture(picture, prefersDark(), (id) =>
          cardColor(catalog, id),
        )
        if (canvas === null) return
        track('rate-image')
        void savePicture(pngNow(canvas), FILE_NAME, { share: true })
      }}
    >
      Save as image
    </button>
  )
}
