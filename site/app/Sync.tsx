import { useState } from 'preact/hooks'
import type { Wallet } from '../../src/schema/wallet.ts'
import { shortName } from './format.ts'
import { signInStarted, walletDifferences } from './sync.ts'

// Where sign-in starts. A navigation, never a fetch: the Worker sends the
// browser on to earnrate's sign-in page.
const CONNECT = '/api/connect'

export type SyncView =
  | { state: 'off'; note: string | null }
  | { state: 'connecting' }
  | { state: 'choose'; claude: Wallet; error: string | null; busy: boolean }
  | { state: 'on'; note: string | null }
  | { state: 'ended' }

export type Choice = 'claude' | 'browser' | 'combine'

function ConnectButton({
  label,
  primary = true,
}: {
  label: string
  primary?: boolean
}) {
  const [going, setGoing] = useState(false)
  return (
    <button
      type="button"
      class={primary ? 'primary' : undefined}
      data-count="wallet-sync-on"
      disabled={going}
      onClick={() => {
        setGoing(true)
        signInStarted()
        location.assign(CONNECT)
      }}
    >
      {going ? 'Connecting…' : label}
    </button>
  )
}

// For someone not syncing: one wallet for this site and Claude. What sync
// stores is listed on the privacy page.
export function ConnectPanel({ note }: { note: string | null }) {
  return (
    <section class="panel sync-panel">
      <h3>Sync with Claude</h3>
      <p class="muted small">
        Use one wallet here and in earnrate in Claude. It's stored encrypted on
        earnrate's server; searches never leave your browser.{' '}
        <a href="/privacy#sync">What's stored</a>
      </p>
      <div class="row-buttons">
        <ConnectButton label="Use the same wallet as Claude" primary={false} />
      </div>
      {note ? <p class="callout">{note}</p> : null}
    </section>
  )
}

export function Connecting() {
  return (
    <section class="panel sync-panel" aria-live="polite">
      <p class="sync-status">
        <span class="sync-dot busy" aria-hidden="true" />
        Connecting to your Claude wallet…
      </p>
    </section>
  )
}

export function SyncStatus({
  online,
  busy,
  note,
  onStop,
}: {
  online: boolean
  busy: boolean
  note: string | null
  onStop: () => void
}) {
  return (
    <div class="sync-bar" aria-live="polite">
      <p class="sync-status">
        <span class={online ? 'sync-dot' : 'sync-dot off'} aria-hidden="true" />
        <span>
          {online ? 'Synced with your Claude wallet' : 'Offline'}
          {busy ? <span class="muted"> · saving…</span> : null}
        </span>
        <button
          type="button"
          class="link"
          data-count="wallet-sync-off"
          onClick={onStop}
        >
          Stop syncing
        </button>
      </p>
      {online ? null : (
        <p class="muted small">
          Showing your wallet as it was when you were last connected; answers
          and the cheat sheet still work. Changes need a connection.
        </p>
      )}
      {note && online ? <p class="muted small">{note}</p> : null}
    </div>
  )
}

const cardList = (w: Wallet) => w.cards.map((c) => shortName(c.id)).join(', ')

const count = (n: number) => `${String(n)} card${n === 1 ? '' : 's'}`

// The first connection, when this browser and the Claude wallet both have
// cards: nothing is merged without asking.
export function FirstChoice({
  claude,
  browser,
  error,
  busy,
  onChoose,
  onCancel,
}: {
  claude: Wallet
  browser: Wallet
  error: string | null
  busy: boolean
  onChoose: (choice: Choice) => void
  onCancel: () => void
}) {
  const also = walletDifferences(claude, browser, shortName)
  const sameCards =
    claude.cards.length === browser.cards.length &&
    cardList(claude) === cardList(browser)
  return (
    <section class="panel sync-panel sync-choice" aria-live="polite">
      <h3>Which wallet should earnrate keep?</h3>
      <p>
        {sameCards
          ? 'Your Claude wallet and this browser have the same cards, set up differently.'
          : 'Your Claude wallet and this browser both have cards.'}
      </p>
      <dl class="sync-sides">
        <dt>In Claude</dt>
        <dd>
          {count(claude.cards.length)}: {cardList(claude)}
        </dd>
        <dt>In this browser</dt>
        <dd>
          {count(browser.cards.length)}: {cardList(browser)}
        </dd>
      </dl>
      {also.length > 0 ? (
        <p class="sync-also">
          <strong>{sameCards ? 'They differ in' : 'Also differs'}:</strong>{' '}
          {also.join('; ')}.
        </p>
      ) : null}
      <fieldset class="lock" disabled={busy}>
        <ul class="sync-options">
          <li>
            <button type="button" onClick={() => onChoose('claude')}>
              Use my Claude wallet
            </button>
            <span class="muted small">
              This browser's {sameCards ? 'copy is' : 'cards are'} replaced.
            </span>
          </li>
          <li>
            <button type="button" onClick={() => onChoose('browser')}>
              Replace it with this browser's
            </button>
            <span class="muted small">
              The Claude wallet's {sameCards ? 'copy is' : 'cards are'}{' '}
              replaced.
            </span>
          </li>
          <li>
            <button type="button" onClick={() => onChoose('combine')}>
              Combine them
            </button>
            <span class="muted small">
              Every card from both, and point values from both. Where both set
              the same thing, the Claude wallet's wins.
            </span>
          </li>
        </ul>
        <button type="button" class="link" onClick={onCancel}>
          Don't sync
        </button>
      </fieldset>
      {busy ? <p class="muted small">Saving…</p> : null}
      {error ? <p class="callout">{error}</p> : null}
    </section>
  )
}

export function Ended({ onKeep }: { onKeep: () => void }) {
  return (
    <section class="panel sync-panel" aria-live="polite">
      <h3>This browser stopped syncing</h3>
      <p>
        It was signed out of your Claude wallet: the recovery code was changed,
        the wallet was deleted, or this browser went 90 days without using it.
        Your cards from it are still here, saved in this browser only.
      </p>
      <div class="row-buttons">
        <ConnectButton label="Connect again" />
        <button type="button" onClick={onKeep}>
          Keep this copy
        </button>
      </div>
    </section>
  )
}
