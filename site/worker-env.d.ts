// Aliased in wrangler.jsonc and wrangler.preview.jsonc to
// site/report-codes.gen.json, written by `yarn site:build`, and in
// vitest.config.ts to tests/stubs/report-codes.ts.
declare module 'earnrate:report-codes' {
  const codes: import('./report-check.ts').ReportCodes
  export default codes
}
