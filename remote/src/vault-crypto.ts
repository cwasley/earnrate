// Recovery codes and wallet encryption, with Web Crypto only (Workers and
// Node). A wallet is AES-GCM encrypted with its own random key. That key is
// stored wrapped by a key derived from the recovery code, and otherwise
// travels only inside the sign-in grant, which the OAuth library encrypts
// for the token holder. Storage alone can't decrypt a wallet.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LENGTH = 25 // 125 bits
const GROUP = 5

const utf8 = (text: string) => Uint8Array.from(new TextEncoder().encode(text))

// Spelled this way so it means the same with Node's and Workers' types.
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  const chars = [...bytes].map((b) => CROCKFORD[b & 31] ?? '')
  const groups: string[] = []
  for (let i = 0; i < CODE_LENGTH; i += GROUP)
    groups.push(chars.slice(i, i + GROUP).join(''))
  return groups.join('-')
}

// Forgiving about case, spaces, dashes and the letters people confuse with
// digits; null when it can't be a recovery code.
export function normalizeRecoveryCode(text: string): string | null {
  const chars = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (chars.length !== CODE_LENGTH) return null
  if (!/^[0-9A-HJKMNP-TV-Z]+$/.test(chars)) return null
  const groups: string[] = []
  for (let i = 0; i < CODE_LENGTH; i += GROUP)
    groups.push(chars.slice(i, i + GROUP))
  return groups.join('-')
}

export type CodeKeys = {
  walletId: string // names the wallet's storage; can't be turned back into the code
  wrapKey: Key
}

export async function keysFromCode(code: string): Promise<CodeKeys> {
  const base = await crypto.subtle.importKey('raw', utf8(code), 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ])
  const hkdf = (info: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: utf8('earnrate'),
    info: utf8(info),
  })
  const id = await crypto.subtle.deriveBits(hkdf('wallet id v1'), base, 256)
  const wrapKey = await crypto.subtle.deriveKey(
    hkdf('wallet key wrap v1'),
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return {
    walletId: [...new Uint8Array(id)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    wrapKey,
  }
}

export function newWalletKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)))
}

async function seal(
  plain: Uint8Array<ArrayBuffer>,
  key: Key,
  context: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(context) },
    key,
    plain,
  )
  const out = new Uint8Array(iv.length + sealed.byteLength)
  out.set(iv)
  out.set(new Uint8Array(sealed), iv.length)
  return toBase64(out)
}

// Throws when the key is wrong or the data was changed.
async function open(
  text: string,
  key: Key,
  context: string,
): Promise<Uint8Array> {
  const bytes = fromBase64(text)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: utf8(context) },
    key,
    bytes.slice(12),
  )
  return new Uint8Array(plain)
}

const importWalletKey = (walletKey: string) =>
  crypto.subtle.importKey('raw', fromBase64(walletKey), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])

export function wrapWalletKey(
  walletKey: string,
  keys: CodeKeys,
): Promise<string> {
  return seal(fromBase64(walletKey), keys.wrapKey, `key:${keys.walletId}`)
}

// null when the code doesn't unlock this wallet.
export async function unwrapWalletKey(
  wrapped: string,
  keys: CodeKeys,
): Promise<string | null> {
  try {
    return toBase64(await open(wrapped, keys.wrapKey, `key:${keys.walletId}`))
  } catch {
    return null
  }
}

export async function encryptWallet(
  text: string,
  walletKey: string,
  walletId: string,
): Promise<string> {
  return seal(
    utf8(text),
    await importWalletKey(walletKey),
    `wallet:${walletId}`,
  )
}

export async function decryptWallet(
  sealed: string,
  walletKey: string,
  walletId: string,
): Promise<string> {
  const plain = await open(
    sealed,
    await importWalletKey(walletKey),
    `wallet:${walletId}`,
  )
  return new TextDecoder().decode(plain)
}
