import { useEffect, useRef, useState } from 'preact/hooks'
import { prefersDark, pngNow, savePicture } from '../app/picture.ts'
import { drawPicture, FILE_NAME, SIZE } from './picture.ts'
import type { PictureText } from './picture-text.ts'

// The preview's pixels: three times its 44px box, for sharp phone screens.
const THUMB = 132

function useDark() {
  const [dark, setDark] = useState(prefersDark)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const change = () => setDark(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return dark
}

export function SaveImage({ text }: { text: PictureText }) {
  const thumb = useRef<HTMLCanvasElement>(null)
  const dark = useDark()
  const key = JSON.stringify(text)
  useEffect(() => {
    if (thumb.current)
      drawPicture(text, dark, { scale: THUMB / SIZE, canvas: thumb.current })
  }, [key, dark])
  return (
    <div class="row-buttons save-row">
      <button
        type="button"
        class="save-image"
        onClick={() => {
          // Drawn and encoded within the tap: Safari opens the share sheet
          // only while the tap is fresh.
          const canvas = drawPicture(text, prefersDark())
          if (canvas)
            void savePicture(pngNow(canvas), FILE_NAME, { share: true })
        }}
      >
        <canvas
          ref={thumb}
          class="thumb"
          width={THUMB}
          height={THUMB}
          aria-hidden="true"
        />
        Save as image
      </button>
    </div>
  )
}
