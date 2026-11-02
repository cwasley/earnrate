import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { JsonBackend } from '../src/data/store.ts'
import type {
  CachedClassification,
  MerchantCache,
} from '../src/merchants/cache.ts'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const EXAMPLE_WALLET = path.join(ROOT, 'wallet.example.yaml')

// The text of an MCP tool result.
export function text(result: { content?: unknown }): string {
  const content = (result.content ?? []) as { type: string; text?: string }[]
  return content.map((c) => c.text ?? '').join('\n')
}

export function memoryCache(): MerchantCache {
  const entries = new Map<string, CachedClassification>()
  return {
    get: (key) => entries.get(key),
    set: (key, value) => {
      entries.set(key, value)
      return Promise.resolve()
    },
  }
}

export function memoryBackend(initial: string | null = null): JsonBackend {
  let text = initial
  return {
    read: () => Promise.resolve(text),
    write: (next) => {
      text = next
      return Promise.resolve()
    },
    remove: () => {
      text = null
      return Promise.resolve()
    },
  }
}
