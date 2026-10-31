import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, test } from 'vitest'
import { makeWorker, type Env } from '../remote/src/app.ts'
import { RESOURCE } from '../remote/src/auth.ts'
import {
  keysFromCode,
  newRecoveryCode,
  newWalletKey,
  normalizeRecoveryCode,
  unwrapWalletKey,
  wrapWalletKey,
} from '../remote/src/vault-crypto.ts'
import { WalletVault, type VaultStorage } from '../remote/src/vault.ts'
import { DATA_DIR, loadCatalog } from '../src/data/load.ts'
import { SAVED_WALLET_TOOLS } from '../src/mcp/server.ts'
import { TODAY } from './golden/fixtures.ts'

const ORIGIN = 'https://mcp.earnrate.dev'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const catalog = await loadCatalog()
const dataVersion = (await readFile(`${DATA_DIR}VERSION`, 'utf8')).trim()

function memoryStorage(): VaultStorage & {
  values: Map<string, unknown>
  alarm: number | null
} {
  const values = new Map<string, unknown>()
  const storage = {
    values,
    alarm: null as number | null,
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    put: (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
      return Promise.resolve()
    },
    delete: (key: string) => Promise.resolve(values.delete(key)),
    deleteAll: () => {
      values.clear()
      return Promise.resolve()
    },
    setAlarm: (at: number) => {
      storage.alarm = at
      return Promise.resolve()
    },
    deleteAlarm: () => {
      storage.alarm = null
      return Promise.resolve()
    },
  }
  return storage
}

function memoryKv() {
  const entries = new Map<string, { value: string; metadata?: unknown }>()
  return {
    get(key: string, options?: { type?: string } | string) {
      const found = entries.get(key)?.value ?? null
      const type = typeof options === 'string' ? options : options?.type
      return Promise.resolve(
        found !== null && type === 'json'
          ? (JSON.parse(found) as unknown)
          : found,
      )
    },
    put(key: string, value: string, options?: { metadata?: unknown }) {
      entries.set(key, { value, metadata: options?.metadata })
      return Promise.resolve()
    },
    delete(key: string) {
      entries.delete(key)
      return Promise.resolve()
    },
    list(options: { prefix?: string } = {}) {
      const keys = [...entries]
        .filter(([k]) => k.startsWith(options.prefix ?? ''))
        .map(([name, e]) => ({ name, metadata: e.metadata }))
      return Promise.resolve({ keys, list_complete: true, cacheStatus: null })
    },
  }
}

// One Worker with its own KV and wallet storage, like a fresh deploy.
function deployment() {
  const storages = new Map<string, ReturnType<typeof memoryStorage>>()
  const vaults = new Map<string, WalletVault>()
  const worker = makeWorker<Env>(
    { catalog, dataVersion, version: '0.0.0-test' },
    (_env, walletId) => {
      let vault = vaults.get(walletId)
      if (!vault) {
        const storage = memoryStorage()
        storages.set(walletId, storage)
        vault = new WalletVault(storage, catalog)
        vaults.set(walletId, vault)
      }
      return vault
    },
    () => TODAY,
  )
  const env: Env = { OAUTH_KV: memoryKv() }
  const ctx = { waitUntil: () => undefined }
  const fetch = (input: string | Request, init?: RequestInit, extra = {}) =>
    worker.fetch(
      typeof input === 'string'
        ? new Request(`${ORIGIN}${input}`, init)
        : input,
      { ...env, ...extra },
      ctx,
    )
  return { worker, env, fetch, storages }
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function connect(
  d: ReturnType<typeof deployment>,
  token: string | null = null,
  extra: Partial<Env> = {},
): Promise<Client> {
  const client = new Client(
    { name: 'earnrate-test', version: '0.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
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

function text(result: { content?: unknown }): string {
  const content = (result.content ?? []) as { type: string; text?: string }[]
  return content.map((c) => c.text ?? '').join('\n')
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
      resource: RESOURCE,
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

const callTool = (name: string, args: Record<string, unknown> = {}) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })

describe('remote connector, signed out', () => {
  test('lists every tool, saved-wallet ones included', async () => {
    const client = await connect(deployment())
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain('best_card_for_purchase')
    for (const name of SAVED_WALLET_TOOLS) expect(names).toContain(name)
  })

  test('answers from every card, or from cards named for one answer', async () => {
    const client = await connect(deployment())
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

  test('asks for sign-in only when a saved-wallet tool is called', async () => {
    const d = deployment()
    const res = await d.fetch('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: callTool('add_card', { cardId: 'amex-gold' }),
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="wallet"`,
    )
    const metadata = (await (
      await d.fetch('/.well-known/oauth-protected-resource/mcp')
    ).json()) as { resource: string; authorization_servers: string[] }
    expect(metadata).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [ORIGIN],
    })
  })

  test('refuses a token it did not issue', async () => {
    const res = await deployment().fetch('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer not-a-real-token',
      },
      body: callTool('best_card_for_purchase', { merchant: 'Costco' }),
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain(
      'error="invalid_token"',
    )
  })

  test('redirects the root to the website and 404s other paths', async () => {
    const d = deployment()
    const root = await d.fetch('/')
    expect(root.status).toBe(302)
    expect(root.headers.get('location')).toBe('https://earnrate.dev/')
    expect((await d.fetch('/wallet')).status).toBe(404)
  })

  test('refuses requests over the rate limit', async () => {
    const res = await deployment().fetch(
      '/mcp',
      { method: 'POST', body: '{}' },
      { LIMITER: { limit: () => Promise.resolve({ success: false }) } },
    )
    expect(res.status).toBe(429)
  })

  test('counts only the method and tool name, never arguments', async () => {
    const points: { blobs?: string[]; indexes?: string[] }[] = []
    const client = await connect(deployment(), null, {
      USAGE: { writeDataPoint: (p) => points.push(p) },
    })
    await client.callTool({
      name: 'best_card_for_purchase',
      arguments: { merchant: 'Trader Joes', amount: 123.45 },
    })
    expect(points.map((p) => p.blobs)).toContainEqual([
      'tool:best_card_for_purchase',
    ])
    const recorded = JSON.stringify(points)
    expect(recorded).not.toContain('Trader')
    expect(recorded).not.toContain('123')
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
      arguments: {},
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

  test("the sign-in page escapes the app's self-chosen name", async () => {
    const d = deployment()
    await expect(
      signIn(
        d,
        (page) => {
          expect(page).not.toContain('<script>')
          expect(page).toContain('&#60;script&#62;')
          expect(page).toContain("isn't verified")
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
    expect(storage.alarm).toBe(Date.UTC(2027, 10, 30))

    await Promise.all([
      vault.addCard(walletKey, { id: 'amex-gold' }, TODAY),
      vault.addCard(walletKey, { id: 'chase-prime-visa' }, TODAY),
    ])
    const wallet = await vault.load(walletKey)
    expect(wallet?.cards.map((c) => c.id).sort()).toEqual([
      'amex-gold',
      'chase-prime-visa',
    ])
    await expect(vault.load(newWalletKey())).rejects.toThrow()
  })
})
