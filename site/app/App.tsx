import { useEffect, useState } from 'preact/hooks'
import { catalog, dataVersion } from 'virtual:catalog'
import { BestFor, SUGGESTIONS } from './BestFor.tsx'
import { MyWallet } from './MyWallet.tsx'
import { Spending } from './Spending.tsx'
import { issuerName, issuers } from './format.ts'
import {
  DEFAULT_SETTINGS,
  load,
  loadWallet,
  save,
  type Settings,
} from './settings.ts'

type Tab = 'best' | 'spending' | 'wallet'

// State lives in the URL fragment, which browsers never send to a server.
function readHash(): { tab: Tab; query: string } {
  const hash = new URLSearchParams(location.hash.slice(1))
  if (hash.has('spending')) return { tab: 'spending', query: '' }
  if (hash.has('wallet')) {
    // A store sent here from a search page: with no saved cards, the
    // all-cards ranking answers it instead.
    const query = hash.get('wallet') ?? ''
    const saved = (loadWallet()?.cards.length ?? 0) > 0
    return { tab: saved || query === '' ? 'wallet' : 'best', query }
  }
  return { tab: 'best', query: hash.get('best') ?? '' }
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
  const prefix = words.slice(0, shared).join(' ')
  return {
    label: `${prefix} tier`,
    tiers: tiers.map((m) => ({
      id: m.id,
      name: m.name.slice(prefix.length).trim(),
    })),
  }
})

function Filters({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (s: Settings) => void
}) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  const has = (m: string) => settings.memberships.includes(m)
  const toggle = (m: string, on: boolean) =>
    set({
      memberships: on
        ? [...settings.memberships, m]
        : settings.memberships.filter((x) => x !== m),
    })
  const active =
    (settings.noFee ? 1 : 0) +
    (settings.kind !== 'any' ? 1 : 0) +
    (settings.issuer !== null ? 1 : 0) +
    (settings.business ? 1 : 0) +
    settings.memberships.length +
    (settings.pointsHeavy ? 1 : 0)

  return (
    <details class="filters">
      <summary>
        Filters and memberships
        {active > 0 ? <span class="badge">{active}</span> : null}
      </summary>
      <div class="filter-grid">
        <label class="check">
          <input
            type="checkbox"
            checked={settings.noFee}
            onChange={(e) => set({ noFee: e.currentTarget.checked })}
          />
          No annual fee
        </label>
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
        <label class="check">
          <input
            type="checkbox"
            checked={settings.business}
            onChange={(e) => set({ business: e.currentTarget.checked })}
          />
          Business cards instead
        </label>
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
        {TIER_GROUPS.map(({ label, tiers }) => {
          const ids = tiers.map((t) => t.id)
          return (
            <label key={label}>
              {label}
              <select
                value={settings.memberships.find((m) => ids.includes(m)) ?? ''}
                onChange={(e) =>
                  set({
                    memberships: [
                      ...settings.memberships.filter((m) => !ids.includes(m)),
                      ...(e.currentTarget.value ? [e.currentTarget.value] : []),
                    ],
                  })
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
        <label class="check">
          <input
            type="checkbox"
            checked={settings.pointsHeavy}
            onChange={(e) => set({ pointsHeavy: e.currentTarget.checked })}
          />
          I transfer points to airlines and hotels (Amex and Chase points at
          1.7¢ instead of 1¢)
        </label>
      </div>
    </details>
  )
}

export function App() {
  const [{ tab, query }, setView] = useState(readHash)
  const [settings, setSettings] = useState<Settings>(() =>
    load('settings', DEFAULT_SETTINGS),
  )
  useEffect(() => save('settings', settings), [settings])
  useEffect(() => writeHash(tab, query), [tab, query])
  useEffect(() => {
    const onHash = () => setView(readHash())
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
      <div role="tabpanel">
        {tab === 'best' ? (
          <BestFor
            settings={settings}
            filters={<Filters settings={settings} onChange={setSettings} />}
            query={query}
            onQuery={(q) => setView({ tab: 'best', query: q })}
          />
        ) : tab === 'spending' ? (
          <Spending
            settings={settings}
            filters={<Filters settings={settings} onChange={setSettings} />}
          />
        ) : (
          <MyWallet initialQuery={query} memberships={settings.memberships} />
        )}
      </div>
      <datalist id="suggestions">
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <p class="data-version muted">
        Runs in your browser. Card data {dataVersion}, from each issuer's own
        terms.
      </p>
    </div>
  )
}
