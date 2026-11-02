// The sign-in pages for saved wallets. The policy below allows one script,
// PAGE_SCRIPT, by its hash. Everything from the client (its name, the
// redirect host) is escaped.

import { RETENTION_MONTHS, UNUSED_NEW_WALLET } from './policy.ts'

type ClientFacts = {
  clientName: string
  clientDomain?: string | undefined // set only for a verified (CIMD) client
  redirectHost: string
  redirectIsLoopback: boolean
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`)

const STYLE = `
:root { --bg: #fbfaf7; --text: #1c1d1f; --muted: #5f6368; --line: #e6e2da; --accent: #1f6f54; --accent-text: #fff; --warn: #8a4b00; --field: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg: #121315; --text: #ecebe7; --muted: #a2a6ab; --line: #2b2e32; --accent: #7fd1ad; --accent-text: #0d1a14; --warn: #f0b060; --field: #1a1c1f; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, sans-serif; }
main { max-width: 34rem; margin: 0 auto; padding: 32px 16px 48px; }
h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 12px; }
h2 { font-size: 1.05rem; margin: 0 0 8px; }
p { margin: 0 0 12px; }
a { color: var(--accent); }
.muted { color: var(--muted); font-size: 0.94rem; }
.warn { color: var(--warn); }
.error { color: var(--warn); font-weight: 600; }
form { margin-bottom: 16px; }
.links { margin-top: 32px; }
section { border-top: 1px solid var(--line); padding-top: 20px; margin-top: 20px; }
button, .button { display: inline-block; font: inherit; font-weight: 600; padding: 10px 18px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-text); cursor: pointer; text-decoration: none; }
button.quiet { background: transparent; color: var(--muted); border-color: var(--line); font-weight: 500; }
input[type=text] { width: 100%; font: 1.05rem ui-monospace, monospace; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--field); color: var(--text); margin-bottom: 12px; }
.copy { margin: -4px 0 16px; }
.busy { cursor: progress; }
.busy::after { content: ''; display: inline-block; width: 0.9em; height: 0.9em; margin-left: 8px; vertical-align: -0.1em; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
button:disabled { opacity: 0.7; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .busy::after { animation-duration: 2.4s; } }
.code { font: 600 1.2rem/1.6 ui-monospace, monospace; letter-spacing: 0.04em; overflow-wrap: normal; padding: 14px 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); margin: 12px 0 16px; user-select: all; }
.confirm { display: grid; grid-template-columns: auto 1fr; gap: 16px 10px; align-items: start; margin-top: 16px; }
.confirm input { margin-top: 5px; }
.confirm .button { grid-column: 1 / -1; justify-self: start; }
#saved:not(:checked) ~ .button { opacity: 0.45; pointer-events: none; }
`

// Shows the hidden copy button and copies the code above it, and marks a
// pressed button as working while the next page loads. Changing a single
// character changes its hash: update PAGE_SCRIPT_HASH (a test checks).
export const PAGE_SCRIPT =
  "for(const b of document.querySelectorAll('.copy')){b.hidden=false;b.onclick=()=>navigator.clipboard.writeText(document.querySelector('.code').textContent).then(()=>{b.textContent='Copied'})};const busy=(b,on)=>{b.classList.toggle('busy',on);if(on)b.setAttribute('aria-busy','true');else b.removeAttribute('aria-busy')};for(const f of document.forms)f.addEventListener('submit',e=>{if(e.submitter)busy(e.submitter,true);setTimeout(()=>{for(const b of document.querySelectorAll('button'))b.disabled=true})});for(const a of document.querySelectorAll('a.button'))a.addEventListener('click',()=>{busy(a,true);setTimeout(()=>busy(a,false),8000)});addEventListener('pageshow',e=>{if(e.persisted)for(const b of document.querySelectorAll('button,a.button')){b.disabled=false;busy(b,false)}})"
export const PAGE_SCRIPT_HASH =
  'sha256-BwDZE19KA+w4JK3FSBjKthNA4TzHv3TSQ1ztg+iT1/o='

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': `default-src 'none'; script-src '${PAGE_SCRIPT_HASH}'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'`,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, no-transform', // keeps Cloudflare from injecting scripts
}

export function html(body: string, status = 200, extra?: Headers): Response {
  const headers = new Headers(extra)
  for (const [k, v] of Object.entries(PAGE_HEADERS)) headers.set(k, v)
  return new Response(body, { status, headers })
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
<body><main>${body}<p class="muted links"><a href="https://earnrate.dev/terms">Terms</a> · <a href="https://earnrate.dev/privacy">Privacy</a></p></main><script>${PAGE_SCRIPT}</script></body>
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
<p class="muted">Saved wallets are anonymous: no email, no name. earnrate stores your cards by product, like amex-gold, never card numbers, encrypted so that only your apps and your recovery code can open them. Wallets unused for ${String(RETENTION_MONTHS)} months are deleted, and a new one that's never used is deleted after ${UNUSED_NEW_WALLET.words}.</p>
<section>
<h2>New here?</h2>
<p>Start a wallet. You'll get a recovery code to keep. Reconnecting Claude? Use your recovery code below instead: a new wallet starts empty.</p>
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
<p class="muted">Need a new recovery code? <a href="/change-code" target="_blank" rel="noopener">Change it</a>.</p>
</section>
<section>
<form method="post"><input type="hidden" name="handle" value="${h}"><button class="quiet" name="choice" value="deny">Cancel</button></form>
</section>`,
  )
}

function shownCode(code: string): string {
  return `<div class="code">${escape(code)}</div>
<button type="button" class="copy quiet" hidden>Copy code</button>`
}

export function newCodePage(code: string, continueTo: string): string {
  return page(
    'Your earnrate recovery code',
    `<h1>Your recovery code</h1>
<p>Keep it somewhere safe, like a password manager. It's the only way to connect this wallet from another app or device, and earnrate can't look it up or reset it for you.</p>
${shownCode(code)}
<p class="muted">Don't paste it into a chat. Type it only on this earnrate page when you connect another app.</p>
<div class="confirm"><input type="checkbox" id="saved"><label for="saved">I've saved my recovery code</label><a class="button" href="${escape(continueTo)}">Continue</a></div>`,
  )
}

export function errorPage(
  message: string,
  next = 'Go back to the app and try connecting again.',
): string {
  return page(
    "earnrate couldn't connect",
    `<h1>That didn't work</h1><p>${escape(message)}</p><p class="muted">${escape(next)}</p>`,
  )
}

export function changeCodePage(error: string | null = null): string {
  return page(
    'Change your earnrate recovery code',
    `<h1>Change your recovery code</h1>
<p>Enter your current code. You'll get a new one, and the old one stops working. Every app connected to your wallet is signed out; reconnect them with the new code.</p>
${error ? `<p class="error">${escape(error)}</p>` : ''}
<form method="post">
<label for="code">Current recovery code</label>
<input type="text" id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX">
<button>Change my code</button>
</form>
<p class="muted">Lost your code? earnrate can't look it up. Start a new wallet instead; the old one is deleted after ${String(RETENTION_MONTHS)} months unused.</p>`,
  )
}

export function changedCodePage(code: string): string {
  return page(
    'Your new earnrate recovery code',
    `<h1>Your new recovery code</h1>
<p>Keep it somewhere safe, like a password manager. Your old code no longer works, and apps that were connected need to reconnect with this one.</p>
${shownCode(code)}
<p class="muted">Don't paste it into a chat. Type it only on the earnrate page that opens when you connect an app.</p>`,
  )
}
