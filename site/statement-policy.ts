// The statement check (site/statement.html) is one file with its script and
// styles written into it. Its policy lets it load nothing and send nothing,
// to earnrate.dev or anywhere else, and runs only the script and styles whose
// SHA-256 hashes it names, so a changed or added one won't run. The build
// (site/statement.config.ts) hashes the built page, writes the policy into
// it, less frame-ancestors (ignored in a <meta> policy), and adds it to
// site-dist/_headers for earnrate.dev; the preview Worker sends the page's
// own policy as a header. tests/statement-page.test.ts holds all three to
// the built page.
export const STATEMENT_PATHS = ['/statement', '/statement.html']

export type PageHashes = {
  scripts: string[] // base64 SHA-256 of each inline script
  styles: string[] // and of each inline style
}

const sources = (hashes: string[]) =>
  hashes.map((h) => `'sha256-${h}'`).join(' ')

export function statementPolicy(
  hashes: PageHashes,
  { meta = false } = {},
): string {
  return [
    "default-src 'none'",
    `script-src ${sources(hashes.scripts)}`,
    `style-src ${sources(hashes.styles)}`,
    'img-src data:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    ...(meta ? [] : ["frame-ancestors 'none'"]),
  ].join('; ')
}

// Without the page's own policy, nothing on it may run or load.
export const FALLBACK_POLICY = "default-src 'none'; frame-ancestors 'none'"

const META = /<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/

// The header for the built page: its <meta> policy and frame-ancestors.
export function headerPolicy(html: string): string {
  const meta = META.exec(html)?.[1]
  if (!meta?.startsWith("default-src 'none'; ")) return FALLBACK_POLICY
  return `${meta}; frame-ancestors 'none'`
}

const BEGIN = '# statement-check: written by site/statement.config.ts'
const END = '# statement-check: end'

// site-dist/_headers with the page's block, replacing one an earlier build
// wrote.
export function withStatementHeaders(headers: string, policy: string): string {
  const start = headers.indexOf(BEGIN)
  const end = headers.indexOf(END)
  const rest =
    start === -1 || end === -1
      ? headers
      : headers.slice(0, start) + headers.slice(end + END.length + 1)
  const block = STATEMENT_PATHS.map(
    (p) => `${p}\n  Content-Security-Policy: ${policy}\n`,
  ).join('')
  return `${rest.trimEnd()}\n\n${BEGIN}\n${block}${END}\n`.trimStart()
}
