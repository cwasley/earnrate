// Marks a hosted saved wallet as used, so it lasts 13 months instead of being
// deleted a week after it was started. For wallets that only a health checker
// connects to (Glama lists tools but never calls one).
// Usage: node scripts/touch-wallet.ts <file holding the recovery code>
//   [--cards amex-gold,chase-freedom-flex]
// --cards also saves those cards, for a reviewer's demo wallet. The code is
// read from the file and never printed.
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

const SERVER = 'https://mcp.earnrate.dev'
const CALLBACK = 'http://127.0.0.1:53682/callback'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { cards: { type: 'string' } },
})
const file = positionals[0]
if (!file) {
  console.error('Usage: node scripts/touch-wallet.ts <code file> [--cards …]')
  process.exit(2)
}
const cards = (values.cards ?? '').split(',').filter((c) => c !== '')
const code = (await readFile(file, 'utf8')).trim()

const base64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64url')
const unescape = (html: string) =>
  html.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))

const reg = await fetch(`${SERVER}/oauth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'earnrate touch-wallet',
    redirect_uris: [CALLBACK],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
  }),
})
const { client_id: clientId } = (await reg.json()) as { client_id: string }
const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
const challenge = base64url(
  new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  ),
)
const query = new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: CALLBACK,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state: 'touch',
  scope: 'wallet',
  resource: SERVER,
})
const shown = await fetch(`${SERVER}/authorize?${query.toString()}`)
const cookie = shown.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ')
const handle = unescape(
  /name="handle" value="([^"]+)"/.exec(await shown.text())?.[1] ?? '',
)
const recovered = await fetch(`${SERVER}/authorize?${query.toString()}`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
  body: new URLSearchParams({ handle, choice: 'recover', code }),
  redirect: 'manual',
})
const location = recovered.headers.get('location')
if (recovered.status !== 302 || location === null) {
  console.error(
    `Couldn't connect with that code (HTTP ${String(recovered.status)}).`,
  )
  process.exit(1)
}
const tokenRes = await fetch(`${SERVER}/oauth/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: new URL(location).searchParams.get('code') ?? '',
    redirect_uri: CALLBACK,
    client_id: clientId,
    code_verifier: verifier,
    resource: SERVER,
  }),
})
const { access_token: token } = (await tokenRes.json()) as {
  access_token?: string
}
if (token === undefined) {
  console.error(`No token (HTTP ${String(tokenRes.status)}).`)
  process.exit(1)
}

const call = (name: string, args: Record<string, unknown> = {}) =>
  fetch(SERVER, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })

for (const cardId of cards) {
  const added = await call('add_card', { cardId })
  const body = await added.text()
  console.log(
    added.ok && !body.includes('"isError":true')
      ? `Saved ${cardId}.`
      : `Couldn't save ${cardId} (HTTP ${String(added.status)}).`,
  )
}
const listed = await call('list_wallet')
console.log(
  listed.ok
    ? 'Used the wallet once (list_wallet): it now lasts 13 months from today.'
    : `list_wallet failed (HTTP ${String(listed.status)}).`,
)
// Sign this script's connection out; other apps on the wallet stay connected.
await call('switch_wallet')
process.exit(listed.ok ? 0 : 1)
