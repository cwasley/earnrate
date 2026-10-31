import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const EXAMPLE_WALLET = path.join(ROOT, 'wallet.example.yaml')

// The text of an MCP tool result.
export function text(result: { content?: unknown }): string {
  const content = (result.content ?? []) as { type: string; text?: string }[]
  return content.map((c) => c.text ?? '').join('\n')
}
