export const MAX_BODY = 64 * 1024

// The whole body as text, or null when it's over `max` bytes. Reads the
// stream itself, so a body sent without Content-Length is bounded too.
export async function readBody(
  request: Request,
  max = MAX_BODY,
): Promise<string | null> {
  if (!request.body) return ''
  const reader = (request.body as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function ipv4(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => !(p >= 0 && p <= 255)))
    return null
  return parts.reduce((n, p) => n * 256 + p, 0)
}

// Anthropic's published outbound range. Claude's connector calls and token
// refreshes come from it on behalf of every Claude user, so per-IP limits
// there would throttle everyone together.
// https://platform.claude.com/docs/en/api/ip-addresses
const ANTHROPIC_START = ipv4('160.79.104.0') ?? 0
const ANTHROPIC_SIZE = 2 ** (32 - 21)

// The first four groups of an IPv6 address: one network, which one person
// can fill with addresses.
function ipv6Network(ip: string): string {
  const [head = '', tail = ''] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = ip.includes('::')
    ? [
        ...left,
        ...Array<string>(8 - left.length - right.length).fill('0'),
        ...right,
      ]
    : left
  return groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')
}

// What a per-IP rate limit counts against, or null for Anthropic's servers.
// Apps that call from their own servers share those servers' addresses, so
// a request that carries a credential is limited by what it names instead.
export function limitKey(request: Request): string | null {
  const ip = request.headers.get('cf-connecting-ip')
  if (!ip) return 'unknown'
  if (ip.includes(':')) return `${ipv6Network(ip)}::/64`
  const n = ipv4(ip)
  if (
    n !== null &&
    n - ANTHROPIC_START >= 0 &&
    n - ANTHROPIC_START < ANTHROPIC_SIZE
  )
    return null
  return ip
}

async function hashedKey(prefix: string, id: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`earnrate-limit:${prefix}:${id}`),
  )
  const hex = [...new Uint8Array(digest).slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${prefix}:${hex}`
}

// A signed-in connection's key: a one-way hash of its wallet id, which the
// limiter holds only for its window and earnrate never stores or logs.
export const walletLimitKey = (walletId: string) =>
  hashedKey('wallet', walletId)

// The key for a token, code or refresh token not yet checked: a hash of the
// wallet and grant it claims to be for ("{userId}:{grantId}:{secret}"), or
// null when it isn't in that form.
export async function claimedLimitKey(
  credential: string | null | undefined,
): Promise<string | null> {
  const parts = (credential ?? '').split(':')
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null
  return hashedKey('grant', `${parts[0]}:${parts[1]}`)
}
