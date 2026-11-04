import { useEffect, useMemo, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import { walletProblems } from '../../src/data/integrity.ts'
import { bonusStatus } from '../../src/engine/bonus.ts'
import {
  cheatSheet,
  EVERYDAY_PURCHASES,
  quickPickText,
  type CheatSheet,
} from '../../src/engine/cheat-sheet.ts'
import { ALL_PERSONAL_CARDS } from '../../src/engine/explore.ts'
import { activationGroup } from '../../src/engine/evaluate.ts'
import { milestoneSummaries } from '../../src/engine/milestones.ts'
import { inEffect, localToday } from '../../src/engine/periods.ts'
import { ABROAD, recommend } from '../../src/engine/recommend.ts'
import {
  cardInfo,
  knownMemberships,
  membershipsUsed,
  searchCards,
  type SetupNote,
} from '../../src/engine/setup.ts'
import {
  resolveSpendLines,
  simulateAdditions,
  TYPICAL_MONTHLY_SPEND,
} from '../../src/engine/simulate.ts'
import {
  categoryPhrase,
  currencyLabel,
  currencyName,
} from '../../src/engine/text.ts'
import { cardValuation } from '../../src/engine/valuation.ts'
import type { Recommendation } from '../../src/engine/types.ts'
import {
  addToWallet,
  removeFromWallet,
  updateInWallet,
  withMemberships,
  withValuations,
  type CardInput,
  type WalletChange,
} from '../../src/engine/wallet-change.ts'
import { resolvePlace } from '../../src/merchants/resolve.ts'
import type { Wallet, WalletCard } from '../../src/schema/wallet.ts'
import { CardArt } from './CardArt.tsx'
import { Logo } from './Logo.tsx'
import { track } from './track.ts'
import { cheatSheetImage } from './sheet-image.ts'
import { lineFor, type Row } from './Spending.tsx'
import {
  cards,
  feeLabel,
  issuerName,
  membershipName,
  pct,
  shortName,
  wholeDollars,
  words,
} from './format.ts'
import { ABROAD_NOTE, AbroadToggle } from './AbroadToggle.tsx'
import { SearchInput } from './SearchInput.tsx'
import { load, loadList, save } from './settings.ts'
import { checklist, checklistCalendar } from '../../src/engine/checklist.ts'
import { offerTerms } from '../../src/engine/offers.ts'
import { capitalize, dollarsAndCents } from '../../src/engine/text.ts'

// The first everyday purchases, as quick picks for one question.
const QUICK = EVERYDAY_PURCHASES.slice(0, 6).map(quickPickText)

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

function ask(
  wallet: Wallet,
  text: string,
  amount: number | null,
  abroad: boolean,
) {
  const purchase = {
    merchant: text,
    amount,
    channel: null,
    date: localToday(),
    country: abroad ? ABROAD : 'US',
  }
  return recommend(catalog, wallet, purchase, resolvePlace(catalog, text, null))
}

function Answer({ wallet, rec }: { wallet: Wallet; rec: Recommendation }) {
  const decided = rec.decision
  const top = rec.ranked.find((r) => r.cardId === decided?.cardId)
  const held = wallet.cards.find((c) => c.id === decided?.cardId)
  return (
    <div class="answer">
      {decided && held ? (
        <p class="verdict">
          Use <strong>{shortName(held.id)}</strong>
          {rec.bonus ? ' for its welcome bonus' : ''}:{' '}
          {pct(decided.effectiveReturnPct)} back
          {top?.earned !== null && top?.earned !== undefined
            ? `, about ${dollarsAndCents(top.earned)}`
            : ''}
          .
        </p>
      ) : (
        <p class="verdict">None of your cards work here.</p>
      )}
      {rec.warnings.map((w) => (
        <p class="callout" key={w}>
          {w}
        </p>
      ))}
      {rec.notes.map((n) => (
        <p class="muted" key={n}>
          {n}
        </p>
      ))}
      <ol class="result-list">
        {rec.ranked
          .map((r, i) => ({ r, rank: i + 1 }))
          .filter(({ r, rank }) => rank <= 3 || r.cardId === rec.bonus?.cardId)
          .map(({ r, rank }) => (
            <li class="result" key={r.cardId}>
              <div class="result-top">
                <span class="rank">{rank}</span>
                <CardArt id={r.cardId} />
                <div class="result-name">
                  <strong>{shortName(r.cardId)}</strong>
                  {r.cardId === rec.bonus?.cardId ? (
                    <span class="muted">The pick, for its welcome bonus</span>
                  ) : null}
                </div>
                <span class="rate">{pct(r.effectiveReturnPct)}</span>
              </div>
              {r.warnings.map((w) => (
                <p class="warn" key={w}>
                  {w}
                </p>
              ))}
              <details>
                <summary>Why</summary>
                {r.reasoning.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                <p class="muted">
                  Wrong rate? <a href="/support">Tell us</a>.
                </p>
              </details>
            </li>
          ))}
      </ol>
      {rec.sensitivity ? <p class="muted">{rec.sensitivity}</p> : null}
      <ul class="assumptions">
        {rec.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  )
}

function CheatSheet({ wallet }: { wallet: Wallet }) {
  const sheet = useMemo(
    () => cheatSheet(catalog, wallet, localToday()),
    [wallet],
  )
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
          <button
            type="button"
            class="sheet-download"
            aria-label="Download as an image"
            title="Download as an image"
            onClick={() => {
              track('cheat-sheet-image')
              void saveSheet(sheet)
            }}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
            </svg>
          </button>
          <Logo class="sheet-logo" chip="var(--accent)" />
        </div>
      </div>
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

const PASS_URL = 'https://pass.earnrate.dev/'

// The one thing earnrate.dev sends anywhere: what the pass needs (card ids,
// picks, activations, checkout labels, memberships), never amounts or
// searches. The signer keeps nothing.
function WalletPass({ wallet }: { wallet: Wallet }) {
  const sent = JSON.stringify({
    memberships: wallet.memberships,
    cards: wallet.cards.map((c) => ({
      id: c.id,
      checkout_label: c.checkout_label,
      chosen: c.chosen,
      activated: c.activated,
    })),
  })
  return (
    <form
      class="wallet-pass"
      method="post"
      action={PASS_URL}
      onSubmit={() => {
        track('apple-wallet')
      }}
    >
      <input type="hidden" name="wallet" value={sent} />
      <input type="hidden" name="date" value={localToday()} />
      <button type="submit" aria-label="Add to Apple Wallet">
        <img src="/add-to-apple-wallet.svg" alt="" width="126" height="40" />
      </button>
      <p class="muted">
        For iPhone: this cheat sheet in Apple Wallet, good until the quarter
        ends. This sends your card names and picks (no amounts) to earnrate's
        server, which makes the pass and keeps nothing.
      </p>
    </form>
  )
}

async function saveSheet(sheet: CheatSheet) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const blob = await cheatSheetImage(sheet, shortName, pct, dark)
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `earnrate-cheat-sheet-${sheet.quarter.toLowerCase().replace(/\s+/g, '-')}.png`
  a.click()
  // Some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function offerText(card: NonNullable<ReturnType<typeof cards.get>>): string {
  const o = card.welcome_offer
  if (!o || !inEffect(o, localToday())) return ''
  return `Published offer: ${offerTerms(o, currencyName(catalog, card.currency))}.`
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

function CardEditor({
  wallet,
  held,
  onChange,
  onRemove,
}: {
  wallet: Wallet
  held: WalletCard
  onChange: (change: WalletChange, cardId: string) => void
  onRemove: (cardId: string) => void
}) {
  const card = cards.get(held.id)
  const info = card ? cardInfo(catalog, card, wallet, localToday()) : null
  const [picks, setPicks] = useState<Record<string, string[]>>(
    held.chosen?.picks ?? {},
  )
  const [activated, setActivated] = useState<string[]>(held.activated)
  const [anniversary, setAnniversary] = useState(held.anniversary ?? '')
  const [tracking, setTracking] = useState(held.bonus !== undefined)
  // One opening date serves the welcome bonus and any first-year rate.
  const [opened, setOpened] = useState(held.opened ?? held.bonus?.opened ?? '')
  const [spent, setSpent] = useState(held.bonus ? String(held.bonus.spent) : '')
  const milestones = card ? milestoneSummaries(card, held, localToday()) : []
  const trackedSpend = milestones.find((m) => m.tracked)
  const [yearSpent, setYearSpent] = useState(
    trackedSpend ? String(trackedSpend.spent) : '',
  )
  if (!info || !card) return null
  const offer = card.welcome_offer

  const save = () => {
    const chosen = Object.fromEntries(
      Object.entries(picks).filter(([, options]) => options.length > 0),
    )
    const input: CardInput = { id: held.id, activated }
    if (Object.keys(chosen).length > 0) input.picks = chosen
    if (anniversary !== '') input.anniversary = anniversary
    if (info.introRates.length > 0) {
      if (opened !== '') input.opened = opened
      else if (held.opened !== undefined) input.opened = null
    }
    if (tracking && opened !== '')
      input.bonus = { opened, spent: Math.max(0, Number(spent) || 0) }
    else if (!tracking && held.bonus) input.bonus = null
    // Every purchase counts toward every milestone, so one total sets them all.
    if (milestones.length > 0 && yearSpent !== '') {
      const dollars = Math.max(0, Number(yearSpent) || 0)
      input.milestoneSpent = Object.fromEntries(
        milestones.map((m) => [m.id, dollars]),
      )
    }
    onChange(updateInWallet(catalog, wallet, input, localToday()), held.id)
  }

  return (
    <div class="editor">
      {info.choices.map((choice) => {
        const chosen = picks[choice.id] ?? []
        return (
          <fieldset key={choice.id}>
            <legend>
              {words(choice.id)}: pick {choice.pick}
              {choice.period === 'quarter' ? ' this quarter' : ''}
            </legend>
            {choice.options.map((option) => {
              const on = chosen.includes(option)
              return (
                <label class="check" key={option}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && chosen.length >= choice.pick}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked
                      setPicks((prev) => {
                        const now = prev[choice.id] ?? []
                        return {
                          ...prev,
                          [choice.id]: checked
                            ? [...now, option]
                            : now.filter((o) => o !== option),
                        }
                      })
                    }}
                  />
                  {words(option)}
                </label>
              )
            })}
          </fieldset>
        )
      })}
      {info.activation.length > 0 ? (
        <fieldset>
          <legend>
            Bonuses you've activated with {issuerName(info.issuer)}
          </legend>
          {info.activation.map((rule) => (
            <label class="check" key={rule}>
              <input
                type="checkbox"
                checked={activationGroup(card, rule).some((r) =>
                  activated.includes(r),
                )}
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  const group = activationGroup(card, rule)
                  setActivated((prev) =>
                    checked
                      ? [...prev, rule]
                      : prev.filter((r) => !group.includes(r)),
                  )
                }}
              />
              {words(rule)}
            </label>
          ))}
        </fieldset>
      ) : null}
      {info.introRates.length > 0 ? (
        <fieldset>
          <legend>First-year rate</legend>
          <ul class="muted small">
            {info.introRates.map((i) => (
              <li key={i.id}>{capitalize(i.text)}.</li>
            ))}
          </ul>
          <label class="field">
            Account opened (leave blank if it's been more than a year)
            <input
              type="date"
              value={opened}
              max={localToday()}
              onInput={(e) => setOpened(e.currentTarget.value)}
            />
          </label>
        </fieldset>
      ) : null}
      {offer || held.bonus ? (
        <fieldset>
          <legend>Welcome bonus</legend>
          {offer ? <p class="muted small">{offerText(card)}</p> : null}
          <label class="check">
            <input
              type="checkbox"
              checked={tracking}
              onChange={(e) => setTracking(e.currentTarget.checked)}
            />
            I'm working on this card's welcome bonus
          </label>
          {tracking ? (
            <>
              {info.introRates.length === 0 ? (
                <label class="field">
                  Account opened
                  <input
                    type="date"
                    value={opened}
                    max={localToday()}
                    onInput={(e) => setOpened(e.currentTarget.value)}
                  />
                </label>
              ) : null}
              <label class="field">
                Spent toward it so far
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="0"
                  value={spent}
                  onInput={(e) => setSpent(e.currentTarget.value)}
                />
              </label>
            </>
          ) : null}
        </fieldset>
      ) : null}
      {milestones.length > 0 ? (
        <fieldset>
          <legend>Spend bonus</legend>
          <ul class="muted small">
            {info.milestones.map((m) => (
              <li key={m.id}>{m.text}</li>
            ))}
          </ul>
          <label class="field">
            Spent on this card so far this year
            <input
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="Not tracked"
              value={yearSpent}
              onInput={(e) => setYearSpent(e.currentTarget.value)}
            />
          </label>
        </fieldset>
      ) : null}
      {info.needsAnniversary ? (
        <label class="field">
          Account anniversary (MM-DD), for its yearly cap
          <input
            type="text"
            inputMode="numeric"
            placeholder="03-15"
            value={anniversary}
            onInput={(e) => setAnniversary(e.currentTarget.value)}
          />
        </label>
      ) : null}
      <div class="row-buttons">
        <button type="button" class="primary" onClick={save}>
          Save
        </button>
        <button type="button" onClick={() => onRemove(held.id)}>
          Remove card
        </button>
      </div>
    </div>
  )
}

function CardList({
  wallet,
  onChange,
  onRemove,
}: {
  wallet: Wallet
  onChange: (change: WalletChange, cardId: string) => void
  onRemove: (cardId: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const today = localToday()
  const untracked = wallet.cards.some(
    (h) => h.bonus === undefined && cards.get(h.id)?.welcome_offer,
  )
  return (
    <>
      <ul class="held">
        {wallet.cards.map((held) => {
          const card = cards.get(held.id)
          const info = card ? cardInfo(catalog, card, wallet, today) : null
          const needsPick = info?.choices.some(
            (c) => c.default === null && !held.chosen?.picks[c.id],
          )
          const note = bonusLine(wallet, held) ?? milestoneLine(held)
          return (
            <li key={held.id}>
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
                    <span class="muted"> · {feeLabel(held.id)}</span>
                    {note ? <span class="row-note">{note}</span> : null}
                  </span>
                </span>
                <span class="muted">
                  {needsPick
                    ? 'Set picks'
                    : open === held.id
                      ? 'Close'
                      : 'Settings'}
                </span>
              </button>
              {open === held.id ? (
                <CardEditor
                  wallet={wallet}
                  held={held}
                  onChange={(change, id) => {
                    if (change.ok) setOpen(null)
                    onChange(change, id)
                  }}
                  onRemove={(id) => {
                    setOpen(null)
                    onRemove(id)
                  }}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
      {untracked ? (
        <p class="muted small">
          Opened one of these recently? Its Settings track the welcome bonus.
        </p>
      ) : null}
    </>
  )
}

function AddCard({
  wallet,
  onChange,
}: {
  wallet: Wallet | null
  onChange: (change: WalletChange, cardId: string) => void
}) {
  const [query, setQuery] = useState('')
  const found = useMemo(
    () =>
      query.trim().length < 2
        ? []
        : searchCards(catalog, query, wallet, localToday()).cards.slice(0, 6),
    [query, wallet],
  )
  return (
    <div>
      <label class="visually-hidden" for="card-search">
        Find a card
      </label>
      <SearchInput
        id="card-search"
        class="search"
        type="search"
        placeholder="Find a card, like Sapphire"
        autocomplete="off"
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onClear={() => setQuery('')}
      />
      <ul class="found">
        {found.map((c) => (
          <li key={c.id}>
            <span class="found-name">
              <CardArt id={c.id} width={32} />
              <span>
                {shortName(c.id)}
                <span class="muted"> · {issuerName(c.issuer)}</span>
              </span>
            </span>
            {c.held ? (
              <span class="muted">Added</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  track('wallet-card-added')
                  if (!load<boolean>('counted-first-card', false)) {
                    track('wallet-first-card')
                    save('counted-first-card', true)
                  }
                  onChange(
                    addToWallet(catalog, wallet, { id: c.id }, localToday()),
                    c.id,
                  )
                  setQuery('')
                }}
              >
                Add
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Memberships({
  wallet,
  onChange,
}: {
  wallet: Wallet
  onChange: (change: WalletChange) => void
}) {
  const used = new Set(
    wallet.cards.flatMap((h) => {
      const card = cards.get(h.id)
      return card ? membershipsUsed(card) : []
    }),
  )
  const relevant = knownMemberships(catalog).filter((m) => used.has(m))
  if (relevant.length === 0) return null
  return (
    <section class="panel">
      <h3>Memberships</h3>
      <p class="muted">Some of your cards earn more with these.</p>
      {relevant.map((m) => (
        <label class="check" key={m}>
          <input
            type="checkbox"
            checked={wallet.memberships.includes(m)}
            onChange={(e) =>
              onChange(
                withMemberships(
                  catalog,
                  wallet,
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
    </section>
  )
}

// What the wallet's points are worth to the person, per program: blank
// means earnrate's own value.
function PointValues({
  wallet,
  onChange,
}: {
  wallet: Wallet
  onChange: (change: WalletChange) => void
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
  return (
    <section class="panel">
      <h3>Point values</h3>
      <p class="muted">
        What your points are worth to you, from 0.1¢ to 5¢ each. earnrate starts
        at what they're worth as cash or travel credit; transferring to airlines
        and hotels can be worth more.
      </p>
      {ids.map((id) => {
        const own = wallet.valuations[id]
        const set = typeof own === 'number'
        const base =
          catalog.currencies.find((c) => c.id === id)?.value_cents ?? 1
        const value = set ? own : base
        const save = (cents: number | null) =>
          onChange(withValuations(catalog, wallet, { [id]: cents }))
        const step = (by: number) =>
          save(Math.min(5, Math.max(0.1, Math.round((value + by) * 10) / 10)))
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
                  const cents = Number(e.currentTarget.value)
                  if (cents > 0 && cents <= 5) save(cents)
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
              <button type="button" class="link" onClick={() => save(null)}>
                Reset
              </button>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

function WhatIf({ wallet }: { wallet: Wallet }) {
  const result = useMemo(() => {
    const rows = loadList<Row>('spending', TYPICAL_MONTHLY_SPEND)
    const lines = resolveSpendLines(
      catalog,
      rows.map((r) => lineFor(r.what, r.monthly)),
    ).filter((l) => l.merchant.source !== 'none')
    if (lines.length === 0) return null
    return simulateAdditions(catalog, wallet, lines, {
      filters: ALL_PERSONAL_CARDS,
      memberships: wallet.memberships,
      valuations: wallet.valuations,
      start: localToday(),
    })
    // The spending rows come from storage and change only on the other tab.
  }, [wallet])
  if (!result) return null
  const gains = result.additions.filter((a) => a.gain > 0).slice(0, 3)
  return (
    <section class="panel">
      <h3>Would another card help?</h3>
      <p class="muted">
        On your spending from the My spending tab, your cards earn about{' '}
        {wholeDollars(result.current.rewards)} a year.
      </p>
      {gains.length === 0 ? (
        <p>No card would add more than its annual fee costs.</p>
      ) : (
        <ol class="result-list">
          {gains.map((a, i) => (
            <li class="result" key={a.cardId}>
              <div class="result-top">
                <span class="rank">{i + 1}</span>
                <CardArt id={a.cardId} />
                <div class="result-name">
                  <strong>{shortName(a.cardId)}</strong>
                  <span class="muted">
                    +{wholeDollars(a.extraRewards)} back · {feeLabel(a.cardId)}
                  </span>
                </div>
                <span class="rate">
                  +{wholeDollars(a.gain)}
                  <small>/yr</small>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// What the cards need this period, with a calendar file of the dates. The
// file is built here and saved by the browser; nothing is sent anywhere.
function ThisQuarter({ wallet }: { wallet: Wallet }) {
  const items = useMemo(
    () => checklist(catalog, wallet, localToday(), undefined, shortName),
    [wallet],
  )
  if (items.length === 0) return null
  const dated = items.some(
    (i) => i.due !== null && i.kind !== 'cap' && i.kind !== 'rotation',
  )
  return (
    <section class="panel">
      <h3>To do now</h3>
      <ul class="todo">
        {items.map((i) => (
          <li key={`${i.kind}-${i.cardId}`}>{i.text}</li>
        ))}
      </ul>
      {dated ? (
        <div class="row-buttons">
          <button
            type="button"
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
    </section>
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

async function importWallet(file: File): Promise<Wallet | string> {
  const { parseWalletYaml } = await import('../../src/format/wallet-yaml.ts')
  return parseWalletYaml(await file.text(), catalog)
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

function Transfer({
  wallet,
  onReplace,
}: {
  wallet: Wallet | null
  onReplace: (wallet: Wallet | null) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  return (
    <section class="panel">
      <h3>Move your wallet</h3>
      <p class="muted">
        Your wallet is saved only in this browser. Export it to keep a copy, or
        to use it with the command line or earnrate in Claude; import one to
        bring it here.
      </p>
      <div class="row-buttons">
        {wallet ? (
          <button type="button" onClick={() => void exportWallet(wallet)}>
            Export wallet.yaml
          </button>
        ) : null}
        <label class="file-button">
          Import a wallet file
          <input
            type="file"
            accept=".yaml,.yml,text/yaml"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              if (!file) return
              void importWallet(file).then((result) => {
                if (typeof result === 'string') setError(result)
                else {
                  track('wallet-import')
                  setError(null)
                  onReplace(result)
                }
              })
              e.currentTarget.value = ''
            }}
          />
        </label>
        {wallet ? (
          confirming ? (
            <button
              type="button"
              class="danger"
              onClick={() => {
                setConfirming(false)
                onReplace(null)
              }}
            >
              Yes, delete it from this browser
            </button>
          ) : (
            <button type="button" onClick={() => setConfirming(true)}>
              Delete wallet
            </button>
          )
        ) : null}
      </div>
      {error ? <p class="callout">{error}</p> : null}
      <p class="muted small">
        Statement import stays in the command line version: never upload a card
        statement to a website, this one included.
      </p>
    </section>
  )
}

export function MyWallet({
  initialQuery,
  wallet,
  onReplace: replace,
}: {
  initialQuery: string
  wallet: Wallet | null
  onReplace: (wallet: Wallet | null) => void
}) {
  const [message, setMessage] = useState<{
    text: string
    error: boolean
  } | null>(null)
  const [query, setQuery] = useState(initialQuery)
  const [amount, setAmount] = useState('')
  const [abroad, setAbroad] = useState(false)
  const [asked, setAsked] = useState<{
    text: string
    amount: number | null
  } | null>(
    initialQuery.trim() === ''
      ? null
      : { text: initialQuery.trim(), amount: null },
  )

  const apply = (change: WalletChange, cardId?: string) => {
    if (!change.ok) {
      setMessage({ text: change.error, error: true })
      return
    }
    replace(change.wallet)
    setMessage(
      change.notes.length > 0
        ? {
            text: change.notes
              .map((n) => noteText(n, shortName(cardId ?? '')))
              .join(' '),
            error: false,
          }
        : null,
    )
  }

  const problems = wallet ? walletProblems(wallet, catalog) : []
  const rec = useMemo(
    () =>
      wallet && wallet.cards.length > 0 && asked && problems.length === 0
        ? ask(wallet, asked.text, asked.amount, abroad)
        : null,
    [wallet, asked, abroad, problems.length],
  )

  if (wallet && problems.length > 0) {
    return (
      <div>
        <p class="callout">
          The wallet saved in this browser has problems: {problems.join(' ')}
        </p>
        <Transfer wallet={wallet} onReplace={replace} />
      </div>
    )
  }

  // Memberships and point values can be saved before any card.
  if (!wallet || wallet.cards.length === 0) {
    return (
      <div class="panels">
        <section class="panel first">
          <p>
            Add the cards you have, and earnrate tells you which one to use
            anywhere. Your wallet is saved only in this browser: no account, and
            never a card number.
          </p>
          <AddCard wallet={wallet} onChange={apply} />
          {message ? (
            <p class={message.error ? 'callout' : 'muted'}>{message.text}</p>
          ) : null}
          <InstallHint />
        </section>
        <Transfer wallet={wallet} onReplace={replace} />
      </div>
    )
  }

  const remove = (cardId: string) => {
    apply(removeFromWallet(wallet, cardId), cardId)
    if (wallet.cards.length === 1) setAsked(null)
  }

  return (
    <div class="panels">
      <section class="panel first">
        <h3>Your cards</h3>
        <CardList wallet={wallet} onChange={apply} onRemove={remove} />
        <AddCard wallet={wallet} onChange={apply} />
        {message ? (
          <p class={message.error ? 'callout' : 'muted'}>{message.text}</p>
        ) : null}
        <p class="pass-hint">
          At the register: your{' '}
          <button
            type="button"
            class="link"
            onClick={() => {
              track('cta-pass-hint')
              document
                .getElementById('cheat-sheet')
                ?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            cheat sheet
          </button>{' '}
          shows which card to use for everything, and goes in Apple Wallet.
        </p>
        <InstallHint />
      </section>

      <section class="panel" aria-labelledby="wallet-ask-title">
        <h3 id="wallet-ask-title">Where do you want to make a purchase?</h3>
        <form
          class="ask"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            if (query.trim() !== '') {
              track('wallet-which-card')
              setAsked({ text: query.trim(), amount: Number(amount) || null })
            }
          }}
        >
          <label class="visually-hidden" for="wallet-ask">
            Store or category
          </label>
          <SearchInput
            id="wallet-ask"
            type="search"
            list="suggestions"
            placeholder="Which store?"
            autocomplete="off"
            enterkeyhint="search"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onClear={() => setQuery('')}
          />
          <input
            class="amount"
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="$"
            aria-label="Amount (optional)"
            value={amount}
            onInput={(e) => setAmount(e.currentTarget.value)}
          />
          <button type="submit">Ask</button>
        </form>
        <div class="chips">
          {QUICK.map((q) => (
            <button
              type="button"
              class={asked?.text === q ? 'chip on' : 'chip'}
              key={q}
              onClick={() => {
                track('wallet-which-card')
                setQuery(q)
                setAsked({ text: q, amount: Number(amount) || null })
              }}
            >
              {q}
            </button>
          ))}
        </div>
        <AbroadToggle abroad={abroad} onChange={setAbroad} />
        <div aria-live="polite">
          {rec ? (
            <div
              class="results"
              key={`${asked?.text ?? ''} ${String(asked?.amount ?? '')} ${String(abroad)}`}
            >
              <h4>
                {rec.merchant.source === 'category'
                  ? `For ${categoryPhrase(catalog, rec.merchant.category)}`
                  : `At ${rec.merchant.resolvedName}`}
                {abroad ? <span class="muted">{ABROAD_NOTE}</span> : null}
              </h4>
              <Answer wallet={wallet} rec={rec} />
            </div>
          ) : null}
        </div>
      </section>

      <ThisQuarter wallet={wallet} />
      <CheatSheet wallet={wallet} />
      <Memberships wallet={wallet} onChange={apply} />
      <PointValues wallet={wallet} onChange={apply} />
      <WhatIf wallet={wallet} />
      <Transfer wallet={wallet} onReplace={replace} />
    </div>
  )
}
