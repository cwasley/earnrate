import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Fragment } from 'preact'
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
  typicalSpendLines,
  simulateAdditions,
  TYPICAL_MONTHLY_SPEND,
  type Addition,
} from '../../src/engine/simulate.ts'
import {
  categoryPhrase,
  creditsCountedText,
  CREDITS_ONLY_IF,
  currencyLabel,
  currencyName,
  choiceName,
  feeText,
  ifCreditsUsedText,
  listed,
  minimumSpendText,
} from '../../src/engine/text.ts'
import { cardValuation } from '../../src/engine/valuation.ts'
import type { Recommendation } from '../../src/engine/types.ts'
import type { CardInput } from '../../src/engine/wallet-change.ts'
import { resolvePlace } from '../../src/merchants/resolve.ts'
import type { Wallet, WalletCard } from '../../src/schema/wallet.ts'
import { anniversaryOf, type Spending } from '../../src/engine/renewal.ts'
import { CardArt } from './CardArt.tsx'
import { Logo } from './Logo.tsx'
import { track } from './track.ts'
import { cheatSheetImage } from './sheet-image.ts'
import { lineFor, type Row } from './Spending.tsx'
import {
  cards,
  feeLabel,
  issuerName,
  issuers,
  membershipName,
  pct,
  shortName,
  wholeDollars,
  words,
} from './format.ts'
import { ABROAD_NOTE, AbroadToggle } from './AbroadToggle.tsx'
import { PayingWith, payingNote } from './PayingWith.tsx'
import type { Card, PaymentMethod } from '../../src/schema/card.ts'
import { optionName, ruleWhat } from '../../src/engine/rule-text.ts'
import { SearchInput } from './SearchInput.tsx'
import { load, loadList, save } from './settings.ts'
import {
  addOp,
  importOp,
  membershipsOp,
  pointValueOp,
  removeOp,
  skippedIssuersOp,
  updateOp,
  type LocalOp,
  type Outcome,
  type WalletOp,
} from './sync.ts'
import type { ComponentChildren } from 'preact'
import {
  checklist,
  checklistCalendar,
  type ChecklistItem,
} from '../../src/engine/checklist.ts'
import {
  compareOffers,
  OFFERS_MAY_DIFFER,
  offerTerms,
  type OfferPlan,
  type OfferSummary,
} from '../../src/engine/offers.ts'
import {
  capitalize,
  creditBack,
  creditTerms,
  creditShort,
  CREDIT_THIS_PERIOD,
  dollarsAndCents,
  money,
  shortDate,
} from '../../src/engine/text.ts'
import { creditStates } from '../../src/engine/credits.ts'

// The first everyday purchases, as quick picks for one question.
const QUICK = EVERYDAY_PURCHASES.slice(0, 6).map(quickPickText)

// Setup notes name what to set in CLI terms; this says where on the page.
// "Grocery stores and American Red Cross, Oct 1 to Dec 31": an activation
// in the engine's words, with its dates.
function activationLabel(card: Card, ruleId: string): string {
  const rule = card.rules.find((r) => r.id === ruleId)
  if (!rule) return words(ruleId)
  const what = capitalize(ruleWhat(catalog, rule, card))
  return rule.valid_from !== undefined && rule.valid_to !== undefined
    ? `${what}, ${shortDate(rule.valid_from).replace(/, \d{4}$/, '')} to ${shortDate(rule.valid_to)}`
    : what
}

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
  payment: PaymentMethod | null,
) {
  const purchase = {
    merchant: text,
    amount,
    channel: null,
    date: localToday(),
    country: abroad ? ABROAD : 'US',
    payment,
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
          {top?.credit?.dollars
            ? `, plus ${money(top.credit.dollars)} back from its ${top.credit.name} credit`
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
              {r.credit ? (
                <p class="upgrade">{creditShort(r.credit, r.credit.dollars)}</p>
              ) : null}
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

type CreditUse = 'using' | 'not-yet' | 'skipped'

// Enrolled is what the issuer calls it. A credit that needs no enrolling
// starts with neither choice: it offsets the fee only once marked used.
const ENROLL_CHOICES: { use: CreditUse; label: string }[] = [
  { use: 'using', label: 'Enrolled' },
  { use: 'not-yet', label: 'Not yet' },
  { use: 'skipped', label: "I don't use this" },
]
const AUTOMATIC_CHOICES: { use: CreditUse; label: string }[] = [
  { use: 'using', label: 'Using it' },
  { use: 'skipped', label: "I don't use this" },
]

function CardEditor({
  wallet,
  held,
  onChange,
  onRemove,
}: {
  wallet: Wallet
  held: WalletCard
  onChange: (input: CardInput) => void
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
  const credits = card ? creditStates(catalog, card, held, localToday()) : []
  const [creditUse, setCreditUse] = useState<Record<string, CreditUse>>(() =>
    Object.fromEntries(
      credits.map((c) => [
        c.credit.id,
        c.skipped
          ? 'skipped'
          : (c.credit.enroll ? c.enrolled : c.confirmed)
            ? 'using'
            : 'not-yet',
      ]),
    ),
  )
  const [creditUsed, setCreditUsed] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      credits
        .filter((c) => c.used > 0)
        .map((c) => [c.credit.id, String(c.used)]),
    ),
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
    const withUse = (use: CreditUse) =>
      credits
        .filter((c) => creditUse[c.credit.id] === use)
        .map((c) => c.credit.id)
    if (credits.length > 0) {
      input.enrolled = withUse('using')
      input.skippedCredits = withUse('skipped')
    }
    const used = Object.entries(creditUsed).filter(([, v]) => v !== '')
    if (used.length > 0)
      input.creditUsed = Object.fromEntries(
        used.map(([id, v]) => [id, Math.max(0, Number(v) || 0)]),
      )
    onChange(input)
  }

  return (
    <div class="editor">
      {info.choices.map((choice) => {
        const chosen = picks[choice.id] ?? []
        return (
          <fieldset key={choice.id}>
            <legend>
              {choiceName(choice.id)}{' '}
              {choice.pick === 1 ? 'category' : 'categories'}:{' '}
              {choice.automatic
                ? `the ${choice.pick === 1 ? 'one' : String(choice.pick)} you expect to spend the most in`
                : `pick ${String(choice.pick)}`}
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
                  {optionName(catalog, card, choice.id, option)}
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
              {activationLabel(card, rule)}
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
      {credits.map((c) => (
        <fieldset key={c.credit.id}>
          <legend>{c.name} credit</legend>
          <p class="muted small">
            {capitalize(creditBack(c))}
            {creditTerms(
              c.credit.min_amount === undefined
                ? {}
                : { min_amount: c.credit.min_amount },
            )}
            {c.until === null
              ? ''
              : `; this one runs through ${shortDate(c.until)}`}
            .
            {c.credit.valid_to === undefined
              ? ''
              : ` It ends after ${shortDate(c.credit.valid_to)}.`}
          </p>
          <div
            class="segments credit-use"
            role="radiogroup"
            aria-label={`${c.name} credit`}
          >
            {(c.credit.enroll ? ENROLL_CHOICES : AUTOMATIC_CHOICES).map(
              (choice) => {
                const on = creditUse[c.credit.id] === choice.use
                return (
                  <label key={choice.use} class={on ? 'on' : undefined}>
                    <input
                      type="radio"
                      name={`credit-${held.id}-${c.credit.id}`}
                      checked={on}
                      onChange={() =>
                        setCreditUse((prev) => ({
                          ...prev,
                          [c.credit.id]: choice.use,
                        }))
                      }
                    />
                    {choice.label}
                  </label>
                )
              },
            )}
          </div>
          {creditUse[c.credit.id] === 'skipped' ? (
            <p class="muted small">
              Left out of picks, the to-do list and the annual-fee math.
            </p>
          ) : creditUse[c.credit.id] !== 'using' ? null : (
            <label class="field">
              Used so far {CREDIT_THIS_PERIOD[c.period]}
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max={String(c.amount)}
                placeholder="0"
                value={creditUsed[c.credit.id] ?? ''}
                onInput={(e) => {
                  const value = e.currentTarget.value
                  setCreditUsed((prev) => ({ ...prev, [c.credit.id]: value }))
                }}
              />
            </label>
          )}
        </fieldset>
      ))}
      {info.needsAnniversary || hasFee(held) ? (
        <label class="field">
          Account anniversary (MM-DD), for its{' '}
          {info.needsAnniversary && hasFee(held)
            ? 'yearly cap and renewal check'
            : info.needsAnniversary
              ? 'yearly cap'
              : 'renewal check before the fee'}
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

// The My spending tab's rows, and whether they're still its typical amounts.
function spending(fallback = true): Spending {
  const rows = loadList<Row>('spending', TYPICAL_MONTHLY_SPEND)
  const typical =
    rows.length === TYPICAL_MONTHLY_SPEND.length &&
    TYPICAL_MONTHLY_SPEND.every(
      (t, i) => rows[i]?.what === t.what && rows[i].monthly === t.monthly,
    )
  const lines = resolveSpendLines(
    catalog,
    rows.map((r) => lineFor(r.what, r.monthly)),
  ).filter((l) => l.merchant.source !== 'none')
  // An emptied tab says nothing about spending; typical amounts do better.
  return lines.length === 0 && fallback
    ? { lines: typicalSpendLines(catalog), typical: true }
    : { lines, typical }
}

const hasFee = (held: WalletCard) => (cards.get(held.id)?.annual_fee ?? 0) > 0

// A fee card with no date to tell when it renews.
const renewalAsks = (held: WalletCard) =>
  hasFee(held) && anniversaryOf(held) === null

function CardList({
  wallet,
  open,
  setOpen,
  onChange,
  onRemove,
}: {
  wallet: Wallet
  // The card whose Settings are showing; the to-do list can open one.
  open: string | null
  setOpen: (cardId: string | null) => void
  onChange: (op: LocalOp, cardId: string) => Promise<boolean>
  onRemove: (cardId: string) => void
}) {
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
            <li key={held.id} id={`held-${held.id}`}>
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
                  {open === held.id
                    ? 'Close'
                    : needsPick
                      ? 'Set picks'
                      : 'Settings'}
                </span>
              </button>
              {open === held.id ? (
                <CardEditor
                  wallet={wallet}
                  held={held}
                  onChange={(input) => {
                    void onChange(updateOp(input), held.id).then((ok) => {
                      if (ok) setOpen(null)
                    })
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
      {wallet.cards.some((h) => renewalAsks(h) && !h.anniversary) ? (
        <p class="muted small">
          Add a fee card's anniversary in its Settings, and earnrate checks
          whether it still pays for itself before the fee comes due.
        </p>
      ) : null}
      {untracked ? (
        <p class="muted small">
          {wallet.cards.length === 1 ? 'Opened it' : 'Opened one of these'}{' '}
          recently? Its Settings track the welcome bonus.
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
  onChange: (op: LocalOp, cardId: string) => Promise<boolean>
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
                  void onChange(addOp(c.id), c.id)
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
  return (
    <section class="panel">
      <h3>Memberships</h3>
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
    </section>
  )
}

// What the wallet's points are worth to the person, per program: blank
// means earnrate's own value.
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
          void onChange(pointValueOp(id, cents))
        const step = (by: number) =>
          save(Math.min(5, Math.max(0.1, Math.round((value + by) * 10) / 10)))
        const name = currencyLabel(catalog, id)
        return (
          <fieldset class="lock point-value" key={id} disabled={locked}>
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
          </fieldset>
        )
      })}
    </section>
  )
}

function AdditionCredits({ addition }: { addition: Addition }) {
  const credits = addition.simulation.credits.find(
    (c) => c.cardId === addition.cardId && !c.held,
  )
  if (!credits) return null
  return (
    <p class="muted">
      {ifCreditsUsedText(credits, addition.gainIfCreditsUsed, 'adds')}{' '}
      {CREDITS_ONLY_IF}
    </p>
  )
}

// Issuers with a card "Would another card help?" can suggest.
const SKIPPABLE = issuers.filter((id) =>
  catalog.cards.some(
    (c) => c.issuer === id && !c.business && c.network !== 'store',
  ),
)

// Never assumed: nothing is left out until the person checks an issuer.
function SkipIssuers({
  wallet,
  locked,
  onChange,
}: {
  wallet: Wallet
  locked: boolean
  onChange: (op: LocalOp) => Promise<boolean>
}) {
  const skipped = wallet.skipped_issuers ?? []
  const set = (list: string[]) => {
    track('wallet-skip-issuers')
    void onChange(skippedIssuersOp(list))
  }
  return (
    <>
      {skipped.length > 0 ? (
        <p class="skip-saved">
          Leaving out cards from {listed(skipped.map(issuerName))}.{' '}
          <button
            type="button"
            class="link"
            disabled={locked}
            onClick={() => set([])}
          >
            Clear
          </button>
        </p>
      ) : null}
      <details class="filters whatif-more skip-issuers">
        <summary>Can't get cards from some issuers? Leave them out</summary>
        <fieldset class="lock" disabled={locked}>
          <legend class="visually-hidden">Issuers to leave out</legend>
          <div class="issuer-checks">
            {SKIPPABLE.map((id) => (
              <label class="check" key={id}>
                <input
                  type="checkbox"
                  checked={skipped.includes(id)}
                  onChange={(e) =>
                    set(
                      e.currentTarget.checked
                        ? [...skipped, id]
                        : skipped.filter((x) => x !== id),
                    )
                  }
                />
                {issuerName(id)}
              </label>
            ))}
          </div>
        </fieldset>
        <p class="muted small">
          Both views leave out every card from the issuers you check. Saved with
          your wallet.
        </p>
      </details>
    </>
  )
}

type WhatIfView = 'yearly' | 'two-years'

const VIEWS: { view: WhatIfView; label: string }[] = [
  { view: 'yearly', label: 'Every year' },
  { view: 'two-years', label: 'First two years' },
]

const NEW_PERSONAL_CARDS = {
  kind: 'any',
  business: false,
  noAnnualFee: false,
  includeHeld: false,
} as const

function OfferRow({
  offer: o,
  plan,
  rank,
  typical,
  open,
  setOpen,
  locked,
  onAdd,
}: {
  offer: OfferSummary
  plan: OfferPlan
  rank: number
  typical: boolean
  open: boolean
  setOpen: (cardId: string | null) => void
  locked: boolean
  onAdd: (cardId: string) => void
}) {
  return (
    <li class="result" id={`whatif-${o.cardId}`}>
      <button
        type="button"
        class="result-top result-toggle"
        aria-expanded={open}
        onClick={() => setOpen(open ? null : o.cardId)}
      >
        <span class="rank">{rank}</span>
        <CardArt id={o.cardId} />
        <span class="result-name">
          <strong>{shortName(o.cardId)}</strong>
          <span class="muted">
            <span class="year-split">
              {wholeDollars(plan.yearOne)} year one ·
            </span>{' '}
            <span class="year-split">
              {wholeDollars(plan.yearTwo)} year two
            </span>
          </span>
        </span>
        <span class="rate">
          {plan.twoYears > 0 ? '+' : ''}
          {wholeDollars(plan.twoYears)}
          <small>/2 yrs</small>
        </span>
      </button>
      {plan.minimumSpend ? (
        <p class={plan.minimumSpend.reachable ? undefined : 'warn'}>
          {minimumSpendText(o.spend, o.months, plan.minimumSpend, typical)}
        </p>
      ) : null}
      {o.ineligible ? <p class="warn">{o.ineligible}</p> : null}
      <p class="muted">
        {offerTerms(o, currencyName(catalog, o.currency))}.
        {o.validTo ? ` Offer ends ${shortDate(o.validTo)}.` : ''} Public offer
        as of {shortDate(o.lastVerified)}.
      </p>
      {open ? (
        <p class="muted">
          {capitalize(feeText(o))}.
          {o.membershipFee > 0
            ? ` Needs a ${money(o.membershipFee)} membership, counted each year.`
            : ''}
          {o.note ? ` ${o.note}` : ''}
          {o.credits > 0
            ? ` Its credits are ${wholeDollars(o.credits)} a year more if you'd use them all. ${CREDITS_ONLY_IF}`
            : ''}
        </p>
      ) : null}
      {open ? (
        <div class="row-buttons">
          <a class="row-link" href={`/cards/${o.cardId}`}>
            See card details
          </a>
          <button
            type="button"
            class="primary"
            disabled={locked}
            onClick={() => {
              setOpen(null)
              onAdd(o.cardId)
            }}
          >
            Add to my wallet
          </button>
        </div>
      ) : null}
    </li>
  )
}

function WhatIf({
  wallet,
  locked,
  onAdd,
  onChange,
  focus,
}: {
  wallet: Wallet
  locked: boolean
  onAdd: (cardId: string) => void
  onChange: (op: LocalOp) => Promise<boolean>
  // A card or comparison page's "See what it adds to your cards": shown,
  // and the first one open, even when they aren't in the top 3.
  focus: string[]
}) {
  const [open, setOpen] = useState<string | null>(focus[0] ?? null)
  const [view, setView] = useState<WhatIfView>('yearly')
  useEffect(() => {
    const [first] = focus
    if (first === undefined) return
    setOpen(first)
    requestAnimationFrame(() => {
      document
        .getElementById(`whatif-${first}`)
        ?.scrollIntoView({ block: 'center' })
    })
  }, [focus])
  // The spending rows come from storage and change only on the other tab.
  const spent = useMemo(() => spending(false), [wallet])
  const result = useMemo(
    () =>
      spent.lines.length === 0
        ? null
        : simulateAdditions(catalog, wallet, spent.lines, {
            filters: ALL_PERSONAL_CARDS,
            memberships: wallet.memberships,
            valuations: wallet.valuations,
            start: localToday(),
          }),
    [wallet, spent],
  )
  const offers = useMemo(
    () =>
      view === 'two-years' && spent.lines.length > 0
        ? compareOffers(
            catalog,
            wallet,
            NEW_PERSONAL_CARDS,
            localToday(),
            spent,
          )
        : null,
    [wallet, spent, view],
  )
  if (!result) return null
  const gains = result.additions.filter((a) => a.gain > 0).slice(0, 3)
  const focused = focus
    .filter((id) => !gains.some((a) => a.cardId === id))
    .flatMap((id) => result.additions.filter((a) => a.cardId === id))
  const row = (a: (typeof result.additions)[number], rank: number) => (
    <li class="result" key={a.cardId} id={`whatif-${a.cardId}`}>
      <button
        type="button"
        class="result-top result-toggle"
        aria-expanded={open === a.cardId}
        onClick={() => setOpen(open === a.cardId ? null : a.cardId)}
      >
        <span class="rank">{rank}</span>
        <CardArt id={a.cardId} />
        <span class="result-name">
          <strong>{shortName(a.cardId)}</strong>
          <span class="muted">
            +{wholeDollars(a.extraRewards)} back · {feeLabel(a.cardId)}
          </span>
        </span>
        <span class="rate">
          {a.gain > 0 ? '+' : ''}
          {wholeDollars(a.gain)}
          <small>/yr</small>
        </span>
      </button>
      {open === a.cardId ? <AdditionCredits addition={a} /> : null}
      {open === a.cardId ? (
        <div class="row-buttons">
          <a class="row-link" href={`/cards/${a.cardId}`}>
            See card details
          </a>
          <button
            type="button"
            class="primary"
            disabled={locked}
            onClick={() => {
              setOpen(null)
              onAdd(a.cardId)
            }}
          >
            Add to my wallet
          </button>
        </div>
      ) : null}
    </li>
  )

  const planned = (offers?.offers ?? []).flatMap((o) =>
    o.plan ? [{ offer: o, plan: o.plan }] : [],
  )
  const topOffers = planned.filter((p) => p.plan.twoYears > 0).slice(0, 3)
  const focusedOffers = focus
    .filter((id) => !topOffers.some((p) => p.offer.cardId === id))
    .flatMap((id) => planned.filter((p) => p.offer.cardId === id))
  const offerRow = (p: (typeof planned)[number], rank: number) => (
    <OfferRow
      key={p.offer.cardId}
      offer={p.offer}
      plan={p.plan}
      rank={rank}
      typical={spent.typical}
      open={open === p.offer.cardId}
      setOpen={setOpen}
      locked={locked}
      onAdd={onAdd}
    />
  )

  return (
    <section class="panel" id="whatif">
      <h3>Would another card help?</h3>
      <p class="muted">
        {spent.typical
          ? `On typical U.S. spending, your cards earn about ${wholeDollars(result.current.rewards)} a year. Put in your own on the My spending tab.`
          : `On your spending from the My spending tab, your cards earn about ${wholeDollars(result.current.rewards)} a year.`}
      </p>
      {result.current.credits
        .filter((c) => c.held)
        .map((c) => (
          <p class="muted" key={c.cardId}>
            {creditsCountedText(
              shortName(c.cardId),
              cards.get(c.cardId)?.annual_fee ?? 0,
              c,
            )}
          </p>
        ))}
      <div
        class="segments whatif-view"
        role="radiogroup"
        aria-label="What to count"
      >
        {VIEWS.map((v) => (
          <label key={v.view} class={view === v.view ? 'on' : undefined}>
            <input
              type="radio"
              name="whatif-view"
              checked={view === v.view}
              onChange={() => {
                if (v.view === 'two-years') track('wallet-two-years')
                setView(v.view)
              }}
            />
            {v.label}
          </label>
        ))}
      </div>
      {view === 'yearly' ? (
        <>
          {gains.length === 0 ? (
            <p>No card would add more than its annual fee costs.</p>
          ) : (
            <ol class="result-list" key="yearly">
              {gains.map((a, i) => row(a, i + 1))}
            </ol>
          )}
          {focused.map((f) => (
            <Fragment key={f.cardId}>
              <p class="muted">
                {shortName(f.cardId)}{' '}
                {f.gain > 0
                  ? 'would add this much, after its annual fee:'
                  : 'would add less than its annual fee costs:'}
              </p>
              <ol class="result-list">
                {row(
                  f,
                  result.additions.findIndex((a) => a.cardId === f.cardId) + 1,
                )}
              </ol>
            </Fragment>
          ))}
        </>
      ) : (
        <>
          <p class="muted">
            With each card's welcome bonus, if the minimum spend fits, less its
            fees.
          </p>
          {topOffers.length === 0 ? (
            <p>No card's first two years would add more than its fees cost.</p>
          ) : (
            <ol class="result-list" key="two-years">
              {topOffers.map((p, i) => offerRow(p, i + 1))}
            </ol>
          )}
          {focusedOffers.map((p) => (
            <Fragment key={p.offer.cardId}>
              <p class="muted">
                {shortName(p.offer.cardId)}
                {p.plan.twoYears > 0
                  ? ' over its first two years:'
                  : "'s first two years would add less than its fees cost:"}
              </p>
              <ol class="result-list">
                {offerRow(
                  p,
                  planned.findIndex((x) => x.offer.cardId === p.offer.cardId) +
                    1,
                )}
              </ol>
            </Fragment>
          ))}
          <p class="muted small">{OFFERS_MAY_DIFFER}</p>
          {offers ? (
            <details class="filters whatif-more">
              <summary>How this is ranked</summary>
              {offers.notes.map((n) => (
                <p class="muted small" key={n}>
                  {n}
                </p>
              ))}
            </details>
          ) : null}
        </>
      )}
      <SkipIssuers wallet={wallet} locked={locked} onChange={onChange} />
    </section>
  )
}

// The part of a to-do item that opens the card's Settings, where it's done:
// "mark them enrolled", "Pick Cash+'s 5% and 2% categories", "Activate Freedom
// Flex's bonus". Tied to the checklist's wording in src/engine/checklist.ts
// and text.ts; an item whose wording doesn't match stays plain text.
const SETTINGS_LINKS: Partial<Record<ChecklistItem['kind'], RegExp>> = {
  enroll: /mark (?:it|them) enrolled|Mark (?:it|them) used/,
  pick: /^Pick .+? categor(?:y|ies)/,
  activate: /^Activate .+?'s? bonus/,
}

function SettingsLinkText({
  item,
  onOpen,
}: {
  item: ChecklistItem
  onOpen: () => void
}) {
  const pattern = SETTINGS_LINKS[item.kind]
  const match = pattern?.exec(item.text)
  if (!match) return <>{item.text}</>
  return (
    <>
      {item.text.slice(0, match.index)}
      {/* A link, not a button: a button can't wrap mid-sentence on a phone. */}
      <a
        href="#wallet"
        class="link"
        onClick={(e) => {
          e.preventDefault()
          onOpen()
        }}
      >
        {match[0]}
      </a>
      {item.text.slice(match.index + match[0].length)}
    </>
  )
}

// What the cards need this period, with a calendar file of the dates. The
// file is built here and saved by the browser; nothing is sent anywhere.
function ThisQuarter({
  wallet,
  onOpenCard,
}: {
  wallet: Wallet
  onOpenCard: (cardId: string) => void
}) {
  const items = useMemo(
    () =>
      checklist(
        catalog,
        wallet,
        localToday(),
        undefined,
        shortName,
        spending(),
      ),
    // The spending rows come from storage and change only on the other tab.
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
          <li key={`${i.kind}-${i.cardId}`}>
            <SettingsLinkText
              item={i}
              onOpen={() => {
                onOpenCard(i.cardId)
              }}
            />
          </li>
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
  synced,
  locked,
  onImport,
  onDelete,
}: {
  wallet: Wallet | null
  synced: boolean
  locked: boolean
  onImport: (op: WalletOp) => Promise<Outcome>
  onDelete: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  // Synced, an import replaces the Claude wallet too, so it asks first.
  const [pending, setPending] = useState<string | null>(null)
  const runImport = (yaml: string) => {
    void onImport(importOp(yaml)).then((result) => {
      if (!result.ok) setError(result.error)
      else {
        track('wallet-import')
        setError(null)
      }
    })
  }
  return (
    <section class="panel">
      <h3>Move your wallet</h3>
      <p class="muted">
        {synced
          ? 'Your wallet is synced with earnrate in Claude. Export it to keep a copy or use it with the command line; importing a file replaces the synced wallet.'
          : wallet
            ? 'Your wallet is saved only in this browser. Export it to keep a copy, or to use it with the command line or earnrate for Claude Desktop; import one to bring it here.'
            : 'Have a wallet file from the command line or earnrate for Claude Desktop? Import it here.'}
      </p>
      <fieldset class="lock" disabled={locked}>
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
                void file.text().then((yaml) => {
                  if (synced) setPending(yaml)
                  else runImport(yaml)
                })
                e.currentTarget.value = ''
              }}
            />
          </label>
          {wallet && !synced ? (
            confirming ? (
              <>
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
              </>
            ) : (
              <button type="button" onClick={() => setConfirming(true)}>
                Delete wallet
              </button>
            )
          ) : null}
        </div>
        {pending !== null ? (
          <div class="row-buttons">
            <button
              type="button"
              class="danger"
              onClick={() => {
                runImport(pending)
                setPending(null)
              }}
            >
              Replace my synced wallet with this file
            </button>
            <button type="button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        ) : null}
      </fieldset>
      {error ? <p class="callout">{error}</p> : null}
      {synced ? (
        <p class="muted small">
          To delete the synced wallet, ask earnrate in Claude to delete it. Stop
          syncing keeps a copy in this browser.
        </p>
      ) : null}
      <p class="muted small">
        Statement import stays in the command line version: never upload a card
        statement to a website, this one included.
      </p>
    </section>
  )
}

export function MyWallet({
  initialQuery,
  focusAsk,
  wallet,
  perform,
  onDelete,
  synced,
  locked,
  lockNote,
  syncTop,
  connect,
}: {
  initialQuery: string
  focusAsk: boolean
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
  const [query, setQuery] = useState(initialQuery)
  const [amount, setAmount] = useState('')
  const [abroad, setAbroad] = useState(false)
  const [payment, setPayment] = useState<PaymentMethod | null>(null)
  const [openCard, setOpenCard] = useState<string | null>(null)
  const [asked, setAsked] = useState<{
    text: string
    amount: number | null
  } | null>(
    initialQuery.trim() === ''
      ? null
      : { text: initialQuery.trim(), amount: null },
  )
  // A store sent here from its page ("Check with your own cards") lands on
  // the answer, not the top of the wallet.
  const askSection = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focusAsk) return
    track('page-check')
    askSection.current?.scrollIntoView({ block: 'start' })
  }, [])

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

  // Opens a card's Settings in Your cards and scrolls to it: from the to-do
  // list, from a card page's "Add it to your wallet", and from "Would another
  // card help?".
  const openCardSettings = (cardId: string) => {
    setOpenCard(cardId)
    requestAnimationFrame(() => {
      document
        .getElementById(`held-${cardId}`)
        ?.scrollIntoView({ block: 'start' })
    })
  }

  // Adds a card the person chose elsewhere, opens its Settings (picks, an
  // opening date, a welcome bonus) and offers Undo. Already held: says so.
  const addAndOpen = async (cardId: string) => {
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

  // A card page's "Add it to your wallet" arrives as #wallet&add=<card id>,
  // on load or as a change to the address. The id is read once and cleared.
  // `whatif=<card>` opens "Would another card help?" at that card, and
  // `card=<card>` opens a held card's Settings, both from a card page.
  const [whatIf, setWhatIf] = useState<string[]>([])
  const addFromAddress = () => {
    const params = new URLSearchParams(location.hash.slice(1))
    const param = (['add', 'whatif', 'card'] as const).find((k) =>
      params.has(k),
    )
    if (param === undefined) return
    const ids = params
      .getAll(param)
      .filter((id) => catalog.cards.some((c) => c.id === id))
    for (const k of ['add', 'whatif', 'card']) params.delete(k)
    const rest = params.toString().replace(/=(?=&|$)/g, '')
    history.replaceState(null, '', `#${rest || 'wallet'}`)
    const [cardId] = ids
    if (cardId === undefined) return
    if (param === 'add') {
      track('page-add')
      void addAndOpen(cardId)
    } else if (param === 'whatif') {
      track('page-whatif')
      setWhatIf(ids)
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

  const problems = wallet ? walletProblems(wallet, catalog) : []
  const rec = useMemo(
    () =>
      wallet && wallet.cards.length > 0 && asked && problems.length === 0
        ? ask(wallet, asked.text, asked.amount, abroad, payment)
        : null,
    [wallet, asked, abroad, payment, problems.length],
  )

  const transfer = (
    <Transfer
      wallet={wallet}
      synced={synced}
      locked={locked}
      onImport={perform}
      onDelete={onDelete}
    />
  )
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
        {transfer}
      </div>
    )
  }

  // Memberships and point values can be saved before any card.
  if (!wallet || wallet.cards.length === 0) {
    return (
      <div class="panels">
        {syncTop}
        <section class="panel first">
          <p>
            {synced
              ? "Add the cards you have, and earnrate tells you which one to use anywhere. They're saved in your Claude wallet too: never a card number."
              : 'Add the cards you have, and earnrate tells you which one to use anywhere. Your wallet is saved only in this browser: no account, and never a card number.'}
          </p>
          {asked ? (
            <p>
              Add yours, and earnrate says which one to use at {asked.text}.
            </p>
          ) : null}
          <fieldset class="lock" disabled={locked}>
            <AddCard wallet={wallet} onChange={apply} />
          </fieldset>
          {messageLine}
          <InstallHint />
        </section>
        {connect}
        {transfer}
      </div>
    )
  }

  const remove = (cardId: string) => {
    void apply(removeOp(cardId), cardId).then((ok) => {
      if (ok && wallet.cards.length === 1) setAsked(null)
    })
  }

  return (
    <div class="panels">
      {syncTop}
      <section class="panel first">
        <h3>Your cards</h3>
        <fieldset class="lock" disabled={locked}>
          <CardList
            wallet={wallet}
            open={openCard}
            setOpen={setOpenCard}
            onChange={apply}
            onRemove={remove}
          />
          <AddCard wallet={wallet} onChange={apply} />
        </fieldset>
        {messageLine}
        <p class="pass-hint">
          At the register: your{' '}
          <button
            type="button"
            class="link"
            onClick={() => {
              track('cta-pass-hint')
              document.getElementById('cheat-sheet')?.scrollIntoView()
            }}
          >
            cheat sheet
          </button>{' '}
          shows which card to use for everything, and goes in Apple Wallet.
        </p>
        <InstallHint />
      </section>

      <section
        class="panel"
        aria-labelledby="wallet-ask-title"
        ref={askSection}
      >
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
        <div class="options">
          <AbroadToggle abroad={abroad} onChange={setAbroad} />
          <PayingWith
            name="wallet-paying"
            payment={payment}
            onChange={setPayment}
          />
        </div>
        <div aria-live="polite">
          {rec ? (
            <div
              class="results"
              // A new question arrives; an amount, country or way of paying
              // updates it in place.
              key={asked?.text ?? ''}
            >
              <h4>
                {rec.merchant.source === 'category'
                  ? `For ${categoryPhrase(catalog, rec.merchant.category)}`
                  : `At ${rec.merchant.resolvedName}`}
                {abroad ? <span class="muted">{ABROAD_NOTE}</span> : null}
                {payment ? (
                  <span class="muted">{payingNote(payment)}</span>
                ) : null}
              </h4>
              <Answer wallet={wallet} rec={rec} />
            </div>
          ) : null}
        </div>
      </section>

      <ThisQuarter wallet={wallet} onOpenCard={openCardSettings} />
      <CheatSheet wallet={wallet} />
      <Memberships wallet={wallet} onChange={apply} locked={locked} />
      <PointValues wallet={wallet} onChange={apply} locked={locked} />
      <WhatIf
        wallet={wallet}
        locked={locked}
        onAdd={(cardId) => void addAndOpen(cardId)}
        onChange={apply}
        focus={whatIf}
      />
      {connect}
      {transfer}
    </div>
  )
}
