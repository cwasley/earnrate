import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { deviceOf, EVENTS } from '../site/events.ts'
import preview from '../site/preview-worker.ts'
import worker, { type SiteEnv } from '../site/worker.ts'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) Safari'
const ANDROID = 'Mozilla/5.0 (Linux; Android 16; Pixel 10) Chrome/140 Mobile'

function site() {
  const points: { blobs?: string[]; indexes?: string[] }[] = []
  const env: SiteEnv = {
    ASSETS: { fetch: () => Promise.resolve(new Response('page')) },
    USAGE: { writeDataPoint: (p) => points.push(p) },
  }
  const send = (body: string, userAgent = IPHONE, method = 'POST') =>
    worker.fetch(
      new Request('https://earnrate.dev/count', {
        method,
        headers: { 'user-agent': userAgent, 'cf-connecting-ip': '203.0.113.9' },
        ...(method === 'POST' ? { body } : {}),
      }),
      env,
    )
  return { env, points, send }
}

describe('earnrate.dev counts', () => {
  test('a known event is counted with the kind of device and nothing else', async () => {
    const { points, send } = site()
    expect((await send('apple-wallet')).status).toBe(204)
    expect((await send('tab-wallet', ANDROID)).status).toBe(204)
    expect(points).toEqual([
      { blobs: ['apple-wallet', 'iphone'], indexes: ['apple-wallet'] },
      { blobs: ['tab-wallet', 'android'], indexes: ['tab-wallet'] },
    ])
    expect(JSON.stringify(points)).not.toContain('203.0.113')
  })

  test('anything that is not one of its event names is dropped', async () => {
    const { points, send } = site()
    await send('search=whole foods')
    await send('amex-gold')
    await send('tab-best'.repeat(20))
    expect((await send('', IPHONE, 'GET')).status).toBe(405)
    expect(points).toEqual([])
  })

  test('over the limit, events are dropped quietly', async () => {
    const { env, points, send } = site()
    env.LIMITER = { limit: () => Promise.resolve({ success: false }) }
    expect((await send('search')).status).toBe(204)
    expect(points).toEqual([])
  })

  test('every other path is the static site', async () => {
    const { env } = site()
    const res = await worker.fetch(new Request('https://earnrate.dev/'), env)
    expect(await res.text()).toBe('page')
  })

  test('device kinds are coarse', () => {
    expect(deviceOf(IPHONE)).toBe('iphone')
    expect(deviceOf(ANDROID)).toBe('android')
    expect(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)')).toBe(
      'desktop',
    )
    expect(deviceOf('curl/8.0')).toBe('other')
  })

  test('the privacy page lists every event the site counts', async () => {
    const privacy = await readFile(
      new URL('../site/privacy.html', import.meta.url),
      'utf8',
    )
    for (const event of EVENTS) expect(privacy, event).toContain(event)
  })

  test('the site Worker keeps no logs, stores nothing, and runs only for /count and /api/*', async () => {
    for (const file of ['../wrangler.jsonc', '../wrangler.preview.jsonc']) {
      const config = await readFile(new URL(file, import.meta.url), 'utf8')
      expect(config, file).toContain('"observability": { "enabled": false }')
      expect(config, file).not.toMatch(
        /kv_namespaces|durable_objects|d1_databases|r2_buckets|queues|vectorize|hyperdrive|secrets_store/,
      )
      // Its one binding beyond the files and counts: the hosted server.
      expect(config, file).toContain(
        '"services": [{ "binding": "MCP", "service": "earnrate-mcp" }]',
      )
    }
    const config = await readFile(
      new URL('../wrangler.jsonc', import.meta.url),
      'utf8',
    )
    expect(config).toContain('"run_worker_first": ["/count", "/api/*"]')
  })
})

describe('preview.earnrate.dev', () => {
  const env = {
    ASSETS: {
      fetch: () =>
        Promise.resolve(
          new Response('<p>page</p>', {
            headers: { 'content-type': 'text/html' },
          }),
        ),
    },
  }

  test('pages are marked noindex and robots.txt blocks everything', async () => {
    const page = await preview.fetch(
      new Request('https://preview.earnrate.dev/'),
      env,
    )
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(await page.text()).toBe('<p>page</p>')
    const robots = await preview.fetch(
      new Request('https://preview.earnrate.dev/robots.txt'),
      env,
    )
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
  })

  test('nothing is counted', async () => {
    const config = await readFile(
      new URL('../wrangler.preview.jsonc', import.meta.url),
      'utf8',
    )
    expect(config).not.toMatch(/analytics_engine|kv_namespaces|durable_objects/)
    const count = await preview.fetch(
      new Request('https://preview.earnrate.dev/count', {
        method: 'POST',
        body: 'search',
      }),
      env,
    )
    expect(count.status).toBe(204)
  })
})
