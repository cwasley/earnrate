// preview.earnrate.dev: the same build as earnrate.dev, for reviewing a branch
// before it ships. Search engines are told to stay away, and nothing is
// counted: there's no Analytics Engine binding, /count answers without
// recording, and pages are served no-transform so Cloudflare's Web Analytics
// script isn't added. /api/* is the same wallet sync as earnrate.dev's, bound to the
// same hosted server, so sync can be tried here with a test wallet. /r is
// the same short report links as earnrate.dev's, in a store of its own.
import { api, type ApiEnv } from './api.ts'
import { reports, type ReportsEnv } from './reports.ts'
import { headerPolicy, STATEMENT_PATHS } from './statement-policy.ts'

type Assets = { fetch(request: Request): Promise<Response> }

export type PreviewEnv = ApiEnv & ReportsEnv & { ASSETS: Assets }

const ROBOTS = 'User-agent: *\nDisallow: /\n'

export default {
  async fetch(request: Request, env: PreviewEnv): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/robots.txt')
      return new Response(ROBOTS, {
        headers: { 'content-type': 'text/plain', 'x-robots-tag': 'noindex' },
      })
    if (pathname === '/count') return new Response(null, { status: 204 })
    if (pathname.startsWith('/api/')) return api(request, env)
    if (pathname === '/r' || pathname.startsWith('/r/')) {
      const response = await reports(request, env)
      const headers = new Headers(response.headers)
      headers.set('x-robots-tag', 'noindex, nofollow')
      return new Response(response.body, { status: response.status, headers })
    }
    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    headers.set('x-robots-tag', 'noindex, nofollow')
    // Cloudflare adds its Web Analytics script to pages on this zone unless
    // told not to transform them; review visits aren't visits to count.
    const cache = headers.get('cache-control')
    headers.set(
      'cache-control',
      cache ? `${cache}, no-transform` : 'no-transform',
    )
    if (STATEMENT_PATHS.includes(pathname) && response.ok) {
      // The page's own policy, which names its hashes, as earnrate.dev's
      // _headers sends it.
      const html = await response.text()
      headers.set('content-security-policy', headerPolicy(html))
      headers.delete('content-length')
      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}
