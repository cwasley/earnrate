import { Script } from 'node:vm'
import { createHash } from 'node:crypto'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Env } from '../remote/src/app.ts'
import { ALIAS_RESOURCE, appKind, RESOURCE } from '../remote/src/auth.ts'
import {
  keysFromCode,
  newRecoveryCode,
  newWalletKey,
  normalizeRecoveryCode,
  unwrapWalletKey,
  wrapWalletKey,
} from '../remote/src/vault-crypto.ts'
import { WalletVault } from '../remote/src/vault.ts'
import { PAGE_SCRIPT, PAGE_SCRIPT_HASH } from '../remote/src/pages.ts'
import { claimedLimitKey } from '../remote/src/requests.ts'
import {
  SITE_CALLBACKS,
  SITE_CLIENT_ID,
  withSiteClient,
} from '../remote/src/site-client.ts'
import { SAVED_WALLET_TOOLS } from '../src/mcp/server.ts'
import { TODAY } from './golden/fixtures.ts'
import { text } from './helpers.ts'
import {
  catalog,
  deployment,
  memoryKv,
  memoryStorage,
  ORIGIN,
} from './remote-helpers.ts'

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

test('serves the OpenAI domain-verification token as plain text', async () => {
  const d = deployment()
  const path = '/.well-known/openai-apps-challenge'
  expect((await d.fetch(path)).status).toBe(404)
  const res = await d.fetch(path, undefined, {
    OPENAI_APPS_CHALLENGE: 'token-123\n',
  })
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
  expect(await res.text()).toBe('token-123')
})

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function connect(
  d: ReturnType<typeof deployment>,
  token: string | null = null,
  extra: Partial<Env> = {},
  path = '/',
): Promise<Client> {
  const client = new Client(
    { name: 'earnrate-test', version: '0.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${ORIGIN}${path}`), {
      fetch: (url, init) => {
        const request = new Request(url, init)
        if (token) request.headers.set('authorization', `Bearer ${token}`)
        return d.fetch(request, undefined, extra)
      },
    }),
  )
  cleanups.push(() => client.close())
  return client
}

const unescape = (html: string) =>
  html.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

// What Claude does: register, send the user to /authorize, trade the code.
async function signIn(
  d: ReturnType<typeof deployment>,
  choose: (
    page: string,
    post: (fields: Record<string, string>) => Promise<Response>,
  ) => Promise<string>, // returns the redirect back to Claude
  clientName = 'Claude',
  resource = RESOURCE,
) {
  const registered = await d.fetch('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })
  expect(registered.status).toBe(201)
  const { client_id: clientId } = (await registered.json()) as {
    client_id: string
  }
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
    state: 'state-123',
    scope: 'wallet',
    resource,
  })
  const path = `/authorize?${query.toString()}`
  const shown = await d.fetch(path)
  expect(shown.status).toBe(200)
  const cookie = shown.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const page = await shown.text()
  const handle = unescape(/name="handle" value="([^"]+)"/.exec(page)?.[1] ?? '')
  const post = (fields: Record<string, string>) =>
    d.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: new URLSearchParams({ handle, ...fields }).toString(),
      redirect: 'manual',
    })
  const back = new URL(await choose(page, post))
  expect(back.origin + back.pathname).toBe(CALLBACK)
  expect(back.searchParams.get('state')).toBe('state-123')
  const tokens = await d.fetch('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code') ?? '',
      redirect_uri: CALLBACK,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    }).toString(),
  })
  expect(tokens.status).toBe(200)
  return ((await tokens.json()) as { access_token: string }).access_token
}

async function startWallet(d: ReturnType<typeof deployment>) {
  let code = ''
  const token = await signIn(d, async (_page, post) => {
    const res = await post({ choice: 'new' })
    expect(res.status).toBe(200)
    const html = await res.text()
    code = /<div class="code">([^<]+)<\/div>/.exec(html)?.[1] ?? ''
    return unescape(/class="button" href="([^"]+)"/.exec(html)?.[1] ?? '')
  })
  return { token, code }
}

const post = (
  d: ReturnType<typeof deployment>,
  path: string,
  body: string,
  token?: string,
) =>
  d.fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  })

const callTool = (name: string, args: Record<string, unknown> = {}) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })

describe('remote connector', () => {
  test('lists every tool once signed in', async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const client = await connect(d, token)
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain('best_card_for_purchase')
    for (const name of SAVED_WALLET_TOOLS) expect(names).toContain(name)
  })

  test('a wallet with no cards answers from every card, or from cards named for one answer', async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const client = await connect(d, token)
    const listed = await client.callTool({ name: 'list_wallet', arguments: {} })
    expect(text(listed)).toMatch(/saved wallet has no cards yet/)
    expect(text(listed)).toMatch(
      /^This is your hosted earnrate wallet\. It was started (just now|\d+ minutes? ago)\./,
    )
    const all = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Whole Foods', amount: 80 },
    })
    expect(all.isError).toBeFalsy()
    expect(text(all)).toContain('Whole Foods')
    const named = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Whole Foods', cards: [{ cardId: 'amex-gold' }] },
    })
    expect(
      (named.structuredContent as { decision: { cardId: string } }).decision
        .cardId,
    ).toBe('amex-gold')
  })

  test('asks for sign-in on every request without a token', async () => {
    const d = deployment()
    for (const body of [
      callTool('best_card_for_purchase', { merchant: 'Costco' }),
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    ]) {
      const res = await post(d, '/', body)
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toContain('scope="wallet"')
    }
    const res = await post(
      d,
      '/',
      callTool('add_card', { cardId: 'amex-gold' }),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="wallet"`,
    )
    const metadata = (await (
      await d.fetch('/.well-known/oauth-protected-resource')
    ).json()) as { resource: string; authorization_servers: string[] }
    expect(metadata).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [ORIGIN],
    })
  })

  test('a token it did not issue is sent to sign in again', async () => {
    const d = deployment()
    const wallet = await post(
      d,
      '/',
      callTool('list_wallet'),
      'not-a-real-token',
    )
    expect(wallet.status).toBe(401)
    expect(wallet.headers.get('www-authenticate')).toContain(
      'error="invalid_token"',
    )
    const question = await post(
      d,
      '/',
      callTool('best_card_for_purchase', { merchant: 'Costco' }),
      'not-a-real-token',
    )
    expect(question.status).toBe(401)
  })

  test('while sign-in is down, questions are answered and wallet tools wait', async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const broken = {
      ...memoryKv(),
      get: () => Promise.reject(new Error('KV is down')),
    }
    const call = (body: string) =>
      d.fetch(
        '/',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${token}`,
          },
          body,
        },
        { OAUTH_KV: broken },
      )
    expect(
      (await call(callTool('best_card_for_purchase', { merchant: 'Costco' })))
        .status,
    ).toBe(200)
    expect((await call(callTool('list_wallet'))).status).toBe(503)
  })

  test('a body over 64 KB is refused, even without Content-Length', async () => {
    const big = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 80; i++)
          controller.enqueue(new Uint8Array(1024).fill(32))
        controller.close()
      },
    })
    const res = await deployment().fetch(
      new Request(`${ORIGIN}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: big,
        duplex: 'half',
      }),
    )
    expect(res.status).toBe(413)
  })

  test('app registrations are limited in size', async () => {
    const res = await deployment().fetch('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'x'.repeat(5000),
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: 'none',
      }),
    })
    expect(res.status).toBe(400)
  })

  test("sign-in steps have their own rate limit; Anthropic's servers are exempt", async () => {
    const d = deployment()
    const keys: string[] = []
    const env = {
      SIGN_IN_LIMITER: {
        limit: ({ key }: { key: string }) => {
          keys.push(key)
          return Promise.resolve({ success: false })
        },
      },
    }
    const from = (ip: string) =>
      d.fetch(
        '/oauth/register',
        { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: '{}' },
        env,
      )
    expect((await from('203.0.113.9')).status).toBe(429)
    expect((await from('2001:db8:1:2:3:4:5:6')).status).toBe(429)
    expect((await from('2001:db8:1:2::7')).status).toBe(429)
    expect((await from('160.79.105.20')).status).not.toBe(429)
    expect(keys).toEqual([
      '203.0.113.9',
      '2001:db8:1:2::/64',
      '2001:db8:1:2::/64',
    ])
  })

  test('sends a browser at the root to the website and 404s other paths', async () => {
    const d = deployment()
    const root = await d.fetch('/', { headers: { accept: 'text/html' } })
    expect(root.status).toBe(302)
    expect(root.headers.get('location')).toBe('https://earnrate.dev/')
    expect((await d.fetch('/wallets')).status).toBe(404)
  })

  test('refuses requests over the rate limit', async () => {
    const res = await deployment().fetch(
      '/mcp',
      { method: 'POST', body: '{}' },
      { LIMITER: { limit: () => Promise.resolve({ success: false }) } },
    )
    expect(res.status).toBe(429)
  })

  test('counts only the method and tool name, the kind of app and refusals by tool, never arguments', async () => {
    const points: { blobs?: string[]; indexes?: string[] }[] = []
    const d = deployment()
    const { token } = await startWallet(d)
    const client = await connect(d, token, {
      USAGE: { writeDataPoint: (p) => points.push(p) },
    })
    await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Trader Joes', amount: 123.45 },
    })
    expect(points.map((p) => p.blobs)).toContainEqual([
      'tool:best_card_for_purchase',
      'claude',
    ])
    expect(points.map((p) => p.blobs)).toContainEqual([
      'wallet-active',
      'claude',
    ])
    await client
      .callTool({ name: 'Trader Joes at 123 Main St', arguments: {} })
      .catch(() => undefined)
    expect(points.map((p) => p.blobs)).toContainEqual(['tool:other', 'claude'])
    await client.callTool({
      name: 'record_purchase',
      arguments: { cardId: 'amex-gold', merchant: 'Trader Joes', amount: 5 },
    })
    expect(points.map((p) => p.blobs)).toContainEqual([
      'tool-error:record_purchase',
      'claude',
    ])
    expect(points.filter((p) => p.blobs?.[0] === 'wallet-active')).toHaveLength(
      1,
    )
    const recorded = JSON.stringify(points)
    expect(recorded).not.toContain('Trader')
    expect(recorded).not.toContain('123')
  })

  test('a new wallet is counted by the kind of app, with nothing about it', async () => {
    const points: { blobs?: string[]; indexes?: string[] }[] = []
    const d = deployment()
    d.env.USAGE = { writeDataPoint: (p) => points.push(p) }
    const { code } = await startWallet(d)
    expect(points.map((p) => p.blobs)).toContainEqual([
      'wallet-created',
      'claude',
    ])
    expect(JSON.stringify(points)).not.toContain(code)
  })

  test('the kind of app comes from where it signs in, never its own name', () => {
    const kind = (
      clientId: string,
      redirectUris: string[],
      clientName?: string,
    ) =>
      appKind({ clientId, redirectUris, ...(clientName ? { clientName } : {}) })
    expect(kind('abc', ['https://claude.ai/api/mcp/auth_callback'])).toBe(
      'claude',
    )
    expect(kind('abc', ['https://claude.com/api/mcp/auth_callback'])).toBe(
      'claude',
    )
    expect(kind('https://chatgpt.com/oauth/client.json', [])).toBe('chatgpt')
    expect(kind('abc', ['https://chatgpt.com/connector/oauth/cb_1'])).toBe(
      'chatgpt',
    )
    expect(kind('abc', ['http://localhost:3118/callback'])).toBe('local')
    expect(
      kind('abc', ['http://127.0.0.1:53682/callback'], 'earnrate live check'),
    ).toBe('check')
    expect(kind('abc', ['https://evilclaude.ai/cb'], 'Claude')).toBe('other')
    expect(kind('abc', ['cursor://anysphere.cursor-retrieval/oauth'])).toBe(
      'other',
    )
  })
})

// ChatGPT's client metadata document (https://chatgpt.com/oauth/client.json),
// signed here with a test key in place of ChatGPT's.
const CHATGPT_CLIENT_ID = 'https://chatgpt.com/oauth/client.json'
const CHATGPT_JWKS = 'https://chatgpt.com/oauth/jwks.json'
const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'
const CHATGPT_DCR_REDIRECT = 'https://chatgpt.com/connector/oauth/cb_test123'

async function chatgptServers() {
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const documents: Record<string, unknown> = {
    [CHATGPT_CLIENT_ID]: {
      client_id: CHATGPT_CLIENT_ID,
      client_uri: 'https://chatgpt.com/',
      redirect_uris: [CHATGPT_REDIRECT],
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'ChatGPT',
      logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png',
      token_endpoint_auth_signing_alg: 'RS256',
      jwks_uri: CHATGPT_JWKS,
    },
    [CHATGPT_JWKS]: {
      keys: [{ ...jwk, kid: 'cimd-test', use: 'sig', alg: 'RS256' }],
    },
  }
  vi.stubGlobal('Cloudflare', {
    compatibilityFlags: { global_fetch_strictly_public: true },
  })
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    const body = documents[url]
    return Promise.resolve(
      body === undefined
        ? new Response('not found', { status: 404 })
        : Response.json(body),
    )
  })
  const encode = (value: unknown) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)))
  // A private_key_jwt client assertion (RFC 7523), as ChatGPT sends one.
  return async () => {
    const now = Math.floor(Date.now() / 1000)
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'cimd-test' })}.${encode(
      {
        iss: CHATGPT_CLIENT_ID,
        sub: CHATGPT_CLIENT_ID,
        aud: `${ORIGIN}/oauth/token`,
        jti: crypto.randomUUID(),
        iat: now,
        exp: now + 60,
      },
    )}`
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keys.privateKey,
      new TextEncoder().encode(unsigned),
    )
    return `${unsigned}.${base64url(new Uint8Array(signature))}`
  }
}

type ChatGptTokens = {
  access_token: string
  refresh_token: string
  expires_in: number
}

// What ChatGPT does: discover, then sign in through its client metadata
// document (or, when the plugin's builder picks it, dynamic registration).
async function chatgptSignIn(
  d: ReturnType<typeof deployment>,
  {
    registration = 'cimd',
    resource,
    mcpPath = '/',
  }: {
    registration?: 'cimd' | 'dcr'
    resource?: string | null // undefined: what discovery says; null: omitted
    mcpPath?: string
  } = {},
) {
  const assertion = await chatgptServers()
  const challenged = await post(
    d,
    mcpPath,
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  )
  expect(challenged.status).toBe(401)
  const metadataUrl =
    /resource_metadata="([^"]+)"/.exec(
      challenged.headers.get('www-authenticate') ?? '',
    )?.[1] ?? ''
  const prm = (await (await d.fetch(new URL(metadataUrl).pathname)).json()) as {
    resource: string
    authorization_servers: string[]
    scopes_supported: string[]
  }
  expect(prm.authorization_servers).toEqual([ORIGIN])
  expect(prm.scopes_supported).toEqual(['wallet'])
  const as = (await (
    await d.fetch('/.well-known/oauth-authorization-server')
  ).json()) as Record<string, unknown> & {
    code_challenge_methods_supported: string[]
    token_endpoint_auth_methods_supported: string[]
  }
  expect(as).toMatchObject({
    issuer: ORIGIN,
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    registration_endpoint: `${ORIGIN}/oauth/register`,
  })
  expect(as.code_challenge_methods_supported).toContain('S256')
  expect(as.token_endpoint_auth_methods_supported).toContain('private_key_jwt')
  expect(as.token_endpoint_auth_methods_supported).toContain('none')

  let clientId = CHATGPT_CLIENT_ID
  let redirect = CHATGPT_REDIRECT
  let clientAuth = async (): Promise<Record<string, string>> => ({
    client_id: CHATGPT_CLIENT_ID,
    client_assertion_type:
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: await assertion(),
  })
  if (registration === 'dcr') {
    redirect = CHATGPT_DCR_REDIRECT
    const registered = await d.fetch('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ChatGPT',
        client_uri: 'https://chatgpt.com/',
        logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png',
        redirect_uris: [CHATGPT_DCR_REDIRECT],
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'wallet',
      }),
    })
    expect(registered.status).toBe(201)
    const client = (await registered.json()) as {
      client_id: string
      client_secret: string
    }
    clientId = client.client_id
    clientAuth = () =>
      Promise.resolve({
        client_id: client.client_id,
        client_secret: client.client_secret,
      })
  }

  const target = resource === undefined ? prm.resource : resource
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const codeChallenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  )
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: 'chatgpt-state',
    scope: 'wallet',
    ...(target === null ? {} : { resource: target }),
  })
  const path = `/authorize?${query.toString()}`
  const shown = await d.fetch(path)
  expect(shown.status).toBe(200)
  const page = await shown.text()
  expect(page).toContain('<strong>ChatGPT</strong>')
  expect(page).toContain('Reconnecting an app?')
  if (registration === 'cimd') {
    expect(page).toContain('published by <strong>chatgpt.com</strong>')
    expect(page).not.toContain('If someone sent you this link')
  } else expect(page).toContain('If someone sent you this link')
  const handle = unescape(/name="handle" value="([^"]+)"/.exec(page)?.[1] ?? '')
  const cookie = shown.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const started = await d.fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ handle, choice: 'new' }).toString(),
  })
  expect(started.status).toBe(200)
  const csp = started.headers.get('content-security-policy') ?? ''
  expect(csp).not.toMatch(/form-action|navigate-to/)
  const html = await started.text()
  const recoveryCode = /<div class="code">([^<]+)<\/div>/.exec(html)?.[1] ?? ''
  const back = new URL(
    unescape(/class="button" href="([^"]+)"/.exec(html)?.[1] ?? ''),
  )
  expect(back.origin + back.pathname).toBe(redirect)
  expect(back.searchParams.get('state')).toBe('chatgpt-state')
  expect(back.searchParams.get('iss')).toBe(ORIGIN)

  const token = async (fields: Record<string, string>) =>
    d.fetch('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...fields,
        ...(await clientAuth()),
        ...(target === null ? {} : { resource: target }),
      }).toString(),
    })
  const exchanged = await token({
    grant_type: 'authorization_code',
    code: back.searchParams.get('code') ?? '',
    redirect_uri: redirect,
    code_verifier: verifier,
  })
  expect(exchanged.status).toBe(200)
  const tokens = (await exchanged.json()) as ChatGptTokens
  const refresh = (refreshToken: string) =>
    token({ grant_type: 'refresh_token', refresh_token: refreshToken })
  return { tokens, refresh, recoveryCode }
}

describe('ChatGPT', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('signs in with its client metadata document, answers, refreshes, and is sent back to sign-in once the wallet is deleted', async () => {
    const d = deployment()
    const { tokens, refresh } = await chatgptSignIn(d)
    expect(tokens.expires_in).toBe(3600)
    expect(tokens.refresh_token).toBeTruthy()

    const client = await connect(d, tokens.access_token)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('delete_wallet')
    for (const t of tools) {
      for (const hint of [
        'readOnlyHint',
        'destructiveHint',
        'openWorldHint',
      ] as const)
        expect(typeof t.annotations?.[hint], `${t.name} ${hint}`).toBe(
          'boolean',
        )
      expect(t.outputSchema, t.name).toBeDefined()
    }
    const byName = (name: string) => tools.find((t) => t.name === name)
    expect(byName('best_card_for_purchase')?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    })
    for (const name of ['delete_wallet', 'switch_wallet'])
      expect(byName(name)?.annotations, name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      })
    const answer = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Whole Foods', amount: 80 },
    })
    expect(answer.isError).toBeFalsy()
    expect(text(answer)).toContain('Whole Foods')
    expect(answer.structuredContent).toBeTypeOf('object')

    const refreshed = await refresh(tokens.refresh_token)
    expect(refreshed.status).toBe(200)
    const next = (await refreshed.json()) as ChatGptTokens
    expect(next.access_token).not.toBe(tokens.access_token)
    const again = await connect(d, next.access_token)
    await again.callTool({
      name: 'add_card',
      arguments: { cardId: 'amex-gold' },
    })
    const deleted = await again.callTool({
      name: 'delete_wallet',
      arguments: { confirm: true, cards: 1 },
    })
    expect(deleted.isError).toBeFalsy()
    expect(text(deleted)).toContain('signed out every app connected to it')

    for (const t of [tokens.access_token, next.access_token]) {
      const after = await post(d, '/', callTool('list_wallet'), t)
      expect(after.status).toBe(401)
      expect(after.headers.get('www-authenticate')).toBe(
        `Bearer error="invalid_token", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="wallet"`,
      )
    }
    expect((await refresh(next.refresh_token)).status).toBe(400)
  })

  test.each([
    ['omitted', null, '/'],
    ['the origin', RESOURCE, '/'],
    ['the origin with a slash', `${RESOURCE}/`, '/'],
    ['/mcp', ALIAS_RESOURCE, '/mcp'],
    ['/mcp, connected at the origin', ALIAS_RESOURCE, '/'],
  ])('accepts the resource parameter %s', async (_name, resource, mcpPath) => {
    const d = deployment()
    const { tokens } = await chatgptSignIn(d, { resource, mcpPath })
    for (const path of ['/', '/mcp']) {
      const client = await connect(d, tokens.access_token, {}, path)
      const listed = await client.callTool({
        name: 'list_wallet',
        arguments: {},
      })
      expect(listed.isError, path).toBeFalsy()
    }
  })

  test('signs in through dynamic client registration, with its callback address', async () => {
    const d = deployment()
    const { tokens, refresh } = await chatgptSignIn(d, { registration: 'dcr' })
    const client = await connect(d, tokens.access_token, {}, '/mcp')
    expect((await client.listTools()).tools.length).toBeGreaterThan(14)
    expect((await refresh(tokens.refresh_token)).status).toBe(200)
  })

  test('switch_wallet sends ChatGPT back to sign-in, where the recovery code reconnects', async () => {
    const d = deployment()
    const { tokens, refresh, recoveryCode } = await chatgptSignIn(d)
    const client = await connect(d, tokens.access_token)
    await client.callTool({
      name: 'add_card',
      arguments: { cardId: 'amex-gold' },
    })
    const switched = await client.callTool({
      name: 'switch_wallet',
      arguments: {},
    })
    expect(text(switched)).toContain('Other accounts connected to this wallet')
    const after = await post(
      d,
      '/',
      callTool('list_wallet'),
      tokens.access_token,
    )
    expect(after.status).toBe(401)
    expect(after.headers.get('www-authenticate')).toContain(
      'error="invalid_token"',
    )
    expect((await refresh(tokens.refresh_token)).status).toBe(400)
    const token = await signIn(d, async (_page, post) => {
      const res = await post({ choice: 'recover', code: recoveryCode })
      return res.headers.get('location') ?? ''
    })
    const listed = await (
      await connect(d, token)
    ).callTool({ name: 'list_wallet', arguments: {} })
    expect(text(listed)).toContain('amex-gold')
  })
})

describe('rate limits', () => {
  const OPENAI_IP = '203.0.113.50' // any shared address that isn't Anthropic's
  const ANTHROPIC_IP = '160.79.105.20'

  function recording(success = true) {
    const keys: string[] = []
    return {
      keys,
      limiter: {
        limit: ({ key }: { key: string }) => {
          keys.push(key)
          return Promise.resolve({ success })
        },
      },
    }
  }

  const from = (
    d: ReturnType<typeof deployment>,
    ip: string,
    path: string,
    init: RequestInit,
    env: Partial<Env>,
  ) => {
    const request = new Request(`${ORIGIN}${path}`, init)
    request.headers.set('cf-connecting-ip', ip)
    return d.fetch(request, undefined, env)
  }

  const mcpCall = (token: string | null): RequestInit => ({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: callTool('best_card_for_purchase', { merchant: 'Costco' }),
  })

  test("signed-in calls from one app's servers count per wallet, not per address", async () => {
    const d = deployment()
    const one = (await startWallet(d)).token
    const two = (await startWallet(d)).token
    const general = recording()
    const signIn = recording()
    const env = { LIMITER: general.limiter, SIGN_IN_LIMITER: signIn.limiter }
    for (const token of [one, two, one])
      expect((await from(d, OPENAI_IP, '/', mcpCall(token), env)).status).toBe(
        200,
      )
    const [a, b, c] = general.keys
    expect(general.keys).toHaveLength(3)
    expect(a).toMatch(/^wallet:[0-9a-f]{32}$/)
    expect(a).toBe(c)
    expect(b).not.toBe(a)
    expect(signIn.keys).toEqual([])
    for (const token of [one, two])
      for (const part of token.split(':'))
        expect(general.keys.join(' ')).not.toContain(part)
  })

  test('one wallet over its limit is refused without touching another', async () => {
    const d = deployment()
    const busy = (await startWallet(d)).token
    const calm = (await startWallet(d)).token
    const busyKey = (await claimedLimitKey(busy)) ?? ''
    expect(busyKey).toMatch(/^grant:/)
    const counts = new Map<string, number>()
    const LIMITER = {
      limit: ({ key }: { key: string }) => {
        counts.set(key, (counts.get(key) ?? 0) + 1)
        return Promise.resolve({ success: (counts.get(key) ?? 0) <= 2 })
      },
    }
    const call = (token: string) =>
      from(d, OPENAI_IP, '/', mcpCall(token), { LIMITER })
    expect((await call(busy)).status).toBe(200)
    expect((await call(busy)).status).toBe(200)
    expect((await call(busy)).status).toBe(429)
    expect((await call(calm)).status).toBe(200)
  })

  test('requests without a credential, and malformed tokens, still count per address', async () => {
    const d = deployment()
    const general = recording()
    const signIn = recording()
    const env = { LIMITER: general.limiter, SIGN_IN_LIMITER: signIn.limiter }
    expect((await from(d, OPENAI_IP, '/', mcpCall(null), env)).status).toBe(401)
    expect(
      (await from(d, OPENAI_IP, '/', mcpCall('not-a-real-token'), env)).status,
    ).toBe(401)
    expect(general.keys).toEqual([OPENAI_IP])
    expect(signIn.keys).toEqual([OPENAI_IP])
    await from(d, OPENAI_IP, '/authorize', {}, env)
    expect(signIn.keys).toEqual([OPENAI_IP, OPENAI_IP])
  })

  test('a rejected token or refresh counts against the grant it names', async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const [walletId, grantId] = token.split(':')
    const forged = `${walletId ?? ''}:${grantId ?? ''}:wrong-secret`
    const general = recording()
    const signIn = recording()
    const env = { LIMITER: general.limiter, SIGN_IN_LIMITER: signIn.limiter }
    expect((await from(d, OPENAI_IP, '/', mcpCall(forged), env)).status).toBe(
      401,
    )
    const refreshed = await from(
      d,
      OPENAI_IP,
      '/oauth/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: forged,
          client_id: 'someone',
        }).toString(),
      },
      env,
    )
    expect(refreshed.status).toBe(401)
    const key = await claimedLimitKey(token)
    expect(signIn.keys).toEqual([key, key])
    expect(general.keys).toEqual([key])
    expect(key).not.toContain(walletId ?? '')
  })

  test('made-up tokens and refreshes also count against the address they come from', async () => {
    const d = deployment()
    const unchecked = recording()
    const env = { UNCHECKED_LIMITER: unchecked.limiter }
    for (const n of [1, 2])
      expect(
        (await from(d, OPENAI_IP, '/', mcpCall(`a${String(n)}:b:c`), env))
          .status,
      ).toBe(401)
    const refresh = await from(
      d,
      OPENAI_IP,
      '/oauth/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'x:y:z',
          client_id: 'someone',
        }).toString(),
      },
      env,
    )
    expect(refresh.status).toBe(401)
    expect(unchecked.keys).toEqual([OPENAI_IP, OPENAI_IP, OPENAI_IP])

    const refused = { UNCHECKED_LIMITER: recording(false).limiter }
    expect(
      (await from(d, OPENAI_IP, '/', mcpCall('a3:b:c'), refused)).status,
    ).toBe(429)
  })

  test('an accepted token never counts against its address', async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const unchecked = recording(false)
    const env = { UNCHECKED_LIMITER: unchecked.limiter }
    expect((await from(d, OPENAI_IP, '/', mcpCall(token), env)).status).toBe(
      200,
    )
    expect(unchecked.keys).toEqual([])
  })

  test('discovery documents are never limited', async () => {
    vi.stubGlobal('Cloudflare', {
      compatibilityFlags: { global_fetch_strictly_public: true },
    })
    cleanups.push(() => {
      vi.unstubAllGlobals()
      return Promise.resolve()
    })
    const d = deployment()
    const env = { LIMITER: recording(false).limiter }
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-authorization-server',
    ])
      expect((await from(d, OPENAI_IP, path, {}, env)).status, path).toBe(200)
  })

  test("Anthropic's servers are still never limited", async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const general = recording(false)
    const signIn = recording(false)
    const env = {
      LIMITER: general.limiter,
      SIGN_IN_LIMITER: signIn.limiter,
      UNCHECKED_LIMITER: recording(false).limiter,
    }
    expect((await from(d, ANTHROPIC_IP, '/', mcpCall(token), env)).status).toBe(
      200,
    )
    expect((await from(d, ANTHROPIC_IP, '/', mcpCall(null), env)).status).toBe(
      401,
    )
    expect(
      (await from(d, ANTHROPIC_IP, '/', mcpCall('a:b:c'), env)).status,
    ).toBe(401)
    expect(
      (
        await from(
          d,
          ANTHROPIC_IP,
          '/oauth/register',
          { method: 'POST', body: '{}' },
          env,
        )
      ).status,
    ).not.toBe(429)
    expect(general.keys).toEqual([])
    expect(signIn.keys).toEqual([])
  })

  test("pages a person's browser loads are limited even from Anthropic's addresses", async () => {
    const d = deployment()
    const general = recording(false)
    const signIn = recording(false)
    const env = { LIMITER: general.limiter, SIGN_IN_LIMITER: signIn.limiter }
    for (const path of ['/authorize', '/change-code'])
      expect(
        (await from(d, ANTHROPIC_IP, path, { method: 'POST', body: '' }, env))
          .status,
        path,
      ).toBe(429)
    expect(general.keys).toEqual([ANTHROPIC_IP, ANTHROPIC_IP])
  })
})

describe('anonymous saved wallets', () => {
  test('start a wallet, use it, and find it encrypted at rest', async () => {
    const d = deployment()
    const { token, code } = await startWallet(d)
    expect(normalizeRecoveryCode(code)).toBe(code)

    const client = await connect(d, token)
    const added = await client.callTool({
      name: 'add_card',
      arguments: { cardId: 'amex-gold', checkoutLabel: 'Gold' },
    })
    expect(added.isError).toBeFalsy()
    const best = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Whole Foods', amount: 50 },
    })
    expect(
      (best.structuredContent as { decision: { cardId: string } }).decision
        .cardId,
    ).toBe('amex-gold')

    const [storage] = [...d.storages.values()]
    const stored = JSON.stringify([...(storage?.values ?? [])])
    expect(stored).not.toContain('amex-gold')
    expect(stored).not.toContain('Gold')
    expect(storage?.alarm).toBeGreaterThan(Date.now() + 390 * 24 * 3600_000)
  })

  test('add_card saves an opening date in the hosted wallet', async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const client = await connect(d, token)
    const added = await client.callTool({
      name: 'add_card',
      arguments: {
        cardId: 'discover-it-cash-back',
        opened: '2026-03-04',
        activated: ['q4-2026-restaurants'],
      },
    })
    expect(added.isError).toBeFalsy()
    const best = await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Chipotle', channel: 'in_store' },
    })
    expect(
      (best.structuredContent as { decision: { effectiveReturnPct: number } })
        .decision.effectiveReturnPct,
    ).toBeCloseTo(10)
    const cleared = await client.callTool({
      name: 'update_card',
      arguments: { cardId: 'discover-it-cash-back', opened: null },
    })
    expect(text(cleared)).toMatch(/opening date cleared/)
  })

  test('the recovery code reconnects the wallet from another app', async () => {
    const d = deployment()
    const first = await startWallet(d)
    await (
      await connect(d, first.token)
    ).callTool({ name: 'add_card', arguments: { cardId: 'chase-prime-visa' } })

    const typed = first.code.toLowerCase().replace(/-/g, ' ')
    const token = await signIn(
      d,
      async (_page, post) => {
        const wrong = await post({ choice: 'recover', code: newRecoveryCode() })
        expect(wrong.status).toBe(400)
        expect(await wrong.text()).toContain('No saved wallet matches')
        const res = await post({ choice: 'recover', code: typed })
        expect(res.status).toBe(302)
        return res.headers.get('location') ?? ''
      },
      'Claude Code',
    )
    const listed = await (
      await connect(d, token)
    ).callTool({ name: 'list_wallet', arguments: {} })
    expect(text(listed)).toContain('chase-prime-visa')
  })

  test('delete_wallet erases it and signs out every app', async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const client = await connect(d, token)
    await client.callTool({
      name: 'add_card',
      arguments: { cardId: 'amex-gold' },
    })
    const deleted = await client.callTool({
      name: 'delete_wallet',
      arguments: { confirm: true, cards: 1 },
    })
    expect(deleted.isError).toBeFalsy()
    const [storage] = [...d.storages.values()]
    expect(storage?.values.size).toBe(0)
    expect(storage?.alarm).toBeNull()
    const after = await d.fetch('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: callTool('list_wallet'),
    })
    expect(after.status).toBe(401)
  })

  test('a token for a deleted wallet is refused even if revoking it failed', async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const [storage] = [...d.storages.values()]
    await storage?.deleteAll()
    expect((await post(d, '/', callTool('list_wallet'), token)).status).toBe(
      401,
    )
    const question = await post(
      d,
      '/',
      callTool('best_card_for_purchase', { merchant: 'Costco' }),
      token,
    )
    expect(question.status).toBe(401)
  })

  test('a delete replayed after signing in to a new wallet deletes nothing', async () => {
    const d = deployment()
    const first = await startWallet(d)
    const client = await connect(d, first.token)
    await client.callTool({
      name: 'add_card',
      arguments: { cardId: 'amex-gold' },
    })
    const deleted = await client.callTool({
      name: 'delete_wallet',
      arguments: { confirm: true, cards: 1 },
    })
    expect(deleted.isError).toBeFalsy()

    const next = await startWallet(d)
    const replayed = await (
      await connect(d, next.token)
    ).callTool({
      name: 'delete_wallet',
      arguments: { confirm: true, cards: 1 },
    })
    expect(replayed.isError).toBe(true)
    expect(text(replayed)).toMatch(
      /holds nothing, not what the user confirmed \(1 card\)/,
    )
    expect(
      (await post(d, '/', callTool('list_wallet'), next.token)).status,
    ).toBe(200)
  })

  test('switch_wallet signs this app out and keeps the wallet', async () => {
    const d = deployment()
    const { token, code } = await startWallet(d)
    const client = await connect(d, token)
    await client.callTool({
      name: 'add_card',
      arguments: { cardId: 'amex-gold' },
    })
    const switched = await client.callTool({
      name: 'switch_wallet',
      arguments: {},
    })
    expect(switched.isError).toBeFalsy()
    expect((await post(d, '/', callTool('list_wallet'), token)).status).toBe(
      401,
    )
    const again = await signIn(d, async (_page, post) => {
      const res = await post({ choice: 'recover', code })
      return res.headers.get('location') ?? ''
    })
    const listed = await (
      await connect(d, again)
    ).callTool({ name: 'list_wallet', arguments: {} })
    expect(text(listed)).toContain('amex-gold')
  })

  test('right after switch_wallet the same token is refused, while KV still has it', async () => {
    const d = deployment({ kvLag: true })
    const { token, code } = await startWallet(d)
    const other = await signIn(
      d,
      async (_page, post) => {
        const res = await post({ choice: 'recover', code })
        return res.headers.get('location') ?? ''
      },
      'Another app',
    )
    const switched = await (
      await connect(d, token)
    ).callTool({ name: 'switch_wallet', arguments: {} })
    expect(switched.isError).toBeFalsy()
    const kv = d.env.OAUTH_KV as ReturnType<typeof memoryKv>
    expect((await kv.list({ prefix: 'grant:' })).keys).toHaveLength(2)

    expect((await post(d, '/', callTool('list_wallet'), token)).status).toBe(
      401,
    )
    const question = await post(
      d,
      '/',
      callTool('best_card_for_purchase', { merchant: 'Costco' }),
      token,
    )
    expect(question.status).toBe(401)
    expect((await post(d, '/', callTool('list_wallet'), other)).status).toBe(
      200,
    )
  })

  test('an empty wallet can be deleted when the user confirms it is empty', async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const deleted = await (
      await connect(d, token)
    ).callTool({
      name: 'delete_wallet',
      arguments: { confirm: true, cards: 0 },
    })
    expect(deleted.isError).toBeFalsy()
    const [storage] = [...d.storages.values()]
    expect(storage?.values.size).toBe(0)
  })

  test("an app's own setup requests don't count as using a new wallet", async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const [storage] = [...d.storages.values()]
    await (await connect(d, token)).listTools()
    expect(storage?.alarm).toBeLessThan(Date.now() + 8 * 24 * 3600_000)
  })

  test('questions alone keep a wallet from being deleted as unused', async () => {
    const d = deployment()
    const { token } = await startWallet(d)
    const [storage] = [...d.storages.values()]
    expect(storage?.alarm).toBeLessThan(Date.now() + 8 * 24 * 3600_000)
    await (
      await connect(d, token)
    ).callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Costco' },
    })
    expect(storage?.alarm).toBeGreaterThan(Date.now() + 390 * 24 * 3600_000)
  })

  test('connections made at the old /mcp address keep working', async () => {
    const d = deployment()
    const token = await signIn(
      d,
      async (_page, post) => {
        const res = await post({ choice: 'new' })
        const html = await res.text()
        return unescape(/class="button" href="([^"]+)"/.exec(html)?.[1] ?? '')
      },
      'Claude',
      ALIAS_RESOURCE,
    )
    const old = await connect(d, token, {}, '/mcp')
    const added = await old.callTool({
      name: 'add_card',
      arguments: { cardId: 'amex-gold' },
    })
    expect(added.isError).toBeFalsy()
    const listed = await (
      await connect(d, token)
    ).callTool({ name: 'list_wallet', arguments: {} })
    expect(text(listed)).toContain('amex-gold')
    const challenged = await d.fetch('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: callTool('list_wallet'),
    })
    expect(challenged.headers.get('www-authenticate')).toContain(
      'oauth-protected-resource/mcp"',
    )
  })

  test('changing the recovery code moves the wallet and signs out old apps', async () => {
    const d = deployment()
    const first = await startWallet(d)
    await (
      await connect(d, first.token)
    ).callTool({ name: 'add_card', arguments: { cardId: 'amex-gold' } })

    expect((await d.fetch('/change-code')).status).toBe(200)
    const change = (code: string) =>
      d.fetch('/change-code', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code }).toString(),
      })
    const wrong = await change(newRecoveryCode())
    expect(wrong.status).toBe(400)
    expect(await wrong.text()).toContain('No saved wallet matches')

    const changed = await change(first.code)
    expect(changed.status).toBe(200)
    const next = /<div class="code">([^<]+)<\/div>/.exec(
      await changed.text(),
    )?.[1]
    expect(next).toBeDefined()
    expect(next).not.toBe(first.code)

    const old = await d.fetch('/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${first.token}`,
      },
      body: callTool('list_wallet'),
    })
    expect(old.status).toBe(401)
    expect((await change(first.code)).status).toBe(400)

    const token = await signIn(d, async (_page, post) => {
      const res = await post({ choice: 'recover', code: next ?? '' })
      return res.headers.get('location') ?? ''
    })
    const listed = await (
      await connect(d, token)
    ).callTool({ name: 'list_wallet', arguments: {} })
    expect(text(listed)).toContain('amex-gold')
  })

  test('a sign-in failure is counted and answered plainly', async () => {
    const points: { blobs?: string[] }[] = []
    const broken = {
      ...memoryKv(),
      put: () => Promise.reject(new Error('KV write limit exceeded')),
    }
    const res = await deployment().fetch(
      '/oauth/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: [CALLBACK],
          token_endpoint_auth_method: 'none',
        }),
      },
      {
        OAUTH_KV: broken,
        USAGE: { writeDataPoint: (p) => points.push(p) },
      },
    )
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(points.map((p) => p.blobs)).toContainEqual([
      expect.stringMatching(/^error:\/oauth\/register(:[A-Za-z-]+)*$/),
      'signed-out',
    ])
  })

  test("a sign-in page failure is counted with its step and the error's type, never its message", async () => {
    const points: { blobs?: string[] }[] = []
    const kv = memoryKv()
    const d = deployment()
    const registered = await d.fetch(
      '/oauth/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: [CALLBACK],
          token_endpoint_auth_method: 'none',
        }),
      },
      { OAUTH_KV: kv },
    )
    const { client_id: clientId } = (await registered.json()) as {
      client_id: string
    }
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
      state: 'state-123',
      scope: 'wallet',
    })
    const res = await d.fetch(`/authorize?${query.toString()}`, undefined, {
      OAUTH_KV: {
        ...kv,
        put: () =>
          Promise.reject(new TypeError('state-123 could not be saved')),
      },
      USAGE: { writeDataPoint: (p) => points.push(p) },
    })
    expect(res.status).toBe(503)
    const labels = points.map((p) => p.blobs?.[0] ?? '')
    expect(labels).toEqual(['error:/authorize:page:TypeError'])
    expect(labels.join(' ')).not.toContain('state-123')
  })

  test('cancel goes back to the app with access_denied', async () => {
    const d = deployment()
    await expect(
      signIn(d, async (_page, post) => {
        const res = await post({ choice: 'deny' })
        expect(res.status).toBe(302)
        const back = new URL(res.headers.get('location') ?? '')
        expect(back.searchParams.get('error')).toBe('access_denied')
        throw new Error('denied')
      }),
    ).rejects.toThrow('denied')
  })

  test('sign-in pages allow only their own script', async () => {
    expect(() => new Script(PAGE_SCRIPT)).not.toThrow()
    expect(PAGE_SCRIPT_HASH).toBe(
      `sha256-${createHash('sha256').update(PAGE_SCRIPT).digest('base64')}`,
    )
    const d = deployment()
    await expect(
      signIn(d, async (_page, post) => {
        const res = await post({ choice: 'new' })
        const csp = res.headers.get('content-security-policy') ?? ''
        expect(csp).toContain(`script-src '${PAGE_SCRIPT_HASH}'`)
        expect(csp).not.toMatch(/script-src[^;]*unsafe/)
        expect(await res.text()).toContain(`<script>${PAGE_SCRIPT}</script>`)
        throw new Error('stop')
      }),
    ).rejects.toThrow('stop')
  })

  test("the sign-in page escapes the app's self-chosen name", async () => {
    const d = deployment()
    await expect(
      signIn(
        d,
        (page) => {
          expect(page.split('<script>')).toHaveLength(2)
          expect(page).toContain(`<script>${PAGE_SCRIPT}</script>`)
          expect(page).toContain('&#60;script&#62;')
          expect(page).toContain("isn't verified")
          expect(page).toContain(
            'Continue only if you just started connecting earnrate from <strong>claude.ai</strong>. If someone sent you this link, close this page.',
          )
          throw new Error('stop')
        },
        '<script>alert(1)</script>',
      ),
    ).rejects.toThrow('stop')
  })
})

describe('wallet vault', () => {
  test('recovery codes normalize what people type', () => {
    const code = newRecoveryCode()
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){4}[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ''))).toBe(
      code,
    )
    expect(normalizeRecoveryCode('o0iI1-LLLLL-00000-11111-22222')).toBe(
      '00111-11111-00000-11111-22222',
    )
    expect(normalizeRecoveryCode('too short')).toBeNull()
    expect(normalizeRecoveryCode('UUUUU-UUUUU-UUUUU-UUUUU-UUUUU')).toBeNull()
  })

  test('only the right recovery code unwraps the wallet key', async () => {
    const keys = await keysFromCode(newRecoveryCode())
    const walletKey = newWalletKey()
    const wrapped = await wrapWalletKey(walletKey, keys)
    expect(await unwrapWalletKey(wrapped, keys)).toBe(walletKey)
    expect(
      await unwrapWalletKey(wrapped, await keysFromCode(newRecoveryCode())),
    ).toBeNull()
  })

  test("a wrong key can't read the wallet, and changes don't overwrite each other", async () => {
    const storage = memoryStorage()
    const vault = new WalletVault(storage, catalog, () => Date.UTC(2026, 9, 30))
    const keys = await keysFromCode(newRecoveryCode())
    const walletKey = newWalletKey()
    expect(
      await vault.create(keys.walletId, await wrapWalletKey(walletKey, keys)),
    ).toBe(true)
    expect(await vault.create(keys.walletId, 'again')).toBe(false)
    expect(storage.alarm).toBe(Date.UTC(2026, 10, 6))

    await Promise.all([
      vault.addCard(walletKey, { id: 'amex-gold' }, TODAY),
      vault.addCard(walletKey, { id: 'chase-prime-visa' }, TODAY),
    ])
    expect(storage.alarm).toBe(Date.UTC(2027, 10, 30))
    const wallet = await vault.load(walletKey)
    expect(wallet?.cards.map((c) => c.id).sort()).toEqual([
      'amex-gold',
      'chase-prime-visa',
    ])
    await expect(vault.load(newWalletKey())).rejects.toThrow()
  })

  test('signed-out grants are kept as hashes and dropped once they would have expired', async () => {
    const storage = memoryStorage()
    let now = Date.UTC(2026, 10, 3)
    const vault = new WalletVault(storage, catalog, () => now)
    const keys = await keysFromCode(newRecoveryCode())
    await vault.create(keys.walletId, await wrapWalletKey(newWalletKey(), keys))
    await vault.signOutGrants([
      { id: 'grant-a', expiresAt: now + 60_000 },
      { id: 'grant-b', expiresAt: null },
    ])
    const stored = storage.values.get('signed-out') as Record<string, number>
    expect(Object.keys(stored)).toHaveLength(2)
    for (const key of Object.keys(stored)) expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(stored)).not.toContain('grant-')
    expect(Object.values(stored)).toContain(now + 90 * 24 * 60 * 60 * 1000)

    expect(await vault.checkIn(false, 'grant-a')).toBe('refused')
    expect(await vault.checkIn(false, 'grant-b')).toBe('refused')
    expect(await vault.checkIn(false, 'grant-c')).toBe('ok')

    now += 120_000
    expect(await vault.checkIn(false, 'grant-a')).toBe('ok')
    expect(await vault.checkIn(false, 'grant-b')).toBe('refused')
    expect(
      Object.keys(storage.values.get('signed-out') as object),
    ).toHaveLength(1)
  })
})

type SiteTokens = { access_token: string; refresh_token: string }

// What earnrate.dev's Worker does: send the browser to /authorize with the
// site's fixed client id, then trade the code. No registration.
async function siteSignIn(
  d: ReturnType<typeof deployment>,
  choose: (
    page: string,
    post: (fields: Record<string, string>) => Promise<Response>,
  ) => Promise<string>,
  callback = SITE_CALLBACKS[0] ?? '',
): Promise<SiteTokens> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  )
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: SITE_CLIENT_ID,
    redirect_uri: callback,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'site-state',
    scope: 'wallet',
    resource: RESOURCE,
  })
  const path = `/authorize?${query.toString()}`
  const shown = await d.fetch(path)
  expect(shown.status).toBe(200)
  const cookie = shown.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const page = await shown.text()
  const handle = unescape(/name="handle" value="([^"]+)"/.exec(page)?.[1] ?? '')
  const post = (fields: Record<string, string>) =>
    d.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: new URLSearchParams({ handle, ...fields }).toString(),
      redirect: 'manual',
    })
  const back = new URL(await choose(page, post))
  expect(back.origin + back.pathname).toBe(callback)
  expect(back.searchParams.get('state')).toBe('site-state')
  const tokens = await d.fetch('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code') ?? '',
      redirect_uri: callback,
      client_id: SITE_CLIENT_ID,
      code_verifier: verifier,
      resource: RESOURCE,
    }).toString(),
  })
  expect(tokens.status).toBe(200)
  return (await tokens.json()) as SiteTokens
}

type Post = (fields: Record<string, string>) => Promise<Response>

const newWallet = async (_page: string, post: Post) => {
  const html = await (await post({ choice: 'new' })).text()
  return unescape(/class="button" href="([^"]+)"/.exec(html)?.[1] ?? '')
}

const recover = (code: string) => async (_page: string, post: Post) =>
  (await post({ choice: 'recover', code })).headers.get('location') ?? ''

type WalletBody = {
  wallet?: { cards: { id: string }[]; memberships: string[] }
  summary?: { checklist: unknown; started: string | null }
  message?: string
  error?: string
}

const getWallet = async (
  d: ReturnType<typeof deployment>,
  token?: string,
  extra: Partial<Env> = {},
) => {
  const res = await d.fetch(
    '/wallet',
    { headers: token ? { authorization: `Bearer ${token}` } : {} },
    extra,
  )
  const body = (
    res.headers.get('content-type')?.includes('json') ? await res.json() : {}
  ) as WalletBody
  return { status: res.status, res, body }
}

const changeWallet = async (
  d: ReturnType<typeof deployment>,
  token: string | undefined,
  tool: string,
  input: Record<string, unknown> = {},
) => {
  const res = await d.fetch('/wallet/changes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ tool, input }),
  })
  return { status: res.status, res, body: (await res.json()) as WalletBody }
}

// The site and Claude connected to one wallet, as after "Start a wallet" on
// earnrate.dev and the recovery code typed in Claude.
async function siteAndClaude(d: ReturnType<typeof deployment>) {
  let code = ''
  const site = await siteSignIn(d, async (_page, post) => {
    const html = await (await post({ choice: 'new' })).text()
    code = /<div class="code">([^<]+)<\/div>/.exec(html)?.[1] ?? ''
    return unescape(/class="button" href="([^"]+)"/.exec(html)?.[1] ?? '')
  })
  const claudeToken = await signIn(d, recover(code))
  return { site, code, claude: await connect(d, claudeToken), claudeToken }
}

describe('earnrate.dev sync', () => {
  test('the site signs in with its fixed client, named as earnrate.dev on the page', async () => {
    const d = deployment()
    let shown = ''
    const site = await siteSignIn(d, async (page, post) => {
      shown = page
      return newWallet(page, post)
    })
    expect(shown).toContain('published by <strong>earnrate.dev</strong>')
    expect(shown).not.toContain('class="warn"')
    const { status, body } = await getWallet(d, site.access_token)
    expect(status).toBe(200)
    expect(body.wallet?.cards).toEqual([])
    expect(body.summary?.started).toMatch(/^\d{4}-/)

    const preview = await siteSignIn(d, newWallet, SITE_CALLBACKS[1])
    expect((await getWallet(d, preview.access_token)).status).toBe(200)
  })

  test('a redirect URI the site client does not have is refused', async () => {
    const d = deployment()
    for (const redirect of [
      'https://evil.example/api/callback',
      'https://earnrate.dev/api/callback/../steal',
      'https://earnrate.dev/other',
      'http://earnrate.dev/api/callback',
    ]) {
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: SITE_CLIENT_ID,
        redirect_uri: redirect,
        code_challenge: 'x'.repeat(43),
        code_challenge_method: 'S256',
        state: 's',
        scope: 'wallet',
      })
      const res = await d.fetch(`/authorize?${query.toString()}`, {
        redirect: 'manual',
      })
      expect(res.status, redirect).toBe(400)
      expect(res.headers.get('location'), redirect).toBeNull()
    }
  })

  test('no other app may register a callback on earnrate.dev', async () => {
    const d = deployment()
    for (const uri of [
      'https://earnrate.dev/api/callback',
      'https://preview.earnrate.dev/api/callback',
    ]) {
      const res = await d.fetch('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'earnrate.dev',
          redirect_uris: [uri],
          token_endpoint_auth_method: 'none',
        }),
      })
      expect(res.status, uri).toBe(400)
    }
  })

  test("the site's registration can't be changed through storage", async () => {
    const kv = memoryKv()
    const wrapped = withSiteClient(kv) as typeof kv
    await wrapped.put(`client:${SITE_CLIENT_ID}`, '{"redirectUris":[]}')
    await wrapped.delete(`client:${SITE_CLIENT_ID}`)
    const record = (await wrapped.get(`client:${SITE_CLIENT_ID}`, {
      type: 'json',
    })) as { redirectUris: string[] }
    expect(record.redirectUris).toEqual(SITE_CALLBACKS)
    expect(await kv.get(`client:${SITE_CLIENT_ID}`)).toBeNull()
    await wrapped.put('other', 'kept')
    expect(await kv.get('other')).toBe('kept')
  })

  test('the wallet API asks for sign-in without a token or with a bad one', async () => {
    const d = deployment()
    for (const token of [undefined, 'not-a-token', 'a:b:c']) {
      const read = await getWallet(d, token)
      expect(read.status).toBe(401)
      expect(read.res.headers.get('www-authenticate')).toContain(
        'resource_metadata=',
      )
      const changed = await changeWallet(d, token, 'add_card', {
        cardId: 'amex-gold',
      })
      expect(changed.status).toBe(401)
    }
    const { site } = await siteAndClaude(d)
    expect((await getWallet(d, site.access_token)).status).toBe(200)
    const wrong = await d.fetch('/wallet/changes', {
      headers: { authorization: `Bearer ${site.access_token}` },
    })
    expect(wrong.status).toBe(404)
  })

  test('GET /wallet gives what list_wallet gives', async () => {
    const d = deployment()
    const { site, claude } = await siteAndClaude(d)
    await claude.callTool({
      name: 'add_card',
      arguments: { cardId: 'chase-freedom-flex' },
    })
    const { body } = await getWallet(d, site.access_token)
    const listed = await claude.callTool({ name: 'list_wallet', arguments: {} })
    expect(body.wallet?.cards.map((c) => c.id)).toEqual(['chase-freedom-flex'])
    expect(body.summary).toEqual(listed.structuredContent)
    expect(body.summary?.checklist).toBeDefined()
  })

  test('each change goes through the MCP tool, with its words and refusals', async () => {
    const d = deployment()
    const { site, claude } = await siteAndClaude(d)
    const token = site.access_token

    const added = await changeWallet(d, token, 'add_card', {
      cardId: 'amex-gold',
    })
    expect(added.status).toBe(200)
    expect(added.body.message).toMatch(/^Added .*\(amex-gold\)/)
    expect(added.body.wallet?.cards.map((c) => c.id)).toEqual(['amex-gold'])

    const refusals: [string, Record<string, unknown>][] = [
      ['add_card', { cardId: 'not-a-card' }],
      ['update_card', { cardId: 'chase-freedom-flex', checkoutLabel: 'x' }],
      ['remove_card', { cardId: 'chase-freedom-flex' }],
      ['set_point_values', { values: { NOPE: 1 } }],
      ['set_point_values', {}],
      [
        'record_purchase',
        { cardId: 'citi-double-cash', merchant: 'Costco', amount: 5 },
      ],
      [
        'record_purchase',
        { cardId: 'amex-gold', merchant: 'Zzyzx Qorp', amount: 5 },
      ],
      ['import_wallet', { yaml: 'cards:\n  - id: citi-double-cash\n' }],
      ['import_wallet', { yaml: 'not: [a wallet' }],
    ]
    for (const [tool, input] of refusals) {
      const api = await changeWallet(d, token, tool, input)
      const mcp = await claude.callTool({ name: tool, arguments: input })
      expect(api.status, tool).toBe(422)
      expect(mcp.isError, tool).toBe(true)
      expect(api.body.error, tool).toBe(text(mcp))
    }

    const updated = await changeWallet(d, token, 'update_card', {
      cardId: 'amex-gold',
      checkoutLabel: 'Gold',
    })
    expect(updated.body.message).toContain('checkout name "Gold"')
    const members = await changeWallet(d, token, 'set_memberships', {
      memberships: ['costco'],
    })
    expect(members.body.wallet?.memberships).toEqual(['costco'])
    const values = await changeWallet(d, token, 'set_point_values', {
      values: { MR: 1.8 },
    })
    expect(values.status).toBe(200)
    const recorded = await changeWallet(d, token, 'record_purchase', {
      cardId: 'amex-gold',
      merchant: 'Whole Foods',
      amount: 100,
    })
    expect(recorded.status).toBe(200)
    expect(recorded.body.message).toBeDefined()
    const removed = await changeWallet(d, token, 'remove_card', {
      cardId: 'amex-gold',
    })
    expect(removed.body.wallet?.cards).toEqual([])

    const replaced = await changeWallet(d, token, 'import_wallet', {
      yaml: 'cards:\n  - id: citi-double-cash\n',
      replace: true,
    })
    expect(replaced.status).toBe(200)
    expect(replaced.body.message).toMatch(/^Replaced what was saved/)
    expect(replaced.body.wallet?.cards.map((c) => c.id)).toEqual([
      'citi-double-cash',
    ])
    const listed = await claude.callTool({ name: 'list_wallet', arguments: {} })
    expect(text(listed)).toContain('citi-double-cash')
  })

  test('a malformed change is refused before it reaches the wallet', async () => {
    const d = deployment()
    const { site } = await siteAndClaude(d)
    const token = site.access_token
    expect((await changeWallet(d, token, 'delete_wallet')).status).toBe(400)
    expect((await changeWallet(d, token, 'switch_wallet')).status).toBe(400)
    const bad = await changeWallet(d, token, 'add_card', { cardId: 5 })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/^Invalid input for add_card/)
    const notJson = await d.fetch('/wallet/changes', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: '{',
    })
    expect(notJson.status).toBe(400)
    const big = await d.fetch('/wallet/changes', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        tool: 'add_card',
        input: { x: 'a'.repeat(70_000) },
      }),
    })
    expect(big.status).toBe(413)
    expect((await getWallet(d, token)).body.wallet?.cards).toEqual([])
  })

  test('two changes at once both land', async () => {
    const d = deployment()
    const { site, claude } = await siteAndClaude(d)
    await Promise.all([
      changeWallet(d, site.access_token, 'add_card', { cardId: 'amex-gold' }),
      changeWallet(d, site.access_token, 'add_card', {
        cardId: 'citi-double-cash',
      }),
      claude.callTool({
        name: 'add_card',
        arguments: { cardId: 'chase-freedom-flex' },
      }),
    ])
    const { body } = await getWallet(d, site.access_token)
    expect(body.wallet?.cards.map((c) => c.id).sort()).toEqual([
      'amex-gold',
      'chase-freedom-flex',
      'citi-double-cash',
    ])
  })

  test('deleting the wallet in Claude signs the site out', async () => {
    const d = deployment()
    const { site, claude } = await siteAndClaude(d)
    const deleted = await claude.callTool({
      name: 'delete_wallet',
      arguments: { confirm: true, cards: 0 },
    })
    expect(deleted.isError).toBeFalsy()
    expect((await getWallet(d, site.access_token)).status).toBe(401)
    const refreshed = await d.fetch('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: site.refresh_token,
        client_id: SITE_CLIENT_ID,
      }).toString(),
    })
    expect(refreshed.status).toBe(400)
  })

  test('changing the recovery code signs the site out', async () => {
    const d = deployment()
    const { site, code } = await siteAndClaude(d)
    const changed = await d.fetch('/change-code', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code }).toString(),
    })
    expect(changed.status).toBe(200)
    expect((await getWallet(d, site.access_token)).status).toBe(401)
  })

  test("switch_wallet in Claude leaves the site's connection alone", async () => {
    const d = deployment()
    const { site, claude, claudeToken } = await siteAndClaude(d)
    await claude.callTool({ name: 'switch_wallet', arguments: {} })
    expect(
      (await post(d, '/', callTool('list_wallet'), claudeToken)).status,
    ).toBe(401)
    expect((await getWallet(d, site.access_token)).status).toBe(200)
  })

  test("signing out one browser ends only that browser's connection, at once", async () => {
    const d = deployment({ kvLag: true })
    const { site, code, claudeToken } = await siteAndClaude(d)
    const phone = await siteSignIn(d, recover(code))
    const out = await d.fetch('/wallet/sign-out', {
      method: 'POST',
      headers: { authorization: `Bearer ${site.access_token}` },
    })
    expect(out.status).toBe(204)
    expect((await getWallet(d, site.access_token)).status).toBe(401)
    expect((await getWallet(d, phone.access_token)).status).toBe(200)
    expect(
      (await post(d, '/', callTool('list_wallet'), claudeToken)).status,
    ).toBe(200)
  })

  test('the wallet API is limited per wallet, and per address without a token', async () => {
    const d = deployment()
    const { site } = await siteAndClaude(d)
    const keys: string[] = []
    const limiter = (success: boolean) => ({
      limit: ({ key }: { key: string }) => {
        keys.push(key)
        return Promise.resolve({ success })
      },
    })
    const ip = { 'cf-connecting-ip': '203.0.113.7' }
    const ok = await d.fetch(
      '/wallet',
      { headers: { authorization: `Bearer ${site.access_token}`, ...ip } },
      { LIMITER: limiter(true) },
    )
    expect(ok.status).toBe(200)
    expect(keys).toEqual([expect.stringMatching(/^wallet:/)])
    const over = await getWallet(d, site.access_token, {
      LIMITER: limiter(false),
    })
    expect(over.status).toBe(429)
    keys.length = 0
    const anonymous = await d.fetch(
      '/wallet',
      { headers: ip },
      { LIMITER: limiter(false) },
    )
    expect(anonymous.status).toBe(429)
    expect(keys).toEqual(['203.0.113.7'])
    keys.length = 0
    const bad = await d.fetch(
      '/wallet',
      { headers: { authorization: 'Bearer w:g:s', ...ip } },
      { SIGN_IN_LIMITER: limiter(false) },
    )
    expect(bad.status).toBe(429)
    expect(keys).toEqual([expect.stringMatching(/^grant:/)])
  })

  test('the site is counted as its own kind of app, never with wallet contents', async () => {
    const points: { blobs?: string[]; indexes?: string[] }[] = []
    const d = deployment()
    d.env.USAGE = { writeDataPoint: (p) => points.push(p) }
    const site = await siteSignIn(d, newWallet)
    await changeWallet(d, site.access_token, 'add_card', {
      cardId: 'amex-gold',
      checkoutLabel: 'Secret Label',
    })
    await changeWallet(d, site.access_token, 'record_purchase', {
      cardId: 'amex-gold',
      merchant: 'Zzyzx Qorp',
      amount: 77.77,
    })
    await getWallet(d, site.access_token)
    const blobs = points.map((p) => p.blobs)
    expect(blobs).toContainEqual(['wallet-created', 'site'])
    expect(blobs).toContainEqual(['wallet-active', 'site'])
    expect(blobs).toContainEqual(['tool:add_card', 'site'])
    expect(blobs).toContainEqual(['tool:list_wallet', 'site'])
    expect(blobs).toContainEqual(['tool-error:record_purchase', 'site'])
    const recorded = JSON.stringify(points)
    for (const secret of ['Secret', 'Zzyzx', '77.77', 'amex-gold'])
      expect(recorded).not.toContain(secret)
  })

  test("only earnrate's own client and callbacks count as the site", () => {
    expect(
      appKind({ clientId: SITE_CLIENT_ID, redirectUris: SITE_CALLBACKS }),
    ).toBe('site')
    expect(
      appKind({
        clientId: 'abc',
        redirectUris: ['https://earnrate.dev/api/callback'],
        clientName: 'earnrate.dev',
      }),
    ).toBe('other')
    expect(
      appKind({
        clientId: SITE_CLIENT_ID,
        redirectUris: ['https://evil.example/api/callback'],
      }),
    ).toBe('other')
  })
})
