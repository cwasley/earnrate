import {
  WalletSchema,
  type Wallet,
  type WalletCard,
} from '../../src/schema/wallet.ts'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

type Path = readonly PropertyKey[]

// Removes what's at `path`; when nothing is there (a required field that's
// missing), removes the object that should have held it.
function dropAt(root: unknown, path: Path): boolean {
  if (path.length === 0) return false
  let parent: unknown = root
  for (const key of path.slice(0, -1)) {
    if (!isRecord(parent) && !Array.isArray(parent)) return false
    parent = (parent as Record<PropertyKey, unknown>)[key]
  }
  const last = path[path.length - 1] as PropertyKey
  if (Array.isArray(parent) && typeof last === 'number') {
    if (last >= parent.length) return dropAt(root, path.slice(0, -1))
    parent[last] = DROPPED
    return true
  }
  if (isRecord(parent) && last in parent) {
    Reflect.deleteProperty(parent, last)
    return true
  }
  return dropAt(root, path.slice(0, -1))
}

// Array items are marked, then filtered out after a pass, so the other
// issues' indexes still point at the right items.
const DROPPED = Symbol('dropped')
function sweep(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== DROPPED).map(sweep)
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sweep(v)]),
    )
  return value
}

// A saved wallet as the wallet schema reads it, keeping everything that's
// valid: a card, field or entry the schema refuses is left out rather than
// costing the whole wallet, and missing fields get their defaults. Older
// versions' wallets are subsets of today's and load as they are. The file
// format's `version` isn't kept. Null when there's no wallet in it at all.
export function normalizeWallet(raw: unknown): Wallet | null {
  if (!isRecord(raw) || !Array.isArray(raw.cards)) return null
  let value: unknown = {
    ...raw,
    ...(typeof raw.memberships === 'string'
      ? { memberships: [raw.memberships] }
      : {}),
    cards: raw.cards.filter(
      (c) => isRecord(c) && typeof c.id === 'string',
    ) as unknown[],
  }
  value = JSON.parse(JSON.stringify(value)) as unknown
  for (let round = 0; round < 50; round++) {
    const parsed = WalletSchema.safeParse(value)
    if (parsed.success) {
      const seen = new Set<string>()
      const cards: WalletCard[] = parsed.data.cards.filter((c) => {
        if (seen.has(c.id)) return false
        seen.add(c.id)
        return true
      })
      const { version: _, ...wallet } = parsed.data
      return { ...wallet, cards }
    }
    let dropped = false
    for (const issue of parsed.error.issues) {
      const keys =
        issue.code === 'unrecognized_keys'
          ? issue.keys.map((k) => [...issue.path, k])
          : [issue.path]
      for (const path of keys) if (dropAt(value, path)) dropped = true
    }
    if (!dropped) return null
    value = sweep(value)
  }
  return null
}

// Only reads: the statement check imports this, and its page must never
// write to the browser's storage.
export function loadWallet(): Wallet | null {
  try {
    const raw = localStorage.getItem('earnrate:wallet')
    if (raw === null) return null
    return normalizeWallet(JSON.parse(raw))
  } catch {
    return null
  }
}

// The saved wallet exactly as stored, for downloading when it can't be read.
export function savedWalletText(): string | null {
  try {
    return localStorage.getItem('earnrate:wallet')
  } catch {
    return null
  }
}
