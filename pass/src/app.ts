// pass.earnrate.dev: earnrate.dev's "Add to Apple Wallet" form posts the
// browser wallet's card ids, picks, activations, checkout labels and
// memberships here; the Worker builds a signed cheat-sheet pass and returns
// it. It stores nothing and logs nothing (observability is off), and the
// request never reaches any other service.
import type { Catalog } from '../../src/schema/catalog.ts'
import { limitKey, readBody } from '../../remote/src/requests.ts'
import {
  passJson,
  PassWalletSchema,
  unknownCards,
  type PassIdentity,
} from './pass.ts'
import { packPass, type Signer } from './sign.ts'

type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export type PassEnv = {
  PASS_TYPE_ID?: string // pass.dev.earnrate.cheatsheet
  TEAM_ID?: string
  PASS_CERT_PEM?: string
  PASS_KEY_PEM?: string
  WWDR_PEM?: string
  LIMITER?: RateLimit // per IP
}

const MAX_FORM = 16 * 1024
const WALLET_PAGE = 'https://earnrate.dev/#wallet'

const text = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  })

// The browser's local date, so a pass made the evening of a quarter's last
// day is for that quarter; anything more than a day from the server's is
// ignored.
function passDate(sent: string | null, now: Date): string {
  const server = now.toISOString().slice(0, 10)
  if (sent === null || !/^\d{4}-\d{2}-\d{2}$/.test(sent)) return server
  const days = Math.abs(Date.parse(sent) - Date.parse(server)) / 86_400_000
  return days <= 1 ? sent : server
}

export function makePassWorker(deps: {
  catalog: Catalog
  images: Record<string, Uint8Array>
  now?: () => Date
}) {
  const now = deps.now ?? (() => new Date())
  return {
    async fetch(request: Request, env: PassEnv): Promise<Response> {
      const { pathname } = new URL(request.url)
      if (pathname !== '/') return text(404, 'Not found.')
      if (request.method === 'GET' || request.method === 'HEAD')
        return Response.redirect(WALLET_PAGE, 302)
      if (request.method !== 'POST')
        return text(405, 'Use the button on earnrate.dev.')

      const key = limitKey(request)
      if (env.LIMITER && key !== null) {
        const { success } = await env.LIMITER.limit({ key })
        if (!success)
          return text(429, 'Too many passes at once. Try again in a minute.')
      }
      const body = await readBody(request, MAX_FORM)
      if (body === null)
        return text(413, 'That wallet is too large for a pass.')
      const form = new URLSearchParams(body)
      let input: unknown
      try {
        input = JSON.parse(form.get('wallet') ?? '')
      } catch {
        return text(400, 'The wallet sent was not readable.')
      }
      const parsed = PassWalletSchema.safeParse(input)
      if (!parsed.success)
        return text(400, 'Add a card to your wallet on earnrate.dev first.')
      const unknown = unknownCards(deps.catalog, parsed.data)
      if (unknown.length > 0)
        return text(400, `earnrate doesn't know ${unknown.join(', ')}.`)

      const identity: PassIdentity | null =
        env.PASS_TYPE_ID && env.TEAM_ID
          ? {
              passTypeIdentifier: env.PASS_TYPE_ID,
              teamIdentifier: env.TEAM_ID,
            }
          : null
      const signer: Signer | null =
        env.PASS_CERT_PEM && env.PASS_KEY_PEM && env.WWDR_PEM
          ? {
              certificatePem: env.PASS_CERT_PEM,
              privateKeyPem: env.PASS_KEY_PEM,
              wwdrPem: env.WWDR_PEM,
            }
          : null
      if (!identity || !signer)
        return text(503, "Apple Wallet passes aren't set up yet.")

      const date = passDate(form.get('date'), now())
      const pass = passJson(
        deps.catalog,
        parsed.data,
        date,
        identity,
        crypto.randomUUID(),
      )
      const bytes = await packPass(pass, deps.images, signer)
      return new Response(bytes, {
        headers: {
          'content-type': 'application/vnd.apple.pkpass',
          'content-disposition': 'attachment; filename="earnrate.pkpass"',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      })
    },
  }
}
