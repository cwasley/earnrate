// JavaScriptCore on its own has no URL class, which the schemas' URL checks
// (zod's z.url()) and hostname() in src/engine/text.ts need. This is enough
// of one for absolute URLs like the issuer pages in the card data; entry.ts
// installs it only where URL is missing.
const ABSOLUTE =
  /^([a-z][a-z\d+.-]*:)(?:\/\/(?:[^@/?#\s]*@)?(\[[\da-f:.]+\]|[^:/?#\s[\]]*)(?::(\d*))?)?([^?#\s]*)(\?[^#\s]*)?(#\S*)?$/i
const SPECIAL = new Set(['http:', 'https:', 'ftp:', 'ws:', 'wss:', 'file:'])

export class SmallURL {
  readonly href: string
  readonly protocol: string
  readonly hostname: string
  readonly port: string
  readonly pathname: string
  readonly search: string
  readonly hash: string

  constructor(input: string) {
    const text = input.trim()
    const m = ABSOLUTE.exec(text)
    const protocol = m?.[1]?.toLowerCase() ?? ''
    const hostname = m?.[2]?.toLowerCase() ?? ''
    if (!m || (SPECIAL.has(protocol) && protocol !== 'file:' && !hostname)) {
      throw new TypeError(`Invalid URL: ${text}`)
    }
    this.href = text
    this.protocol = protocol
    this.hostname = hostname
    this.port = m[3] ?? ''
    this.pathname = m[4] || (SPECIAL.has(protocol) ? '/' : '')
    this.search = m[5] ?? ''
    this.hash = m[6] ?? ''
  }

  get host(): string {
    return this.port ? `${this.hostname}:${this.port}` : this.hostname
  }

  get origin(): string {
    return `${this.protocol}//${this.host}`
  }

  toString(): string {
    return this.href
  }

  static canParse(input: string): boolean {
    try {
      new SmallURL(input)
      return true
    } catch {
      return false
    }
  }
}

export function installURL(): void {
  const scope = globalThis as { URL?: unknown }
  if (typeof scope.URL === 'undefined') scope.URL = SmallURL
}
