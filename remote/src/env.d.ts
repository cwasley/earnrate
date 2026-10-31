// Aliased in wrangler.jsonc to catalog.gen.json, written by `yarn remote:build`.
declare module 'earnrate:bundle' {
  const bundle: import('./app.ts').Bundle
  export default bundle
}
