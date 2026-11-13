import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { catalog } from 'virtual:catalog'
import { walletProblems } from '../../src/data/integrity.ts'
import { bonusStatus } from '../../src/engine/bonus.ts'
import { cheatSheet } from '../../src/engine/cheat-sheet.ts'
import { milestoneSummaries } from '../../src/engine/milestones.ts'
import { localToday } from '../../src/engine/periods.ts'
import { VALUATION_PROFILES } from '../../src/engine/profiles.ts'
import {
  cardInfo,
  knownMemberships,
  membershipsUsed,
  setupNotes,
  type SetupNote,
} from '../../src/engine/setup.ts'
import { currencyLabel, listed } from '../../src/engine/text.ts'
import { cardValuation } from '../../src/engine/valuation.ts'
import type { Wallet, WalletCard } from '../../src/schema/wallet.ts'
import { anniversaryOf } from '../../src/engine/renewal.ts'
import {
  checklistCalendar,
  checklistRows,
  type ChecklistRowItem,
} from '../../src/engine/checklist.ts'
import { addsAtOnce, askAddText } from './add-from-link.ts'
import { CardArt } from './CardArt.tsx'
import { CardPicker } from './AddCards.tsx'
import { CardSettings, hasFee, type CreditFocus } from './CardSettings.tsx'
import { Logo } from './Logo.tsx'
import { track } from './track.ts'
import { SheetDownload, useSheetSend, WalletPass } from './CheatSheetParts.tsx'
import { savedSpending } from './saved-spending.ts'
import {
  cardCount,
  cards,
  feeLabel,
  membershipName,
  pct,
  shortName,
  wholeDollars,
} from './format.ts'
import { load, save } from './settings.ts'
import {
  addOp,
  importOp,
  membershipsOp,
  removeOp,
  restoreOp,
  updateOp,
  type LocalOp,
  type Outcome,
  type WalletOp,
} from './sync.ts'

// Setup notes name what to set in CLI terms; this says where on the page.
function noteText(note: SetupNote, name: string): string {
  switch (note.kind) {
    case 'pick':
      return `${name} needs its bonus category picks: select it under Your cards.`
    case 'membership':
      return `${name} earns more with a membership: check Memberships below.`
    case 'activation':
      return `${name} has bonuses you activate with the issuer: select it under Your cards to mark them.`
    case 'anniversary':
      return `${name} has a cap that resets on your account anniversary: select it under Your cards to add it.`
    case 'rotation':
      return note.text
  }
}

function CheatSheet({ wallet }: { wallet: Wallet }) {
  const sheet = useMemo(
    () => cheatSheet(catalog, wallet, localToday()),
    [wallet],
  )
  const send = useSheetSend(wallet)
  useEffect(() => {
    track('cheat-sheet')
  }, [])
  return (
    <section class="panel sheet" id="cheat-sheet" aria-labelledby="sheet-title">
      <div class="sheet-head">
        <div>
          <span class="sheet-brand">earnrate</span>
          <h3 id="sheet-title">My card cheat sheet</h3>
          <p>{sheet.quarter} · the card to use for each purchase</p>
        </div>
        <div class="sheet-tools">
          {send.button}
          <SheetDownload sheet={sheet} />
          <Logo class="sheet-logo" chip="var(--accent)" />
        </div>
      </div>
      {send.status}
      <ol class="sheet-rows">
        {sheet.rows.map((row) => {
          const held = wallet.cards.find((c) => c.id === row.cardId)
          return (
            <li key={row.label}>
              <span class="sheet-label">{row.label}</span>
              <span class="sheet-card">
                {held ? <CardArt id={held.id} width={30} /> : null}
                <span class="sheet-card-name">
                  {held ? shortName(held.id) : 'None of your cards'}
                  {row.note ? <span class="row-note">{row.note}</span> : null}
                </span>
              </span>
              <span class="sheet-rate">
                {row.effectiveReturnPct === null
                  ? ''
                  : pct(row.effectiveReturnPct)}
              </span>
            </li>
          )
        })}
      </ol>
      <WalletPass wallet={wallet} />
    </section>
  )
}

function bonusLine(wallet: Wallet, held: WalletCard): string | null {
  const status = bonusStatus(catalog, wallet, held, localToday())
  if (!status) return null
  if (status.state === 'met') return 'Welcome bonus: met'
  if (status.state === 'expired') return 'Welcome bonus: deadline passed'
  if (status.spend === null) return 'Welcome bonus: tracking'
  const days =
    status.daysLeft === null ? '' : ` · ${String(status.daysLeft)} days left`
  return `Welcome bonus: ${wholeDollars(status.spent)} of ${wholeDollars(status.spend)}${days}`
}

// The next spend milestone still ahead this period, or the last one reached.
function milestoneLine(held: WalletCard): string | null {
  const card = cards.get(held.id)
  if (!card) return null
  const all = milestoneSummaries(card, held, localToday())
  const tracked = all.filter((m) => m.tracked)
  const next = tracked.find((m) => m.spent < m.spend) ?? tracked.at(-1)
  if (!next) return null
  return next.spent >= next.spend
    ? `Spend bonus: ${wholeDollars(next.spend)} reached`
    : `Spend bonus: ${wholeDollars(next.spent)} of ${wholeDollars(next.spend)}`
}

// A fee card with no date to tell when it renews: asked on its row, where
// the date goes.
const renewalAsks = (held: WalletCard) =>
  hasFee(held) && anniversaryOf(held) === null

function CardList({
  wallet,
  open,
  setOpen,
  focus,
  asked,
  onAsk,
  save: saveCard,
  onRemove,
}: {
  wallet: Wallet
  // The card whose Settings are showing; the to-do list can open one.
  open: string | null
  setOpen: (cardId: string | null) => void
  // The credits a to-do row opened them for. A new one (`n`) opens them
  // afresh, so a folded list or Credit details shows it.
  focus: (CreditFocus & { cardId: string; n: number }) | null
  // Cards whose "Keep or replace?" answer shows when their Settings do.
  asked: string[]
  onAsk: (cardId: string) => void
  save: (op: LocalOp) => Promise<string | null>
  onRemove: (cardId: string) => void
}) {
  return (
    <ul class="held">
      {wallet.cards.map((held) => {
        const card = cards.get(held.id)
        const info = card ? cardInfo(catalog, card, wallet, localToday()) : null
        const needsPick = info?.choices.some(
          (c) => c.default === null && !held.chosen?.picks[c.id],
        )
        const note = bonusLine(wallet, held) ?? milestoneLine(held)
        return (
          <li key={held.id} data-held={held.id}>
            <button
              type="button"
              class="held-row"
              aria-expanded={open === held.id}
              onClick={() => setOpen(open === held.id ? null : held.id)}
            >
              <span class="held-name">
                <CardArt id={held.id} width={40} />
                <span>
                  <strong>{shortName(held.id)}</strong>
                  <span class="muted held-fee">{feeLabel(held.id)}</span>
                  {note ? (
                    <span class="row-note">{note}</span>
                  ) : renewalAsks(held) ? (
                    <span class="row-note" data-ask="">
                      Add its renewal date
                    </span>
                  ) : null}
                </span>
              </span>
              <span class="muted">
                {open === held.id
                  ? 'Close'
                  : needsPick
                    ? 'Set picks'
                    : 'Settings'}
              </span>
            </button>
            {open === held.id ? (
              <CardSettings
                key={focus?.cardId === held.id ? focus.n : 0}
                wallet={wallet}
                held={held}
                asked={asked.includes(held.id)}
                focus={focus?.cardId === held.id ? focus : null}
                onAsk={() => onAsk(held.id)}
                save={(input) => saveCard(updateOp({ id: held.id, ...input }))}
                onClose={() => setOpen(null)}
                onRemove={() => {
                  setOpen(null)
                  onRemove(held.id)
                }}
                spending={savedSpending}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function Memberships({
  wallet,
  onChange,
  locked,
}: {
  wallet: Wallet
  onChange: (op: LocalOp) => Promise<boolean>
  locked: boolean
}) {
  const used = new Set(
    wallet.cards.flatMap((h) => {
      const card = cards.get(h.id)
      return card ? membershipsUsed(card) : []
    }),
  )
  const relevant = knownMemberships(catalog).filter((m) => used.has(m))
  if (relevant.length === 0) return null
  const on = relevant.filter((m) => wallet.memberships.includes(m))
  return (
    <details class="panel fold-panel">
      <summary>
        <h3>Memberships</h3>
        <span class="muted">
          {on.length === 0 ? 'None' : listed(on.map(membershipName))}
        </span>
      </summary>
      <p class="muted">Some of your cards earn more with these.</p>
      <fieldset class="lock" disabled={locked}>
        {relevant.map((m) => (
          <label class="check" key={m}>
            <input
              type="checkbox"
              checked={wallet.memberships.includes(m)}
              onChange={(e) =>
                void onChange(
                  membershipsOp(
                    e.currentTarget.checked
                      ? [...wallet.memberships, m]
                      : wallet.memberships.filter((x) => x !== m),
                  ),
                )
              }
            />
            {membershipName(m)}
          </label>
        ))}
      </fieldset>
    </details>
  )
}

const HEAVY: Record<string, number> = VALUATION_PROFILES['points-heavy']

const valuesOp = (values: Record<string, number | null>): LocalOp => ({
  tool: 'set_point_values',
  input: { values },
})

const cents = (n: number) => `${String(n)}¢`

// What the wallet's points are worth to the person, per program, folded
// behind its values: most people never change them.
function PointValues({
  wallet,
  onChange,
  locked,
}: {
  wallet: Wallet
  onChange: (op: LocalOp) => Promise<boolean>
  locked: boolean
}) {
  const ids = [
    ...new Set(
      wallet.cards.flatMap((h) => {
        const card = cards.get(h.id)
        return card ? [cardValuation(catalog, wallet, card).currency] : []
      }),
    ),
  ].filter((id) => id !== 'cash')
  if (ids.length === 0) return null
  const valueOf = (id: string) => {
    const own = wallet.valuations[id]
    return typeof own === 'number'
      ? own
      : (catalog.currencies.find((c) => c.id === id)?.value_cents ?? 1)
  }
  const values = [...new Set(ids.map(valueOf))].sort((a, b) => a - b)
  const range =
    values.length === 1
      ? `${cents(values[0] ?? 1)} each`
      : `${cents(values[0] ?? 1)} to ${cents(values.at(-1) ?? 1)}`
  // "I transfer points": the transfer programs at the points-heavy values.
  const transferable = ids.filter((id) => HEAVY[id] !== undefined)
  const transfers =
    transferable.length > 0 &&
    transferable.every((id) => wallet.valuations[id] === HEAVY[id])
  return (
    <details class="panel fold-panel">
      <summary>
        <h3>Point values</h3>
        <span class="muted">{range}</span>
      </summary>
      <fieldset class="lock" disabled={locked}>
        {transferable.length > 0 ? (
          <label class="check">
            <input
              type="checkbox"
              checked={transfers}
              onChange={(e) =>
                void onChange(
                  valuesOp(
                    Object.fromEntries(
                      transferable.map((id) => [
                        id,
                        e.currentTarget.checked ? (HEAVY[id] ?? null) : null,
                      ]),
                    ),
                  ),
                )
              }
            />
            I transfer points to airlines and hotels
          </label>
        ) : null}
        {ids.map((id) => {
          const set = typeof wallet.valuations[id] === 'number'
          const value = valueOf(id)
          const saveValue = (c: number | null) =>
            void onChange(valuesOp({ [id]: c }))
          const step = (by: number) =>
            saveValue(
              Math.min(5, Math.max(0.1, Math.round((value + by) * 10) / 10)),
            )
          const name = currencyLabel(catalog, id)
          return (
            <div class="point-value" key={id}>
              <span>{name}</span>
              <span class="stepper">
                <button
                  type="button"
                  aria-label={`Lower ${name}`}
                  disabled={value <= 0.1}
                  onClick={() => step(-0.1)}
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  max="5"
                  step="0.1"
                  aria-label={`${name}, cents per point`}
                  value={value}
                  onChange={(e) => {
                    const c = Number(e.currentTarget.value)
                    if (c > 0 && c <= 5) saveValue(c)
                  }}
                />
                <button
                  type="button"
                  aria-label={`Raise ${name}`}
                  disabled={value >= 5}
                  onClick={() => step(0.1)}
                >
                  +
                </button>
                ¢
              </span>
              {set ? (
                <button
                  type="button"
                  class="link"
                  onClick={() => saveValue(null)}
                >
                  Reset
                </button>
              ) : null}
            </div>
          )
        })}
        <p class="muted small">From 0.1¢ to 5¢ a point.</p>
      </fieldset>
    </details>
  )
}

// Rows past these wait behind "N more"; the list is soonest first.
const TODO_SHOWN = 3

type OpenCard = (cardId: string, keep?: boolean, credits?: CreditFocus) => void

// A credit row's button opens Settings at that credit: "Mark used" at its
// Used so far box, Answer, Enroll and Set up at its tiles.
function creditFocus(item: ChecklistRowItem): CreditFocus | undefined {
  if (item.ref === undefined) return undefined
  if (item.kind === 'credit') return { ids: [item.ref], used: true }
  if (item.kind === 'enroll') return { ids: item.ref.split(','), used: false }
  return undefined
}

// A row's button: a link for a change (the issuer's page or the card's),
// "Keep or replace?" for a renewal, and the card's Settings for the rest.
function TodoButton({
  item,
  onOpenCard,
}: {
  item: ChecklistRowItem
  onOpenCard: OpenCard
}) {
  const { button, url } = item.row
  if (button === null) return null
  if (url !== undefined) {
    const own = url.startsWith('https://earnrate.dev/')
      ? url.slice('https://earnrate.dev'.length)
      : null
    return own === null ? (
      <a class="todo-go" href={url} rel="noopener" target="_blank">
        {button}
      </a>
    ) : (
      <a class="todo-go" href={own}>
        {button}
      </a>
    )
  }
  return (
    <button
      type="button"
      class="todo-go"
      onClick={() => {
        onOpenCard(item.cardId, item.kind === 'renewal', creditFocus(item))
      }}
    >
      {button}
    </button>
  )
}

// What the cards need this period, soonest first, folded behind its header
// when the person closes it. The calendar file is built here and saved by the
// browser; nothing is sent anywhere.
function ThisQuarter({
  wallet,
  onOpenCard,
}: {
  wallet: Wallet
  onOpenCard: OpenCard
}) {
  const items = useMemo(
    () =>
      checklistRows(
        catalog,
        wallet,
        localToday(),
        undefined,
        shortName,
        savedSpending(),
      ),
    // The spending rows come from storage and change only on the other tab.
    [wallet],
  )
  const [open, setOpen] = useState(() => load('todo', { open: true }).open)
  const [all, setAll] = useState(false)
  if (items.length === 0) return null
  const tasks = items.filter((i) => i.row.note !== true)
  const notes = items.filter((i) => i.row.note === true)
  const shown = all ? tasks : tasks.slice(0, TODO_SHOWN)
  const dated = items.some(
    (i) => i.due !== null && i.kind !== 'cap' && i.kind !== 'rotation',
  )
  return (
    <details
      class="panel todo-panel"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open
        if (now === open) return
        setOpen(now)
        save('todo', { open: now })
      }}
    >
      <summary>
        <h3>To do</h3>
        {tasks.length > 0 ? <span class="badge">{tasks.length}</span> : null}
      </summary>
      <div class="todo-body">
        {tasks.length > 0 ? (
          <ul class="todo-list">
            {shown.map((i) => (
              <li
                key={`${i.kind}-${i.cardId}-${i.ref ?? i.text}`}
                class="todo-row"
                data-kind={i.kind}
              >
                <CardArt id={i.cardId} width={32} />
                <span class="todo-text">
                  <strong>{i.row.title}</strong>
                  <span class="todo-meta">
                    <span>
                      {i.row.amount === null
                        ? i.row.card
                        : `${i.row.card} · ${i.row.amount}`}
                    </span>
                    {i.row.when === null ? null : (
                      <span class="todo-when">{i.row.when}</span>
                    )}
                  </span>
                </span>
                <TodoButton item={i} onOpenCard={onOpenCard} />
              </li>
            ))}
          </ul>
        ) : null}
        {tasks.length > TODO_SHOWN ? (
          <button
            type="button"
            class="more todo-more"
            aria-expanded={all}
            onClick={() => setAll(!all)}
          >
            {all ? 'Show fewer' : `${String(tasks.length - TODO_SHOWN)} more`}
          </button>
        ) : null}
        {notes.map((i) => (
          <p class="muted small todo-note" key={i.ref ?? i.text}>
            {i.row.title}
            {i.row.url === undefined || i.row.button === null ? null : (
              <>
                {' '}
                <a href={i.row.url.slice('https://earnrate.dev'.length)}>
                  {i.row.button}
                </a>
              </>
            )}
          </p>
        ))}
        {dated ? (
          <div class="todo-foot">
            <button
              type="button"
              class="todo-go"
              onClick={() => {
                const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`
                const url = URL.createObjectURL(
                  new Blob([checklistCalendar(items, stamp)], {
                    type: 'text/calendar',
                  }),
                )
                const a = document.createElement('a')
                a.href = url
                a.download = 'earnrate.ics'
                a.click()
                setTimeout(() => URL.revokeObjectURL(url), 10_000)
              }}
            >
              Add the dates to your calendar
            </button>
          </div>
        ) : null}
      </div>
    </details>
  )
}

async function exportWallet(wallet: Wallet) {
  track('wallet-export')
  const { walletYaml } = await import('../../src/format/wallet-yaml.ts')
  const url = URL.createObjectURL(
    new Blob([walletYaml(wallet)], { type: 'text/yaml' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = 'wallet.yaml'
  a.click()
  // Some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// On a phone, outside the installed app: how to add earnrate to the Home
// Screen, where it opens straight to this tab and works with no signal.
function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    const standalone =
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true
    return (
      standalone ||
      !matchMedia('(pointer: coarse)').matches ||
      load('install-hint', { dismissed: false }).dismissed
    )
  })
  if (hidden) return null
  const how = /iPhone|iPad|iPod/.test(navigator.userAgent)
    ? 'tap Share, then Add to Home Screen'
    : "open your browser's menu and tap Add to Home screen"
  return (
    <p class="callout install-hint">
      <span>
        Use earnrate at the register: {how}. It opens to your wallet and works
        offline.
      </span>
      <button
        type="button"
        class="link"
        onClick={() => {
          save('install-hint', { dismissed: true })
          setHidden(true)
        }}
      >
        Dismiss
      </button>
    </p>
  )
}

// A wallet file from the command line or Claude Desktop, read here. Synced,
// it replaces the Claude wallet too, so it asks first.
function useImport(
  synced: boolean,
  onImport: (op: WalletOp) => Promise<Outcome>,
) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const run = (yaml: string) => {
    void onImport(importOp(yaml)).then((result) => {
      if (!result.ok) setError(result.error)
      else {
        track('wallet-import')
        setError(null)
      }
    })
  }
  const input = (
    <input
      type="file"
      accept=".yaml,.yml,text/yaml"
      onChange={(e) => {
        const file = e.currentTarget.files?.[0]
        if (!file) return
        void file.text().then((yaml) => {
          if (synced) setPending(yaml)
          else run(yaml)
        })
        e.currentTarget.value = ''
      }}
    />
  )
  const confirm =
    pending === null ? null : (
      <div class="row-buttons">
        <button
          type="button"
          class="danger"
          onClick={() => {
            run(pending)
            setPending(null)
          }}
        >
          Replace my synced wallet with this file
        </button>
        <button type="button" onClick={() => setPending(null)}>
          Cancel
        </button>
      </div>
    )
  const shown = error ? <p class="callout">{error}</p> : null
  return { input, confirm, error: shown }
}

// An empty wallet's one way in besides tapping cards.
function ImportLink({
  synced,
  locked,
  onImport,
}: {
  synced: boolean
  locked: boolean
  onImport: (op: WalletOp) => Promise<Outcome>
}) {
  const file = useImport(synced, onImport)
  return (
    <fieldset class="lock import-link" disabled={locked}>
      <p class="muted small">
        Have a wallet file?{' '}
        <label class="file-link">
          Import it
          {file.input}
        </label>
      </p>
      {file.confirm}
      {file.error}
    </fieldset>
  )
}

function Transfer({
  wallet,
  synced,
  locked,
  onImport,
  onDelete,
}: {
  wallet: Wallet
  synced: boolean
  locked: boolean
  onImport: (op: WalletOp) => Promise<Outcome>
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const file = useImport(synced, onImport)
  return (
    <details class="panel fold-panel">
      <summary>
        <h3>Back up or move your wallet</h3>
      </summary>
      <p class="muted">
        {synced
          ? 'Your wallet is synced with earnrate in Claude. Download a backup to keep a copy or use it with the command line; importing a file replaces the synced wallet.'
          : 'Your wallet is saved only in this browser. Download a backup to keep a copy, or to use it with the command line or earnrate for Claude Desktop; import one to bring it here.'}
      </p>
      <fieldset class="lock" disabled={locked}>
        <div class="row-buttons">
          <button type="button" onClick={() => void exportWallet(wallet)}>
            Download a backup
          </button>
          <label class="file-button">
            Import a wallet file
            {file.input}
          </label>
        </div>
        {file.confirm}
      </fieldset>
      {file.error}
      {synced ? (
        <p class="muted small">
          To delete the synced wallet, ask earnrate in Claude to delete it. Stop
          syncing keeps a copy in this browser.
        </p>
      ) : (
        <fieldset class="lock delete-wallet" disabled={locked}>
          {confirming ? (
            <div class="row-buttons">
              <button
                type="button"
                class="danger"
                onClick={() => {
                  setConfirming(false)
                  onDelete()
                }}
              >
                Yes, delete it from this browser
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              class="link danger-link"
              onClick={() => setConfirming(true)}
            >
              Delete wallet
            </button>
          )}
        </fieldset>
      )}
    </details>
  )
}

export function MyWallet({
  wallet,
  perform,
  onDelete,
  synced,
  locked,
  lockNote,
  syncTop,
  connect,
}: {
  wallet: Wallet | null
  perform: (op: WalletOp) => Promise<Outcome>
  onDelete: () => void
  synced: boolean
  locked: boolean
  lockNote: string | null
  syncTop: ComponentChildren // sync status, the first-connection choice
  connect: ComponentChildren // "Use the same wallet as Claude"
}) {
  const [message, setMessage] = useState<{
    text: string
    error: boolean
    undo?: () => void
  } | null>(null)
  const [openCard, setOpenCard] = useState<string | null>(null)
  const [focus, setFocus] = useState<
    (CreditFocus & { cardId: string; n: number }) | null
  >(null)
  const [keepAsked, setKeepAsked] = useState<string[]>([])
  const askKeep = (cardId: string) => {
    track('wallet-keep-or-replace')
    setKeepAsked((ids) => (ids.includes(cardId) ? ids : [...ids, cardId]))
  }

  // One change: refused, or done with what the card still needs.
  const apply = async (op: LocalOp, cardId?: string): Promise<boolean> => {
    const result = await perform(op)
    if (!result.ok) {
      setMessage({ text: result.error, error: true })
      return false
    }
    setMessage(
      result.notes.length > 0
        ? {
            text: [
              ...new Set(
                result.notes.map((n) => noteText(n, shortName(cardId ?? ''))),
              ),
            ].join(' '),
            error: false,
          }
        : null,
    )
    return true
  }

  // The add flow (common cards and the search) stays up from its first add,
  // or from "Add a card", until Done. `gridAdded` is what it added: the only
  // cards it may take back out.
  const [building, setBuilding] = useState(false)
  const [gridAdded, setGridAdded] = useState<string[]>([])
  const openGrid = () => {
    setGridAdded([])
    setBuilding(true)
    setMessage(null)
    requestAnimationFrame(() => {
      document.querySelector('.tabs')?.scrollIntoView({ block: 'start' })
    })
  }

  // What the cards need is said once, at Done, under Your cards.
  const addFromGrid = async (cardId: string): Promise<boolean> => {
    setBuilding(true)
    const result = await perform(addOp(cardId))
    setMessage(result.ok ? null : { text: result.error, error: true })
    if (result.ok)
      setGridAdded((ids) => (ids.includes(cardId) ? ids : [...ids, cardId]))
    return result.ok
  }
  const removeFromGrid = async (cardId: string) => {
    if (!gridAdded.includes(cardId)) return
    const result = await perform(removeOp(cardId))
    setMessage(result.ok ? null : { text: result.error, error: true })
  }
  const doneBuilding = () => {
    setBuilding(false)
    setGridAdded([])
    const today = localToday()
    const needs = wallet
      ? wallet.cards.flatMap((held) =>
          setupNotes(catalog, wallet, held, today).map((n) =>
            noteText(n, shortName(held.id)),
          ),
        )
      : []
    setMessage(
      needs.length > 0
        ? { text: [...new Set(needs)].join(' '), error: false }
        : null,
    )
    requestAnimationFrame(() => {
      document.querySelector('.tabs')?.scrollIntoView({ block: 'start' })
    })
  }

  // Opens a card's Settings in Your cards and scrolls to it: from the to-do
  // list, and from a card page's "Add it to your wallet". `keep` opens its
  // "Keep or replace?" answer; `credits` scrolls to those credits and puts
  // the focus on the first.
  const openCardSettings: OpenCard = (cardId, keep = false, credits) => {
    setOpenCard(cardId)
    setFocus((f) =>
      credits ? { ...credits, cardId, n: (f?.n ?? 0) + 1 } : null,
    )
    if (keep) askKeep(cardId)
    requestAnimationFrame(() => {
      const card = `[data-held="${CSS.escape(cardId)}"]`
      const [first] = credits?.ids ?? []
      const at =
        first === undefined
          ? null
          : document.querySelector<HTMLElement>(
              `${card} ${credits?.used ? '.credit-detail' : '.credit-tile'}[data-credit="${CSS.escape(first)}"]`,
            )
      if (at) {
        const control = at.querySelector<HTMLElement>('input, button')
        at.scrollIntoView({ block: 'center' })
        control?.focus({ preventScroll: true })
        return
      }
      document
        .querySelector(keep ? `[data-keep="${CSS.escape(cardId)}"]` : card)
        ?.scrollIntoView({ block: 'start' })
    })
  }

  // Adds a card the person chose elsewhere, opens its Settings (picks, an
  // opening date, a welcome bonus) and offers Undo. Already held: says so.
  const addAndOpen = async (cardId: string) => {
    setBuilding(false)
    setGridAdded([])
    if (wallet?.cards.some((c) => c.id === cardId)) {
      openCardSettings(cardId)
      setMessage({
        text: `${shortName(cardId)} is already in your wallet.`,
        error: false,
      })
      return
    }
    if (locked) {
      setMessage({
        text: `${shortName(cardId)} wasn't added: ${lockNote ?? 'changes need a connection.'}`,
        error: true,
      })
      return
    }
    if (!(await apply(addOp(cardId), cardId))) return
    openCardSettings(cardId)
    setMessage(() => ({
      text: `Added ${shortName(cardId)}. Its Settings are open above.`,
      error: false,
      undo: () => {
        void apply(removeOp(cardId)).then((ok) => {
          if (ok)
            setMessage({
              text: `Took ${shortName(cardId)} back out.`,
              error: false,
            })
        })
      },
    }))
  }

  // Rate my wallet's "Save these cards" names several: each one not already
  // held is added, and what the cards still need is said once.
  const addSeveral = async (ids: string[]) => {
    setBuilding(false)
    setGridAdded([])
    if (locked) {
      setMessage({
        text: `The cards weren't added: ${lockNote ?? 'changes need a connection.'}`,
        error: true,
      })
      return
    }
    const added: string[] = []
    for (const id of ids) {
      if (wallet?.cards.some((c) => c.id === id)) continue
      const result = await perform(addOp(id))
      if (!result.ok) {
        setMessage({ text: result.error, error: true })
        return
      }
      added.push(id)
    }
    setMessage({
      text:
        added.length === 0
          ? 'Those cards are already in your wallet.'
          : `Added ${listed(added.map(shortName))}.`,
      error: false,
    })
  }

  // A card page's "Add it to your wallet" arrives as #wallet&add=<card id>,
  // on load or as a change to the address. The id is read once and cleared.
  // From anywhere but an earnrate.dev page, the cards are asked about first.
  // `card=<card>` opens a held card's Settings, from a card page.
  const [asking, setAsking] = useState<string[] | null>(null)
  const addNamed = (ids: string[]) => {
    track('page-add')
    const [only] = ids
    if (ids.length === 1 && only !== undefined) void addAndOpen(only)
    else void addSeveral(ids)
  }
  const addFromAddress = () => {
    const params = new URLSearchParams(location.hash.slice(1))
    const param = (['add', 'card'] as const).find((k) => params.has(k))
    if (param === undefined || !params.has('wallet')) return
    const atOnce = addsAtOnce({
      hash: location.hash,
      referrer: document.referrer,
      origin: location.origin,
    })
    const ids = params
      .getAll(param)
      .filter((id) => catalog.cards.some((c) => c.id === id))
    for (const k of ['add', 'card']) params.delete(k)
    const rest = params.toString().replace(/=(?=&|$)/g, '')
    history.replaceState(null, '', `#${rest || 'wallet'}`)
    const [cardId] = ids
    if (cardId === undefined) return
    if (param === 'add') {
      const unheld = [...new Set(ids)].filter(
        (id) => !wallet?.cards.some((c) => c.id === id),
      )
      if (atOnce || unheld.length === 0) addNamed(ids)
      else {
        setAsking(unheld)
        requestAnimationFrame(() => scrollTo({ top: 0 }))
      }
    } else {
      track('page-settings')
      if (wallet?.cards.some((c) => c.id === cardId)) openCardSettings(cardId)
      else
        setMessage({
          text: `${shortName(cardId)} isn't in your wallet.`,
          error: false,
        })
    }
  }
  const addFromAddressRef = useRef(addFromAddress)
  addFromAddressRef.current = addFromAddress
  useEffect(() => {
    const onChange = () => {
      addFromAddressRef.current()
    }
    onChange()
    addEventListener('hashchange', onChange)
    return () => {
      removeEventListener('hashchange', onChange)
    }
  }, [])

  const askAdd =
    asking === null ? null : (
      <section class="panel add-ask" aria-labelledby="add-ask-title">
        <h3 id="add-ask-title">{askAddText(asking.length)}</h3>
        <p>
          A link named {asking.length === 1 ? 'it' : 'them'}. Nothing is added
          unless you say so.
        </p>
        <ul class="add-ask-cards">
          {asking.map((id) => (
            <li key={id}>
              <CardArt id={id} width={32} />
              <span>{shortName(id)}</span>
            </li>
          ))}
        </ul>
        <div class="row-buttons">
          <button
            type="button"
            class="primary"
            onClick={() => {
              setAsking(null)
              addNamed(asking)
            }}
          >
            Add
          </button>
          <button type="button" onClick={() => setAsking(null)}>
            Not now
          </button>
        </div>
      </section>
    )

  const problems = wallet ? walletProblems(wallet, catalog) : []

  const shown: typeof message =
    message ?? (lockNote ? { text: lockNote, error: false } : null)
  const messageLine = shown ? (
    <p class={`${shown.error ? 'callout' : 'muted'} message-line`}>
      {shown.text}
      {shown.undo ? (
        <>
          {' '}
          <button type="button" class="link" onClick={shown.undo}>
            Undo
          </button>
        </>
      ) : null}
    </p>
  ) : null

  if (wallet && problems.length > 0) {
    return (
      <div class="panels">
        {syncTop}
        <p class="callout">
          The wallet saved in this browser has problems: {problems.join(' ')}
        </p>
        <Transfer
          wallet={wallet}
          synced={synced}
          locked={locked}
          onImport={perform}
          onDelete={onDelete}
        />
      </div>
    )
  }

  // Memberships and point values can be saved before any card.
  const count = wallet?.cards.length ?? 0
  if (!wallet || count === 0 || building) {
    return (
      <div class="panels">
        {syncTop}
        {askAdd}
        <section class="panel first" aria-labelledby="quick-title">
          <h3 id="quick-title">
            {count === 0 ? 'Which cards do you have?' : 'Add a card'}
          </h3>
          {count === 0 ? (
            <p>
              {synced
                ? "Tap the ones you have, and earnrate tells you which to use anywhere. They're saved in your Claude wallet too: never a card number."
                : 'Tap the ones you have, and earnrate tells you which to use anywhere. Your wallet is saved only in this browser: no account, and never a card number.'}
            </p>
          ) : null}
          {wallet?.cards.some((c) => !gridAdded.includes(c.id)) ? (
            <p class="muted small">
              Cards you already had show In your wallet: change or remove those
              under Your cards.
            </p>
          ) : null}
          <CardPicker
            wallet={wallet}
            added={gridAdded}
            locked={locked}
            onAdd={addFromGrid}
            onRemove={(cardId) => void removeFromGrid(cardId)}
          />
          {messageLine}
          {count === 0 ? null : (
            <div class="quick-done">
              <span>{cardCount(count)} in your wallet</span>
              <button type="button" class="primary" onClick={doneBuilding}>
                Done
              </button>
            </div>
          )}
        </section>
        {count === 0 ? (
          <ImportLink synced={synced} locked={locked} onImport={perform} />
        ) : null}
      </div>
    )
  }

  // Removed at once, with Undo, which adds the card back with what it held.
  // The page stays at Your cards rather than where the closed Settings were.
  const remove = (cardId: string) => {
    const held = wallet.cards.find((c) => c.id === cardId)
    if (!held) return
    const name = shortName(cardId)
    void apply(removeOp(cardId), cardId).then((ok) => {
      if (!ok) return
      setMessage({
        text: `Removed ${name}.`,
        error: false,
        undo: () => {
          void apply(restoreOp(catalog, held, localToday()), cardId).then(
            (back) => {
              if (back)
                setMessage({
                  text: `${name} is back in your wallet.`,
                  error: false,
                })
            },
          )
        },
      })
      // Remove card went with its Settings, so Undo takes the focus.
      requestAnimationFrame(() => {
        const line = document.querySelector('.message-line')
        line?.scrollIntoView({ block: 'center' })
        line?.querySelector('button')?.focus({ preventScroll: true })
      })
    })
  }

  // A returning visitor's order: the cheat sheet, what to do, their cards,
  // then everything else folded. Wide screens keep the cheat sheet beside
  // the rest (data-area places it).
  return (
    <div class="panels wallet-grid">
      {syncTop}
      {askAdd}
      <CheatSheet wallet={wallet} />
      <div class="wallet-main">
        <ThisQuarter wallet={wallet} onOpenCard={openCardSettings} />
        <section class="panel" aria-labelledby="your-cards-title">
          <h3 id="your-cards-title">Your cards</h3>
          <fieldset class="lock" disabled={locked}>
            <CardList
              wallet={wallet}
              open={openCard}
              setOpen={(cardId) => {
                setFocus(null)
                setOpenCard(cardId)
              }}
              focus={focus}
              asked={keepAsked}
              onAsk={askKeep}
              save={(op) => perform(op).then((r) => (r.ok ? null : r.error))}
              onRemove={remove}
            />
            <button type="button" class="add-card" onClick={openGrid}>
              Add a card
            </button>
          </fieldset>
          {messageLine}
          <p class="wallet-links">
            <a href="/rate" data-count="wallet-rate">
              Rate my wallet
            </a>
            <a href="#spending">Would another card help?</a>
            <a href="/statement" data-count="statement-check">
              Check a statement
            </a>
          </p>
          <InstallHint />
        </section>
        <Memberships wallet={wallet} onChange={apply} locked={locked} />
        <PointValues wallet={wallet} onChange={apply} locked={locked} />
        {connect}
        <Transfer
          wallet={wallet}
          synced={synced}
          locked={locked}
          onImport={perform}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}
