// earnrate.dev signs in like any other app, as a public client with PKCE.
// Its registration is fixed here rather than stored, so nothing has to be
// registered on the live server and nobody can change or delete it.
export const SITE_CLIENT_ID = 'earnrate-site'
export const SITE_HOSTS = ['earnrate.dev', 'preview.earnrate.dev']
export const SITE_CALLBACKS = SITE_HOSTS.map((h) => `https://${h}/api/callback`)

const KEY = `client:${SITE_CLIENT_ID}`
const RECORD = JSON.stringify({
  clientId: SITE_CLIENT_ID,
  redirectUris: SITE_CALLBACKS,
  clientName: 'earnrate.dev',
  clientUri: 'https://earnrate.dev',
  tokenEndpointAuthMethod: 'none',
  grantTypes: ['authorization_code', 'refresh_token'],
  responseTypes: ['code'],
})

type Kv = Record<string, unknown> & {
  get(key: string, options?: unknown): Promise<unknown>
}

// The OAuth library reads clients from KV as `client:{id}`. This answers
// the site's from code and ignores writes to it, so the library's
// registration renewal or a management request can't replace it.
export function withSiteClient(kv: unknown): unknown {
  return new Proxy(kv as Kv, {
    get(target, prop) {
      if (prop === 'get')
        return (key: string, options?: unknown) => {
          if (key !== KEY) return target.get(key, options)
          const type =
            typeof options === 'string'
              ? options
              : (options as { type?: string } | undefined)?.type
          return Promise.resolve(
            type === 'json' ? (JSON.parse(RECORD) as unknown) : RECORD,
          )
        }
      if (prop === 'put' || prop === 'delete')
        return (key: string, ...rest: unknown[]) =>
          key === KEY
            ? Promise.resolve()
            : (target[prop] as (...a: unknown[]) => Promise<unknown>).call(
                target,
                key,
                ...rest,
              )
      const value: unknown = Reflect.get(target, prop)
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value
    },
  })
}

// Other apps register themselves; none may claim the site's callback hosts.
export const onSiteHost = (uri: unknown) => {
  try {
    return (
      typeof uri === 'string' &&
      (new URL(uri).hostname === 'earnrate.dev' ||
        new URL(uri).hostname.endsWith('.earnrate.dev'))
    )
  } catch {
    return false
  }
}
