// Rasterizes the strip with resvg (WebAssembly), using only the bundled
// Inter fonts so the result is the same in the Worker and in tests.
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import type { RenderPng } from './app.ts'

export function makeRenderer(
  wasm: WebAssembly.Module | ArrayBuffer | Uint8Array,
  fonts: Uint8Array[],
): RenderPng {
  let ready: Promise<void> | null = null
  return async (svg, width) => {
    ready ??= initWasm(wasm)
    await ready
    const image = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      font: {
        fontBuffers: fonts,
        loadSystemFonts: false,
        defaultFontFamily: 'Inter',
      },
    })
    return image.render().asPng()
  }
}
