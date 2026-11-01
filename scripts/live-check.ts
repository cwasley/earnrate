// Checks the live site and hosted server end to end: earnrate.dev's pages,
// then signing in to mcp.earnrate.dev as a new client, asking a question,
// saving a card and deleting the wallet. It sends no personal data; the
// wallet it starts is anonymous and deleted at the end. Exits 1 when a
// check fails, printing a Markdown report either way.
//
//   node scripts/live-check.ts [--report report.md]

import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

const SITE = 'https://earnrate.dev'
const SERVER = 'https://mcp.earnrate.dev'
// Never opened: the authorization code is read from the page's link.
const CALLBACK = 'http://127.0.0.1:53682/callback'

const { values } = parseArgs({ options: { report: { type: 'string' } } })

type Result = { name: string; ok: boolean; detail: string }
const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

const base64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64url')
const unescape = (html: string) =>
  html.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))

type Rpc = { status: number; body: Record<string, unknown> }

async function rpc(
  token: string | null,
  method: string,
  params: object,
): Promise<Rpc> {
  const res = await fetch(SERVER, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const text = await res.text()
  const json = text.startsWith('{')
    ? text
    : (text
        .split('\n')
        .find((l) => l.startsWith('data:'))
        ?.slice(5) ?? '{}')
  return {
    status: res.status,
    body: JSON.parse(json) as Record<string, unknown>,
  }
}

type ToolResult = { isError: boolean; text: string }

async function tool(
  token: string,
  name: string,
  args: object = {},
): Promise<ToolResult> {
  const { body } = await rpc(token, 'tools/call', { name, arguments: args })
  const result = body.result as
    { isError?: boolean; content?: { text?: string }[] } | undefined
  return {
    isError: result === undefined || result.isError === true,
    text: result?.content?.[0]?.text ?? JSON.stringify(body).slice(0, 200),
  }
}

async function site() {
  for (const path of ['/', '/best/costco', '/cards/amex-gold', '/privacy']) {
    const res = await fetch(`${SITE}${path}`)
    check(`earnrate.dev${path}`, res.ok, String(res.status))
  }
}

// Signs in the way Claude does: register a client, open the sign-in page,
// start a new wallet and trade the code for a token.
async function signIn(): Promise<string> {
  const reg = await fetch(`${SERVER}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'earnrate live check',
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
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
    state: 'live-check',
    scope: 'wallet',
    resource: SERVER,
  })
  const shown = await fetch(`${SERVER}/authorize?${query.toString()}`)
  const cookie = shown.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const page = await shown.text()
  check('sign-in page', shown.ok, String(shown.status))
  const handle = unescape(/name="handle" value="([^"]+)"/.exec(page)?.[1] ?? '')
  const started = await fetch(`${SERVER}/authorize?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ handle, choice: 'new' }),
    redirect: 'manual',
  })
  const html = await started.text()
  const link = /class="button" href="([^"]+)"/.exec(html)?.[1]
  check(
    'start a wallet',
    started.ok && link !== undefined,
    String(started.status),
  )
  const back = new URL(unescape(link ?? CALLBACK))
  const res = await fetch(`${SERVER}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code') ?? '',
      redirect_uri: CALLBACK,
      client_id: clientId,
      code_verifier: verifier,
      resource: SERVER,
    }),
  })
  const { access_token: token } = (await res.json()) as {
    access_token?: string
  }
  check('token', res.ok && token !== undefined, String(res.status))
  if (token === undefined) throw new Error('no token')
  return token
}

async function server() {
  const anonymous = await rpc(null, 'tools/call', {
    name: 'best_card_for_purchase',
    arguments: { merchant: 'Costco' },
  })
  check(
    'asks to sign in without a token',
    anonymous.status === 401,
    String(anonymous.status),
  )

  const token = await signIn()
  let saved = false
  try {
    const { body } = await rpc(token, 'tools/list', {})
    const tools =
      (body.result as { tools?: unknown[] } | undefined)?.tools ?? []
    check('17 tools', tools.length === 17, String(tools.length))

    const best = await tool(token, 'best_card_for_purchase', {
      merchant: 'Whole Foods',
      amount: 80,
    })
    check(
      'every-card answer',
      !best.isError && /Best cards for/.test(best.text),
      best.text.slice(0, 80),
    )

    const added = await tool(token, 'add_card', { cardId: 'amex-gold' })
    saved = !added.isError
    check('add_card', saved, added.text.slice(0, 80))

    const wallet = await tool(token, 'list_wallet')
    check(
      'list_wallet',
      /amex-gold/.test(wallet.text),
      wallet.text.slice(0, 80),
    )

    const mine = await tool(token, 'best_card_for_purchase', {
      merchant: 'Whole Foods',
      amount: 80,
    })
    check(
      'answer from the saved card',
      /Use American Express Gold Card/.test(mine.text),
      mine.text.slice(0, 80),
    )
  } finally {
    let deleted = await tool(token, 'delete_wallet', {
      confirm: true,
      cards: saved ? 1 : 0,
    })
    // Never leave a test wallet behind: retry with the count it reports.
    const held = /holds (\d+) card/.exec(deleted.text)?.[1]
    if (deleted.isError && held !== undefined)
      deleted = await tool(token, 'delete_wallet', {
        confirm: true,
        cards: Number(held),
      })
    check('delete_wallet', !deleted.isError, deleted.text.slice(0, 80))
    const after = await rpc(token, 'tools/call', {
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Costco' },
    })
    check('signed out after delete', after.status === 401, String(after.status))
  }
}

try {
  await site()
  await server()
} catch (e) {
  check('ran to the end', false, e instanceof Error ? e.message : String(e))
}

const failed = results.filter((r) => !r.ok)
const report = [
  `# Live check, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  '',
  failed.length === 0
    ? 'Everything passed.'
    : `${String(failed.length)} of ${String(results.length)} checks failed.`,
  '',
  ...results.map(
    (r) =>
      `- ${r.ok ? 'ok' : '**failed**'} ${r.name}${r.detail ? `: ${r.detail.replace(/\n/g, ' ')}` : ''}`,
  ),
  '',
].join('\n')
console.log(report)
if (values.report !== undefined) await writeFile(values.report, report)
process.exitCode = failed.length === 0 ? 0 : 1
