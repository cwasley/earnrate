import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('tests/stubs/cloudflare-workers.ts', import.meta.url),
      ),
      'earnrate:report-codes': fileURLToPath(
        new URL('tests/stubs/report-codes.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // The fee-math tests take about three times as long on CI runners as on
    // a laptop, and timed out at the 5-second default.
    testTimeout: 20_000,
    // So the alias above reaches the library's own import.
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
})
