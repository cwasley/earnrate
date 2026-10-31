// The sign-in pages for saved wallets. No scripts: the policy below allows
// none. Everything from the client (its name, the redirect host) is escaped.

export type ClientFacts = {
  clientName: string
  clientDomain?: string | undefined // set only for a verified (CIMD) client
  redirectHost: string
  redirectIsLoopback: boolean
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`)

const STYLE = `
:root { --bg: #fbfaf7; --text: #1d1b16; --muted: #5f5a4f; --line: #dcd6c8; --accent: #1f6f50; --accent-text: #fff; --warn: #8a4b00; --field: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #16150f; --text: #ede9df; --muted: #a8a294; --line: #3a372e; --accent: #4cb08a; --accent-text: #0d1a14; --warn: #f0b060; --field: #1f1e17; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, sans-serif; }
main { max-width: 34rem; margin: 0 auto; padding: 32px 16px 48px; }
h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 12px; }
h2 { font-size: 1.05rem; margin: 0 0 8px; }
p { margin: 0 0 12px; }
.muted { color: var(--muted); font-size: 0.94rem; }
.warn { color: var(--warn); }
.error { color: var(--warn); font-weight: 600; }
section { border-top: 1px solid var(--line); padding-top: 20px; margin-top: 20px; }
button, .button { display: inline-block; font: inherit; font-weight: 600; padding: 10px 18px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-text); cursor: pointer; text-decoration: none; }
button.quiet { background: transparent; color: var(--muted); border-color: var(--line); font-weight: 500; }
input[type=text] { width: 100%; font: 1.05rem ui-monospace, monospace; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--field); color: var(--text); margin-bottom: 12px; }
.code { font: 600 1.2rem/1.6 ui-monospace, monospace; letter-spacing: 0.04em; overflow-wrap: normal; padding: 14px 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); margin: 12px 0 16px; user-select: all; }
.confirm { display: grid; grid-template-columns: auto 1fr; gap: 16px 10px; align-items: start; margin-top: 16px; }
.confirm input { margin-top: 5px; }
.confirm .button { grid-column: 1 / -1; justify-self: start; }
#saved:not(:checked) ~ .button { opacity: 0.45; pointer-events: none; }
`

export const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`
}

function whoIsAsking(client: ClientFacts): string {
  const name = escape(client.clientName)
  const origin = client.clientDomain
    ? `It's published by <strong>${escape(client.clientDomain)}</strong>.`
    : "This app registered itself, so its name isn't verified."
  const loopback = client.redirectIsLoopback
    ? '<p class="warn">This sends access to an app on your computer. Continue only if you just started connecting from it.</p>'
    : ''
  return `<p><strong>${name}</strong> wants to use a saved earnrate wallet. ${origin} Access goes to <strong>${escape(client.redirectHost)}</strong>.</p>${loopback}`
}

export function choosePage(
  client: ClientFacts,
  handle: string,
  error: string | null = null,
): string {
  const h = escape(handle)
  return page(
    'Connect your earnrate wallet',
    `<h1>Connect your earnrate wallet</h1>
${whoIsAsking(client)}
<p class="muted">Saved wallets are anonymous: no email, no name. earnrate stores your cards by product name, never card numbers, encrypted so that only your apps and your recovery code can open them. Wallets unused for 13 months are deleted.</p>
<section>
<h2>New here?</h2>
<p>Start a wallet. You'll get a recovery code to keep.</p>
<form method="post"><input type="hidden" name="handle" value="${h}"><button name="choice" value="new">Start a wallet</button></form>
</section>
<section>
<h2>Already have a wallet?</h2>
${error ? `<p class="error">${escape(error)}</p>` : ''}
<form method="post">
<input type="hidden" name="handle" value="${h}">
<label for="code">Recovery code</label>
<input type="text" id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX">
<button name="choice" value="recover">Connect</button>
</form>
</section>
<section>
<form method="post"><input type="hidden" name="handle" value="${h}"><button class="quiet" name="choice" value="deny">Cancel</button></form>
</section>`,
  )
}

export function newCodePage(code: string, continueTo: string): string {
  return page(
    'Your earnrate recovery code',
    `<h1>Your recovery code</h1>
<p>Keep it somewhere safe, like a password manager. It's the only way to connect this wallet from another app or device, and earnrate can't look it up or reset it for you.</p>
<div class="code">${escape(code)}</div>
<p class="muted">Don't paste it into a chat. Type it only on this earnrate page when you connect another app.</p>
<div class="confirm"><input type="checkbox" id="saved"><label for="saved">I've saved my recovery code</label><a class="button" href="${escape(continueTo)}">Continue</a></div>`,
  )
}

export function errorPage(message: string): string {
  return page(
    "earnrate couldn't connect",
    `<h1>That didn't work</h1><p>${escape(message)}</p><p class="muted">Go back to the app and try connecting again.</p>`,
  )
}
