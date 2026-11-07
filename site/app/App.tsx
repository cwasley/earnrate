import { useEffect, useRef, useState } from 'preact/hooks'
import { catalog, dataVersion } from 'virtual:catalog'
import { BestFor, SUGGESTIONS } from './BestFor.tsx'
import { MyWallet } from './MyWallet.tsx'
import { Spending } from './Spending.tsx'
import { track } from './track.ts'
import { issuerName, issuers } from './format.ts'
import {
  load,
  loadState,
  loadWallet,
  save,
  saveWallet,
  type Settings,
} from './settings.ts'
import {
  applyLocally,
  combineOps,
  disconnect,
  editState,
  firstConnection,
  importOp,
  keepClaudeSettings,
  LIMITED,
  membershipsOp,
  type Outcome,
  syncRequest,
  syncReturn,
  type SyncReturn,
  type WalletOp,
} from './sync.ts'
import {
  ConnectPanel,
  Connecting,
  Ended,
  FirstChoice,
  SyncStatus,
  type Choice,
  type SyncView,
} from './Sync.tsx'
import { localToday } from '../../src/engine/periods.ts'
import { VALUATION_PROFILES } from '../../src/engine/profiles.ts'
import { listed } from '../../src/engine/text.ts'
import { EMPTY_WALLET } from '../../src/engine/transient.ts'
import type { Wallet } from '../../src/schema/wallet.ts'

type Tab = 'best' | 'spending' | 'wallet'

// State lives in the URL fragment, which browsers never send to a server.
// `focus`: a link sent a store to My wallet ("Check with your own cards"),
// so it opens at the answer rather than the top of the wallet.
function readHash(): { tab: Tab; query: string; focus?: boolean } {
  const hash = new URLSearchParams(location.hash.slice(1))
  if (hash.has('spending')) return { tab: 'spending', query: '' }
  if (hash.has('wallet')) {
    // A store sent here from a search page: with no saved cards, the
    // all-cards ranking answers it instead.
    const query = hash.get('wallet') ?? ''
    const saved = (loadWallet()?.cards.length ?? 0) > 0
    return saved || query === ''
      ? { tab: 'wallet', query, focus: query !== '' }
      : { tab: 'best', query }
  }
  return { tab: 'best', query: hash.get('best') ?? '' }
}

// A link to a section of the page below the app (/#claude) keeps its
// fragment, and scrolls there once the app above it has rendered.
function linkedSection(): HTMLElement | null {
  const id = location.hash.slice(1)
  return /^[a-z-]+$/.test(id) && id !== 'wallet' && id !== 'spending'
    ? document.getElementById(id)
    : null
}

function writeHash(tab: Tab, query: string) {
  const hash =
    tab !== 'best'
      ? `#${tab}`
      : query === ''
        ? ''
        : `#best=${encodeURIComponent(query).replace(/%20/g, '+')}`
  history.replaceState(null, '', `${location.pathname}${hash}`)
}

// Memberships the site asks about, from data/memberships.yaml: one checkbox
// each, and one menu per group of tiers (BofA Preferred Rewards).
const ASKED = catalog.memberships.filter((m) => m.ask !== undefined)
const TIER_GROUPS = [
  ...new Set(catalog.memberships.flatMap((m) => m.group ?? [])),
].map((group) => {
  const tiers = catalog.memberships.filter((m) => m.group === group)
  const names = tiers.map((m) => m.name)
  const words = names[0]?.split(' ') ?? []
  let shared = 0
  while (
    shared < words.length - 1 &&
    names.every((n) => n.split(' ')[shared] === words[shared])
  )
    shared++
  const prefix = words.slice(0, shared).join(' ').replace(/,$/, '')
  return {
    label: `${prefix} tier`,
    tiers: tiers.map((m) => ({
      id: m.id,
      name: m.name.slice(prefix.length).replace(/^,/, '').trim(),
    })),
  }
})

// "Values Amex Membership Rewards and Chase Ultimate Rewards points at 1.7¢
// instead of 1¢": the profiles' own numbers, with the programs' names.
const POINTS_HEAVY_HINT = (() => {
  const heavy = Object.entries(VALUATION_PROFILES['points-heavy'])
  const names = heavy.map(
    ([id]) => catalog.currencies.find((c) => c.id === id)?.name ?? id,
  )
  const cents = (values: Record<string, number>) =>
    listed([...new Set(Object.values(values))].map((v) => `${String(v)}¢`))
  return `Values ${listed(names)} points at ${cents(VALUATION_PROFILES['points-heavy'])} instead of ${cents(VALUATION_PROFILES.flat)}.`
})()

// Memberships here are the wallet's, the same list My wallet shows.
function Filters({
  settings,
  onChange,
  memberships,
  onMemberships,
  synced,
  locked,
  note,
}: {
  settings: Settings
  onChange: (s: Settings) => void
  memberships: string[]
  onMemberships: (memberships: string[]) => void
  synced: boolean
  locked: boolean
  note: string | null
}) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  const has = (m: string) => memberships.includes(m)
  const toggle = (m: string, on: boolean) =>
    onMemberships(on ? [...memberships, m] : memberships.filter((x) => x !== m))
  const active =
    (settings.noFee ? 1 : 0) +
    (settings.kind !== 'any' ? 1 : 0) +
    (settings.issuer !== null ? 1 : 0) +
    (settings.business ? 1 : 0) +
    memberships.length +
    (settings.pointsHeavy ? 1 : 0)

  return (
    <details class="filters">
      <summary>
        Filters and memberships
        {active > 0 ? <span class="badge">{active}</span> : null}
      </summary>
      <div class="filter-panel">
        <fieldset class="filter-group">
          <legend>Which cards</legend>
          <div class="filter-row">
            <label>
              Rewards
              <select
                value={settings.kind}
                onChange={(e) =>
                  set({ kind: e.currentTarget.value as Settings['kind'] })
                }
              >
                <option value="any">Cash back and points</option>
                <option value="cash">Cash back only</option>
                <option value="points">Points and miles only</option>
              </select>
            </label>
            <label>
              Issuer
              <select
                value={settings.issuer ?? ''}
                onChange={(e) => set({ issuer: e.currentTarget.value || null })}
              >
                <option value="">Any issuer</option>
                {issuers.map((i) => (
                  <option value={i} key={i}>
                    {issuerName(i)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div class="filter-checks">
            <label class="check">
              <input
                type="checkbox"
                checked={settings.noFee}
                onChange={(e) => set({ noFee: e.currentTarget.checked })}
              />
              No annual fee
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={settings.business}
                onChange={(e) => set({ business: e.currentTarget.checked })}
              />
              Business cards instead
            </label>
          </div>
        </fieldset>
        <fieldset class="filter-group">
          <legend>About you</legend>
          <p class="hint">
            {synced
              ? 'Saved in your synced wallet, and used on every tab.'
              : 'Saved in this browser with My wallet, and used on every tab.'}
            {note ? ` ${note}` : ''}
          </p>
          <fieldset class="lock" disabled={locked}>
            <div class="filter-checks">
              {ASKED.map((m) => (
                <label class="check" key={m.id}>
                  <input
                    type="checkbox"
                    checked={has(m.id)}
                    onChange={(e) => toggle(m.id, e.currentTarget.checked)}
                  />
                  {m.ask}
                </label>
              ))}
            </div>
            {TIER_GROUPS.length > 0 ? (
              <div class="filter-row">
                {TIER_GROUPS.map(({ label, tiers }) => {
                  const ids = tiers.map((t) => t.id)
                  return (
                    <label key={label}>
                      {label}
                      <select
                        value={memberships.find((m) => ids.includes(m)) ?? ''}
                        onChange={(e) =>
                          onMemberships([
                            ...memberships.filter((m) => !ids.includes(m)),
                            ...(e.currentTarget.value
                              ? [e.currentTarget.value]
                              : []),
                          ])
                        }
                      >
                        <option value="">None</option>
                        {tiers.map((t) => (
                          <option value={t.id} key={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )
                })}
              </div>
            ) : null}
          </fieldset>
          <label class="check">
            <input
              type="checkbox"
              checked={settings.pointsHeavy}
              onChange={(e) => set({ pointsHeavy: e.currentTarget.checked })}
            />
            <span>
              I transfer points to airlines and hotels
              <span class="hint">{POINTS_HEAVY_HINT}</span>
            </span>
          </label>
        </fieldset>
      </div>
    </details>
  )
}

const CANCELED = 'Sign-in was canceled. Nothing changed.'
const FAILED = "Couldn't connect to your Claude wallet. Try again."
const UNREACHABLE =
  "Couldn't reach earnrate's server to finish connecting. Try again when you're online."
const NEEDS_CONNECTION = 'Changes need a connection.'
const ENDED = 'This browser was signed out of your Claude wallet.'

// Sign-in coming back (#wallet&sync=on) is read once and dropped from the
// address, before anything else reads the hash.
function takeSyncReturn(): SyncReturn | null {
  const { sync, hash } = syncReturn(location.hash)
  if (sync) history.replaceState(null, '', `${location.pathname}${hash}`)
  return sync
}

function initialSync(back: SyncReturn | null): SyncView {
  if (back === 'on') return { state: 'connecting' }
  if (load('sync', { on: false }).on) return { state: 'on', note: null }
  return {
    state: 'off',
    note: back === 'canceled' ? CANCELED : back === 'failed' ? FAILED : null,
  }
}

const cardCount = (w: Wallet) =>
  `${String(w.cards.length)} card${w.cards.length === 1 ? '' : 's'}`

async function yamlOf(wallet: Wallet): Promise<string> {
  const { walletYaml } = await import('../../src/format/wallet-yaml.ts')
  return walletYaml(wallet)
}

export function App() {
  const [{ tab, query, focus }, setView] = useState<{
    tab: Tab
    query: string
    focus?: boolean
  }>(readHash)
  const [initial] = useState(loadState)
  const [settings, setSettings] = useState<Settings>(initial.settings)
  const [wallet, setWallet] = useState<Wallet | null>(initial.wallet)
  const [sync, setSync] = useState<SyncView>(() =>
    initialSync(takeSyncReturn()),
  )
  const [online, setOnline] = useState(() => navigator.onLine)
  const [busy, setBusy] = useState(false)
  // A change can run later than the render that made it (Undo), so it
  // reads the wallet as it is now.
  const walletRef = useRef(wallet)
  walletRef.current = wallet

  const replaceWallet = (next: Wallet | null) => {
    walletRef.current = next
    setWallet(next)
    saveWallet(next)
  }
  const synced = sync.state === 'on'
  const edit = editState({ synced, online, busy })
  const locked =
    edit.locked || sync.state === 'connecting' || sync.state === 'choose'

  // Synced: the server's copy wins, cached here for answers offline.
  const finish = (next: Wallet, note: string | null) => {
    replaceWallet(next)
    save('sync', { on: true })
    setOnline(true)
    setSync({ state: 'on', note })
  }
  const ended = () => {
    save('sync', { on: false })
    setSync({ state: 'ended' })
  }

  const refresh = async () => {
    const result = await syncRequest(null)
    if (result.kind === 'ok') {
      replaceWallet(result.wallet)
      setOnline(true)
    } else if (result.kind === 'ended') ended()
    else if (result.kind === 'offline') setOnline(false)
  }

  // Replaces the Claude wallet with this browser's, through import_wallet.
  const replaceClaude = async (local: Wallet): Promise<string | null> => {
    const result = await syncRequest(importOp(await yamlOf(local)))
    if (result.kind === 'ok') return null
    if (result.kind === 'refused') return result.error
    if (result.kind === 'ended') return FAILED
    if (result.kind === 'limited') return LIMITED
    return UNREACHABLE
  }

  const connectFirst = async () => {
    const result = await syncRequest(null)
    if (result.kind !== 'ok') {
      setSync({
        state: 'off',
        note: result.kind === 'offline' ? UNREACHABLE : FAILED,
      })
      return
    }
    const claude = result.wallet
    const local = wallet
    switch (firstConnection(claude, local)) {
      case 'same':
        finish(claude, 'Synced with your Claude wallet.')
        return
      case 'claude':
        finish(
          claude,
          `Synced: My wallet now shows your Claude wallet (${cardCount(claude)}).`,
        )
        return
      case 'browser': {
        if (!local) return
        const merged = keepClaudeSettings(claude, local)
        const error = await replaceClaude(merged)
        if (error) setSync({ state: 'off', note: error })
        else
          finish(
            merged,
            "Synced: your Claude wallet had no cards, so it now holds this browser's.",
          )
        return
      }
      case 'ask':
        setSync({ state: 'choose', claude, error: null, busy: false })
    }
  }

  const choose = async (choice: Choice) => {
    if (sync.state !== 'choose' || !wallet) return
    const { claude } = sync
    if (choice === 'claude') {
      finish(claude, 'Synced: My wallet now shows your Claude wallet.')
      return
    }
    setSync({ ...sync, busy: true, error: null })
    if (choice === 'browser') {
      const error = await replaceClaude(wallet)
      if (error) setSync({ ...sync, busy: false, error })
      else
        finish(wallet, "Synced: your Claude wallet now holds this browser's.")
      return
    }
    let latest = claude
    const refused: string[] = []
    for (const op of combineOps(catalog, claude, wallet, localToday())) {
      const result = await syncRequest(op)
      if (result.kind === 'ok') latest = result.wallet
      else if (result.kind === 'refused') refused.push(result.error)
      else {
        setSync({
          ...sync,
          busy: false,
          error:
            result.kind === 'limited'
              ? LIMITED
              : `${UNREACHABLE} Your Claude wallet may have some of this browser's cards already.`,
        })
        return
      }
    }
    finish(
      latest,
      refused.length > 0
        ? `Combined, except: ${refused.join(' ')}`
        : `Combined: your wallet now has every card from both (${cardCount(latest)}).`,
    )
  }

  const stop = async () => {
    const signedOut = await disconnect()
    save('sync', { on: false })
    setSync({
      state: 'off',
      note: signedOut
        ? 'Stopped syncing. Your wallet stays in this browser.'
        : "Stopped syncing here; your wallet stays in this browser. earnrate's server couldn't be reached to sign this browser out, so connecting again later replaces that sign-in.",
    })
  }

  // Every change on the page goes through here: applied in this browser
  // with the shared rules, or, synced, made on the server and shown back.
  const perform = async (op: WalletOp): Promise<Outcome> => {
    if (sync.state === 'connecting' || sync.state === 'choose')
      return {
        ok: false,
        error: 'Finish connecting to your Claude wallet first.',
      }
    if (sync.state === 'on') {
      if (!online) return { ok: false, error: NEEDS_CONNECTION }
      // Shown at once by the same rules; the server's answer then replaces
      // it, or the wallet goes back as it was.
      const before = walletRef.current
      const local =
        op.tool === 'import_wallet'
          ? null
          : applyLocally(catalog, walletRef.current, op, localToday())
      if (local?.ok) {
        walletRef.current = local.wallet
        setWallet(local.wallet)
      }
      setBusy(true)
      try {
        const result = await syncRequest(op)
        if (result.kind === 'ok') {
          replaceWallet(result.wallet)
          return { ok: true, notes: local?.ok ? local.notes : [] }
        }
        walletRef.current = before
        setWallet(before)
        switch (result.kind) {
          case 'refused':
            return { ok: false, error: result.error }
          case 'ended':
            ended()
            return { ok: false, error: ENDED }
          case 'limited':
            return { ok: false, error: LIMITED }
          case 'offline':
            setOnline(false)
            return { ok: false, error: NEEDS_CONNECTION }
        }
      } finally {
        setBusy(false)
      }
    }
    if (op.tool === 'import_wallet') {
      const { parseWalletYaml } =
        await import('../../src/format/wallet-yaml.ts')
      const parsed = parseWalletYaml(op.input.yaml, catalog)
      if (typeof parsed === 'string') return { ok: false, error: parsed }
      replaceWallet(parsed)
      return { ok: true, notes: [] }
    }
    const change = applyLocally(catalog, walletRef.current, op, localToday())
    if (!change.ok) return { ok: false, error: change.error }
    replaceWallet(change.wallet)
    return { ok: true, notes: change.notes }
  }

  useEffect(() => {
    if (sync.state === 'connecting') void connectFirst()
    // Only the sign-in coming back starts this, once.
  }, [])

  // While synced: fetch the wallet now, when the page comes back into view,
  // when the connection returns, and every half minute while it's away.
  useEffect(() => {
    if (sync.state !== 'on') return
    void refresh()
    const back = () => {
      setOnline(true)
      void refresh()
    }
    const gone = () => setOnline(false)
    const seen = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    addEventListener('online', back)
    addEventListener('offline', gone)
    document.addEventListener('visibilitychange', seen)
    return () => {
      removeEventListener('online', back)
      removeEventListener('offline', gone)
      document.removeEventListener('visibilitychange', seen)
    }
  }, [sync.state])
  useEffect(() => {
    if (sync.state !== 'on' || online) return
    const timer = setInterval(() => void refresh(), 30_000)
    return () => clearInterval(timer)
  }, [sync.state, online])

  const syncTop =
    sync.state === 'connecting' ? (
      <Connecting />
    ) : sync.state === 'choose' && wallet ? (
      <FirstChoice
        claude={sync.claude}
        browser={wallet}
        error={sync.error}
        busy={sync.busy}
        onChoose={(c) => void choose(c)}
        onCancel={() => void stop()}
      />
    ) : sync.state === 'ended' ? (
      <Ended onKeep={() => setSync({ state: 'off', note: null })} />
    ) : sync.state === 'on' ? (
      <SyncStatus
        online={online}
        busy={busy}
        note={sync.note}
        onStop={() => void stop()}
      />
    ) : null
  const connect =
    sync.state === 'off' ? <ConnectPanel note={sync.note} /> : null

  const saved = wallet ?? EMPTY_WALLET
  const filters = (
    <Filters
      settings={settings}
      onChange={setSettings}
      memberships={saved.memberships}
      onMemberships={(memberships) => void perform(membershipsOp(memberships))}
      synced={synced}
      locked={locked}
      note={edit.note}
    />
  )
  useEffect(() => save('settings', settings), [settings])
  const section = useRef(linkedSection())
  useEffect(() => {
    section.current?.scrollIntoView()
  }, [])
  useEffect(() => {
    if (section.current) section.current = null
    else writeHash(tab, query)
  }, [tab, query])
  useEffect(() => {
    track(`tab-${tab}`)
  }, [tab])
  // A tab's panel animates only what arrives after it has rendered, so
  // opening a tab or loading the page shows it at rest.
  const [settled, setSettled] = useState<Tab | null>(null)
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setSettled(tab))
    })
    return () => cancelAnimationFrame(frame)
  }, [tab])
  useEffect(() => {
    // A link to a section below (#claude) scrolls there and keeps the app
    // as it is.
    const onHash = () => {
      if (!linkedSection()) setView(readHash())
    }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div class="app">
      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'best'}
          onClick={() => setView({ tab: 'best', query })}
        >
          Best for…
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'spending'}
          onClick={() => setView({ tab: 'spending', query })}
        >
          My spending
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'wallet'}
          onClick={() => setView({ tab: 'wallet', query })}
        >
          My wallet
        </button>
      </div>
      <div role="tabpanel" class={settled === tab ? 'settled' : undefined}>
        {tab === 'best' ? (
          <BestFor
            settings={settings}
            saved={saved}
            filters={filters}
            query={query}
            onQuery={(q) => setView({ tab: 'best', query: q })}
            hasCards={(wallet?.cards.length ?? 0) > 0}
            onWallet={() => {
              setView({ tab: 'wallet', query: '' })
              document.querySelector('.tabs')?.scrollIntoView()
            }}
          />
        ) : tab === 'spending' ? (
          <Spending settings={settings} saved={saved} filters={filters} />
        ) : (
          <MyWallet
            initialQuery={query}
            focusAsk={focus === true}
            wallet={wallet}
            perform={perform}
            onDelete={() => replaceWallet(null)}
            synced={synced}
            locked={locked}
            lockNote={edit.note}
            syncTop={syncTop}
            connect={connect}
          />
        )}
      </div>
      <datalist id="suggestions">
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <p class="data-version muted">
        Free, with no sign-up. Runs in your browser, so what you type stays on
        your device. Card data {dataVersion}, from each issuer's own terms.
      </p>
    </div>
  )
}
