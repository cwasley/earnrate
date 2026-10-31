import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('tests/stubs/cloudflare-workers.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
    // So the alias above reaches the library's own import.
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
})
