import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unzipSync } from 'fflate'
import forge from 'node-forge'
import { beforeAll, describe, expect, test } from 'vitest'
import { makePassWorker, type PassEnv } from '../pass/src/app.ts'
import { passJson, type PassWallet } from '../pass/src/pass.ts'
import { loadCatalog } from '../src/data/load.ts'
import { cheatSheet } from '../src/engine/cheat-sheet.ts'
import { pct } from '../src/engine/text.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const ROOT = path.join(import.meta.dirname, '..')
const IDENTITY = {
  passTypeIdentifier: 'pass.dev.earnrate.test',
  teamIdentifier: 'TEAM123456',
}
const WALLET: PassWallet = {
  memberships: [],
  cards: [
    { id: 'amex-gold' },
    { id: 'chase-sapphire-preferred', checkout_label: 'Blue card' },
    { id: 'chase-freedom-flex' },
    { id: 'citi-double-cash' },
  ],
}

let catalog: Catalog
let env: PassEnv
let images: Record<string, Uint8Array>
let certPem: string

beforeAll(async () => {
  catalog = await loadCatalog()
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 86_400_000)
  const subject = [{ name: 'commonName', value: 'earnrate pass test' }]
  cert.setSubject(subject)
  cert.setIssuer(subject)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  certPem = forge.pki.certificateToPem(cert)
  env = {
    PASS_TYPE_ID: IDENTITY.passTypeIdentifier,
    TEAM_ID: IDENTITY.teamIdentifier,
    PASS_CERT_PEM: certPem,
    PASS_KEY_PEM: forge.pki.privateKeyToPem(keys.privateKey),
    WWDR_PEM: certPem,
  }
  const dir = path.join(ROOT, 'pass/assets')
  images = Object.fromEntries(
    await Promise.all(
      (await readdir(dir)).map(
        async (f) =>
          [f, new Uint8Array(await readFile(path.join(dir, f)))] as const,
      ),
    ),
  )
})

const post = (
  worker: ReturnType<typeof makePassWorker>,
  form: Record<string, string>,
  e: PassEnv = env,
) =>
  worker.fetch(
    new Request('https://pass.earnrate.dev/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    }),
    e,
  )

const worker = () =>
  makePassWorker({
    catalog,
    images,
    now: () => new Date('2026-11-03T20:00:00Z'),
  })

describe('the cheat-sheet pass', () => {
  test('its fields come from the cheat sheet for those cards', () => {
    const pass = passJson(catalog, WALLET, '2026-11-03', IDENTITY, 'serial-1')
    const sheet = cheatSheet(
      catalog,
      WalletSchema.parse({ cards: WALLET.cards }),
      '2026-11-03',
    )
    const generic = pass.generic as {
      headerFields: { value: string }[]
      secondaryFields: { label: string; value: string }[]
      auxiliaryFields: { label: string; value: string }[]
      backFields: { key: string; label: string; value: string }[]
    }
    expect(generic.headerFields[0]?.value).toBe('Q4 2026')
    const front = [...generic.secondaryFields, ...generic.auxiliaryFields]
    expect(front.map((f) => f.label)).toEqual([
      'Groceries',
      'Dining',
      'Gas',
      'Amazon',
      'Costco',
      'Everything else',
    ])
    const groceries = sheet.rows.find((r) => r.label === 'Groceries')
    expect(front[0]?.value).toBe(
      `Gold ${pct(groceries?.effectiveReturnPct ?? 0)}`,
    )
    expect(front.find((f) => f.label === 'Costco')?.value).toMatch(
      /^Blue card /,
    )
    expect(generic.backFields.map((f) => f.label)).toContain(
      'Streaming (Netflix)',
    )
    expect(
      generic.backFields.find((f) => f.key === 'refresh')?.value,
    ).toContain('https://earnrate.dev/#wallet')
    expect(pass.expirationDate).toBe('2026-12-31T23:59:59-10:00')
    expect(pass).toMatchObject({ ...IDENTITY, serialNumber: 'serial-1' })
  })

  test('the Worker returns a signed .pkpass whose manifest matches its files', async () => {
    const res = await post(worker(), {
      wallet: JSON.stringify(WALLET),
      date: '2026-11-03',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.pkpass')
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual(
      [
        'icon.png',
        'icon@2x.png',
        'icon@3x.png',
        'logo.png',
        'logo@2x.png',
        'logo@3x.png',
        'manifest.json',
        'pass.json',
        'signature',
      ].sort(),
    )
    const manifest = JSON.parse(
      new TextDecoder().decode(files['manifest.json']),
    ) as Record<string, string>
    for (const [name, hash] of Object.entries(manifest)) {
      const digest = await crypto.subtle.digest(
        'SHA-1',
        files[name] ?? new Uint8Array(),
      )
      expect(Buffer.from(digest).toString('hex'), name).toBe(hash)
    }
    const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-pass-'))
    await writeFile(
      path.join(dir, 'manifest.json'),
      files['manifest.json'] ?? '',
    )
    await writeFile(path.join(dir, 'signature'), files.signature ?? '')
    await writeFile(path.join(dir, 'ca.pem'), certPem)
    execFileSync(
      'openssl',
      [
        'cms',
        '-verify',
        '-binary',
        '-inform',
        'DER',
        '-in',
        path.join(dir, 'signature'),
        '-content',
        path.join(dir, 'manifest.json'),
        '-CAfile',
        path.join(dir, 'ca.pem'),
        '-purpose',
        'any',
        '-out',
        '/dev/null',
      ],
      { stdio: 'pipe' },
    )
  })

  test('the Worker refuses what it can’t make a pass from', async () => {
    const w = worker()
    expect((await post(w, { wallet: 'not json' })).status).toBe(400)
    expect(
      (
        await post(w, {
          wallet: JSON.stringify({ cards: [{ id: 'made-up-card' }] }),
        })
      ).status,
    ).toBe(400)
    expect(
      (await post(w, { wallet: JSON.stringify({ cards: [] }) })).status,
    ).toBe(400)
    expect(
      (
        await post(w, {
          wallet: JSON.stringify({
            cards: [{ id: 'amex-gold', cap_usage: {} }],
          }),
        })
      ).status,
    ).toBe(400)
    expect((await post(w, { wallet: 'x'.repeat(20_000) })).status).toBe(413)
    expect((await post(w, { wallet: JSON.stringify(WALLET) }, {})).status).toBe(
      503,
    )
    const get = await w.fetch(new Request('https://pass.earnrate.dev/'), env)
    expect(get.status).toBe(302)
    expect(get.headers.get('location')).toBe('https://earnrate.dev/#wallet')
    expect(
      (await w.fetch(new Request('https://pass.earnrate.dev/x'), env)).status,
    ).toBe(404)
  })

  test('the pass Worker has no storage and no logs', async () => {
    const config = await readFile(
      path.join(ROOT, 'pass/wrangler.jsonc'),
      'utf8',
    )
    expect(config).toContain('"observability": { "enabled": false }')
    expect(config).not.toMatch(
      /kv_namespaces|durable_objects|d1_databases|r2_buckets|analytics_engine/,
    )
  })
})
