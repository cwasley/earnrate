// How long earnrate.dev keeps a short report link, and the limits on making
// one. The Worker (site/reports.ts), the privacy page and the terms state
// these; tests/site-reports.test.ts checks they say the same.
export const REPORT_RETENTION_MONTHS = 13 // after the link was last opened
// An opening pushes the deletion date back only when the last push is this
// old, so opening a link is a read, not a write.
export const REPORT_REFRESH_DAYS = 30
// The longest report a link may hold; a long eight-card report is about 240.
export const REPORT_MAX_LENGTH = 600
// Links one IP address can make per minute (wrangler.jsonc, REPORT_LIMITER).
export const REPORT_LINKS_PER_MINUTE = 10
// Links the whole site makes in a day (UTC), counted in the Worker's store.
export const REPORT_LINKS_PER_DAY = 300

// The most cards and spending lines a report link may name. The page and the
// Worker both refuse longer ones.
export const MAX_CARDS = 30
export const MAX_LINES = 40
// A spending line's monthly dollars, a whole multiple of SPEND_STEP.
export const SPEND_STEP = 5
export const MAX_MONTHLY = 1_000_000
export const spendOk = (dollars: number) =>
  Number.isInteger(dollars) &&
  dollars > 0 &&
  dollars <= MAX_MONTHLY &&
  dollars % SPEND_STEP === 0

export const REPORT_RETENTION_SECONDS = Math.round(
  ((REPORT_RETENTION_MONTHS * 365.25) / 12) * 24 * 60 * 60,
)
