import { makeWorker, type Env } from '../remote/src/app.ts'
import { WalletVault, type VaultStorage } from '../remote/src/vault.ts'
import { loadCatalog } from '../src/data/load.ts'
import { TODAY } from './golden/fixtures.ts'

export const ORIGIN = 'https://mcp.earnrate.dev'
export const catalog = await loadCatalog()

export function memoryStorage(): VaultStorage & {
  values: Map<string, unknown>
  alarm: number | null
} {
  const values = new Map<string, unknown>()
  const storage = {
    values,
    alarm: null as number | null,
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    put: (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
      return Promise.resolve()
    },
    delete: (key: string) => Promise.resolve(values.delete(key)),
    deleteAll: () => {
      values.clear()
      return Promise.resolve()
    },
    setAlarm: (at: number) => {
      storage.alarm = at
      return Promise.resolve()
    },
    deleteAlarm: () => {
      storage.alarm = null
      return Promise.resolve()
    },
  }
  return storage
}

// `lag` keeps deleted keys readable, like a revocation that hasn't reached
// every location yet.
export function memoryKv(lag = false) {
  const entries = new Map<string, { value: string; metadata?: unknown }>()
  return {
    get(key: string, options?: { type?: string } | string) {
      const found = entries.get(key)?.value ?? null
      const type = typeof options === 'string' ? options : options?.type
      return Promise.resolve(
        found !== null && type === 'json'
          ? (JSON.parse(found) as unknown)
          : found,
      )
    },
    put(key: string, value: string, options?: { metadata?: unknown }) {
      entries.set(key, { value, metadata: options?.metadata })
      return Promise.resolve()
    },
    delete(key: string) {
      if (!lag) entries.delete(key)
      return Promise.resolve()
    },
    list(options: { prefix?: string } = {}) {
      const keys = [...entries]
        .filter(([k]) => k.startsWith(options.prefix ?? ''))
        .map(([name, e]) => ({ name, metadata: e.metadata }))
      return Promise.resolve({ keys, list_complete: true, cacheStatus: null })
    },
  }
}

// One Worker with its own KV and wallet storage, like a fresh deploy.
export function deployment({ kvLag = false } = {}) {
  const storages = new Map<string, ReturnType<typeof memoryStorage>>()
  const vaults = new Map<string, WalletVault>()
  const worker = makeWorker<Env>(
    { catalog, version: '0.0.0-test' },
    (_env, walletId) => {
      let vault = vaults.get(walletId)
      if (!vault) {
        const storage = memoryStorage()
        storages.set(walletId, storage)
        vault = new WalletVault(storage, catalog)
        vaults.set(walletId, vault)
      }
      return vault
    },
    () => TODAY,
  )
  const env: Env = { OAUTH_KV: memoryKv(kvLag) }
  const ctx = { waitUntil: () => undefined }
  const fetch = (
    input: string | Request,
    init?: RequestInit,
    extra: Partial<Env> = {},
  ) =>
    worker.fetch(
      typeof input === 'string'
        ? new Request(`${ORIGIN}${input}`, init)
        : input,
      { ...env, ...extra },
      ctx,
    )
  return { worker, env, fetch, storages }
}
