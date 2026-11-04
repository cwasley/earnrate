import bundle from 'earnrate:pass-bundle'
import type { Catalog } from '../../src/schema/catalog.ts'
import { makePassWorker } from './app.ts'

const { catalog, images } = bundle as {
  catalog: Catalog
  images: Record<string, string> // base64
}

export default makePassWorker({
  catalog,
  images: Object.fromEntries(
    Object.entries(images).map(([name, b64]) => [
      name,
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    ]),
  ),
})
