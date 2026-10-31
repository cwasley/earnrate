import { useEffect, useState } from 'preact/hooks'
import { dataVersion } from 'virtual:catalog'
import { BestFor, SUGGESTIONS } from './BestFor.tsx'
import { issuerName, issuers, MEMBERSHIPS } from './format.ts'
import { DEFAULT_SETTINGS, load, save, type Settings } from './settings.ts'
import { MyWallet } from './MyWallet.tsx'
import { Spending } from './Spending.tsx'

type Tab = 'best' | 'spending' | 'wallet'

// State lives in the URL fragment, which browsers never send to a server.
function readHash(): { tab: Tab; query: string } {
  const hash = new URLSearchParams(location.hash.slice(1))
  if (hash.has('spending')) return { tab: 'spending', query: '' }
  if (hash.has('wallet')) return { tab: 'wallet', query: '' }
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

const BOFA_TIERS = Object.keys(MEMBERSHIPS).filter((m) =>
  m.startsWith('bofa-rewards-'),
)

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
  const tier = settings.memberships.find((m) => BOFA_TIERS.includes(m)) ?? ''
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
        <label class="check">
          <input
            type="checkbox"
            checked={has('amazon-prime')}
            onChange={(e) => toggle('amazon-prime', e.currentTarget.checked)}
          />
          I have Amazon Prime
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={has('bank-of-america-account')}
            onChange={(e) =>
              toggle('bank-of-america-account', e.currentTarget.checked)
            }
          />
          I bank with Bank of America
        </label>
        <label>
          BofA Rewards tier
          <select
            value={tier}
            onChange={(e) =>
              set({
                memberships: [
                  ...settings.memberships.filter(
                    (m) => !BOFA_TIERS.includes(m),
                  ),
                  ...(e.currentTarget.value ? [e.currentTarget.value] : []),
                ],
              })
            }
          >
            <option value="">None</option>
            {BOFA_TIERS.map((m) => (
              <option value={m} key={m}>
                {MEMBERSHIPS[m]?.replace('BofA Rewards ', '')}
              </option>
            ))}
          </select>
        </label>
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
      {tab === 'wallet' ? null : (
        <Filters settings={settings} onChange={setSettings} />
      )}
      <div role="tabpanel">
        {tab === 'best' ? (
          <BestFor
            settings={settings}
            query={query}
            onQuery={(q) => setView({ tab: 'best', query: q })}
          />
        ) : tab === 'spending' ? (
          <Spending settings={settings} />
        ) : (
          <MyWallet />
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
