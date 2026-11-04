import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import bundle from 'earnrate:pass-bundle'
import type { Catalog } from '../../src/schema/catalog.ts'
import { makePassWorker } from './app.ts'
import { makeRenderer } from './render.ts'

const { catalog, images, fonts } = bundle as {
  catalog: Catalog
  images: Record<string, string> // base64
  fonts: string[] // base64 TTFs
}

const bytes = (b64: string) =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

export default makePassWorker({
  catalog,
  images: Object.fromEntries(
    Object.entries(images).map(([name, b64]) => [name, bytes(b64)]),
  ),
  renderPng: makeRenderer(resvgWasm, fonts.map(bytes)),
})
