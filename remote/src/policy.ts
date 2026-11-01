// How long the hosted server keeps things, and its rate-limit window. The
// privacy page, terms and READMEs state these; tests/repo.test.ts checks
// they say the same.
export const RETENTION_MONTHS = 13 // after a wallet's last use
export const UNUSED_NEW_WALLET = { days: 7, words: 'a week' }
export const CONNECTION_IDLE_DAYS = 90 // a connected app's sign-in
// The limits per window are in wrangler.jsonc ("period": 60).
export const RATE_LIMIT_SECONDS = 60
