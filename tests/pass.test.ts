import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unzipSync } from 'fflate'
import forge from 'node-forge'
import { beforeAll, describe, expect, test } from 'vitest'
import { makePassWorker, type PassEnv } from '../pass/src/app.ts'
import { passContents, type PassWallet } from '../pass/src/pass.ts'
import { makeRenderer } from '../pass/src/render.ts'
import { cardFit, stripSvg } from '../pass/src/strip.ts'
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
let renderPng: ReturnType<typeof makeRenderer>

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
  const fonts = await Promise.all(
    ['Inter_400Regular.ttf', 'Inter_600SemiBold.ttf', 'Inter_700Bold.ttf'].map(
      async (f) =>
        new Uint8Array(
          await readFile(
            path.join(ROOT, 'node_modules/@expo-google-fonts/inter', f),
          ),
        ),
    ),
  )
  renderPng = makeRenderer(
    await readFile(
      path.join(ROOT, 'node_modules/@resvg/resvg-wasm/index_bg.wasm'),
    ),
    fonts,
  )
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
    renderPng,
    now: () => new Date('2026-11-03T20:00:00Z'),
  })

describe('the cheat-sheet pass', () => {
  test('its strip and fields come from the cheat sheet for those cards', () => {
    const { pass, strip } = passContents(
      catalog,
      WALLET,
      '2026-11-03',
      IDENTITY,
      'serial-1',
    )
    const sheet = cheatSheet(
      catalog,
      WalletSchema.parse({ cards: WALLET.cards }),
      '2026-11-03',
    )
    expect(strip.map((r) => r.label)).toEqual([
      'Groceries',
      'Dining',
      'Gas',
      'Amazon',
      'Costco',
      'Everything else',
    ])
    const groceries = sheet.rows.find((r) => r.label === 'Groceries')
    expect(strip[0]).toEqual({
      label: 'Groceries',
      card: 'Amex Gold',
      rate: pct(groceries?.effectiveReturnPct ?? 0),
    })
    expect(strip.find((r) => r.label === 'Costco')?.card).toBe('Blue card')
    expect(strip.find((r) => r.label === 'Gas')?.card).not.toMatch(/^Chase /)
    const card = pass.storeCard as {
      headerFields: { value: string }[]
      secondaryFields: { label: string; value: string }[]
      auxiliaryFields: { label: string; value: string }[]
      backFields: { key: string; label: string; value: string }[]
    }
    expect(card.headerFields[0]?.value).toBe('Q4 2026')
    expect(card.secondaryFields[0]?.value).toBe(
      'Activate Freedom Flex by Dec 14',
    )
    expect(card.auxiliaryFields[0]?.value).toBe('Dec 31, 2026')
    expect(card.backFields.map((f) => f.label)).toContain('Streaming (Netflix)')
    expect(card.backFields.find((f) => f.key === 'refresh')?.value).toContain(
      'https://earnrate.dev/#wallet',
    )
    expect(pass.expirationDate).toBe('2026-12-31T23:59:59-10:00')
    expect(pass).toMatchObject({ ...IDENTITY, serialNumber: 'serial-1' })
    expect(pass).not.toHaveProperty('barcodes')
  })

  test('the strip escapes text, shrinks long card names and cuts the longest', () => {
    const svg = stripSvg([{ label: 'Dining', card: 'A & <B>', rate: '4%' }])
    expect(svg).toContain('A &#38; &#60;B&#62;')
    expect(cardFit('Sapphire Preferred')).toEqual({
      text: 'Sapphire Preferred',
      size: 15,
    })
    const shrunk = cardFit('Bank of America Customized Cash')
    expect(shrunk.text).toBe('Bank of America Customized Cash')
    expect(shrunk.size).toBeGreaterThanOrEqual(12)
    expect(shrunk.size).toBeLessThan(15)
    const cut = cardFit('My everyday gold card for food and groceries')
    expect(cut.size).toBe(12)
    expect(cut.text.endsWith('…')).toBe(true)
    expect(cut.text.length).toBeLessThanOrEqual(32)
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
        'strip.png',
        'strip@2x.png',
        'strip@3x.png',
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
