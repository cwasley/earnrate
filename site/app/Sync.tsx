import { useState } from 'preact/hooks'
import type { Wallet } from '../../src/schema/wallet.ts'
import { shortName } from './format.ts'

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

function ConnectButton({ label }: { label: string }) {
  const [going, setGoing] = useState(false)
  return (
    <button
      type="button"
      class="primary"
      data-count="wallet-sync-on"
      disabled={going}
      onClick={() => {
        setGoing(true)
        location.assign(CONNECT)
      }}
    >
      {going ? 'Connecting…' : label}
    </button>
  )
}

// What syncing sends and keeps, in the privacy page's words.
function SyncTerms() {
  return (
    <p class="muted small">
      With sync on, your wallet (cards, picks, activations, memberships, point
      values, cap and spending totals, credits and free nights used and not
      used, what a free night is worth to you if you've said, and opening dates)
      is stored encrypted on earnrate's server, as it is for Claude. Searches,
      stores and amounts you ask about still never leave your browser.{' '}
      <a href="/privacy#sync">How sync works</a>
    </p>
  )
}

// For someone not syncing: one wallet for this site and Claude.
export function ConnectPanel({ note }: { note: string | null }) {
  return (
    <section class="panel sync-panel">
      <h3>Sync with Claude</h3>
      <p>
        Use one wallet here and in earnrate in Claude, so a card you add in one
        shows up in the other. You sign in with your earnrate recovery code, or
        start a wallet if you don't use Claude yet.
      </p>
      <div class="row-buttons">
        <ConnectButton label="Use the same wallet as Claude" />
      </div>
      {note ? <p class="callout">{note}</p> : null}
      <SyncTerms />
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
  return (
    <section class="panel sync-panel sync-choice" aria-live="polite">
      <h3>Which wallet should earnrate keep?</h3>
      <p>Your Claude wallet and this browser both have cards.</p>
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
      <fieldset class="lock" disabled={busy}>
        <ul class="sync-options">
          <li>
            <button type="button" onClick={() => onChoose('claude')}>
              Use my Claude wallet
            </button>
            <span class="muted small">This browser's cards are replaced.</span>
          </li>
          <li>
            <button type="button" onClick={() => onChoose('browser')}>
              Replace it with this browser's
            </button>
            <span class="muted small">
              The Claude wallet's cards are replaced.
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
