// preview.earnrate.dev: the same build as earnrate.dev, for reviewing a branch
// before it ships. Search engines are told to stay away, and nothing is
// counted: there's no Analytics Engine binding, and /count answers without
// recording. /api/* is the same wallet sync as earnrate.dev's, bound to the
// same hosted server, so sync can be tried here with a test wallet.
import { api, type ApiEnv } from './api.ts'

type Assets = { fetch(request: Request): Promise<Response> }

export type PreviewEnv = ApiEnv & { ASSETS: Assets }

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
    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    headers.set('x-robots-tag', 'noindex, nofollow')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}
