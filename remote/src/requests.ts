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
