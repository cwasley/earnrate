import { useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import {
  creditChoices,
  creditStates,
  nightStates,
} from '../../src/engine/credits.ts'
import { activationGroup } from '../../src/engine/evaluate.ts'
import { milestoneSummaries } from '../../src/engine/milestones.ts'
import { inEffect, localToday } from '../../src/engine/periods.ts'
import { anniversaryOf, type Spending } from '../../src/engine/renewal.ts'
import { optionName, pickName, ruleWhat } from '../../src/engine/rule-text.ts'
import { cardInfo } from '../../src/engine/setup.ts'
import {
  capitalize,
  choiceName,
  creditBack,
  creditTerms,
  CREDIT_THIS_PERIOD,
  currencyLabel,
  currencyName,
  FREE_NIGHT_NAME,
  freeNightText,
  freeNightValueText,
  LISTED_CREDIT_USED,
  listed,
  shortDate,
} from '../../src/engine/text.ts'
import { currencyValuation } from '../../src/engine/valuation.ts'
import {
  MAX_NIGHT_VALUE,
  type CardInput,
} from '../../src/engine/wallet-change.ts'
import type { Card } from '../../src/schema/card.ts'
import type { Wallet, WalletCard } from '../../src/schema/wallet.ts'
import { answeredMarks, heldMarks } from '../rate/answers.ts'
import { CreditPicks } from './CreditPicks.tsx'
import { cards, issuerName, words } from './format.ts'
import { KeepOrReplace } from './KeepOrReplace.tsx'
import { offerTerms } from '../../src/engine/offers.ts'

// "Grocery stores and American Red Cross, Oct 1 to Dec 31": an activation
// in the engine's words, with its dates. One activation can turn on several
// rules (a Freedom Flex quarter), so the label names every rule in its group.
function activationLabel(card: Card, ruleId: string): string {
  const rule = card.rules.find((r) => r.id === ruleId)
  if (!rule) return words(ruleId)
  const what = capitalize(
    listed(
      activationGroup(card, ruleId).flatMap((id) => {
        const r = card.rules.find((x) => x.id === id)
        return r ? [ruleWhat(catalog, r, card)] : []
      }),
    ),
  )
  return rule.valid_from !== undefined && rule.valid_to !== undefined
    ? `${what}, ${shortDate(rule.valid_from).replace(/, \d{4}$/, '')} to ${shortDate(rule.valid_to)}`
    : what
}

function offerText(card: Card): string {
  const o = card.welcome_offer
  if (!o || !inEffect(o, localToday())) return ''
  return `Published offer: ${offerTerms(o, currencyName(catalog, card.currency))}.`
}

export const hasFee = (held: WalletCard) =>
  (cards.get(held.id)?.annual_fee ?? 0) > 0

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
// Days in each month; February keeps the 29th, which falls on the 28th in
// other years.
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const two = (n: number) => String(n).padStart(2, '0')

// The account anniversary as a month and a day, saved once both are set.
function Anniversary({
  label,
  value,
  onSave,
}: {
  label: string
  value: string | null // MM-DD
  onSave: (mmdd: string) => void
}) {
  const [month, setMonth] = useState(() => Number(value?.slice(0, 2) ?? 0))
  const [day, setDay] = useState(() => Number(value?.slice(3, 5) ?? 0))
  const set = (m: number, d: number) => {
    const fits = m > 0 ? Math.min(d, DAYS[m - 1] ?? 31) : d
    setMonth(m)
    setDay(fits)
    if (m > 0 && fits > 0) onSave(`${two(m)}-${two(fits)}`)
  }
  return (
    <fieldset class="anniversary">
      <legend>{label}</legend>
      <div class="anniversary-row">
        <select
          aria-label="Month"
          value={String(month)}
          onChange={(e) => set(Number(e.currentTarget.value), day)}
        >
          <option value="0">Month</option>
          {MONTHS.map((name, i) => (
            <option value={String(i + 1)} key={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Day"
          value={String(day)}
          onChange={(e) => set(month, Number(e.currentTarget.value))}
        >
          <option value="0">Day</option>
          {Array.from({ length: month > 0 ? (DAYS[month - 1] ?? 31) : 31 }).map(
            (_, i) => (
              <option value={String(i + 1)} key={i}>
                {i + 1}
              </option>
            ),
          )}
        </select>
      </div>
    </fieldset>
  )
}

// A number field that saves when the visitor leaves it or presses Enter.
function SavedNumber({
  label,
  value,
  placeholder,
  min,
  max,
  onSave,
}: {
  label: string
  value: string
  placeholder?: string
  min?: string
  max?: string
  onSave: (text: string) => void
}) {
  const [text, setText] = useState(value)
  const commit = () => {
    if (text !== value) onSave(text)
  }
  return (
    <label class="field">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        placeholder={placeholder}
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </label>
  )
}

// Credits a to-do row opened Settings for: their tiles, or with `used`, the
// "Used so far" box under Credit details.
export type CreditFocus = { ids: string[]; used: boolean }

// A card's Settings. Every control saves as it changes, through the same
// wallet change My wallet makes everywhere (and sync, when it's on).
export function CardSettings({
  wallet,
  held,
  asked,
  onAsk,
  focus,
  save,
  onRemove,
  onClose,
  spending,
}: {
  wallet: Wallet
  held: WalletCard
  asked: boolean // "Keep or replace?" is showing its answer
  focus: CreditFocus | null
  onAsk: () => void
  // The change, or why it was refused.
  save: (input: Omit<CardInput, 'id'>) => Promise<string | null>
  onRemove: () => void
  onClose: () => void
  spending: () => Spending
}) {
  const card = cards.get(held.id)
  const today = localToday()
  const info = card ? cardInfo(catalog, card, wallet, today) : null
  const [error, setError] = useState<string | null>(null)
  const [tracking, setTracking] = useState(held.bonus !== undefined)
  // One opening date serves the welcome bonus and any first-year rate.
  const [opened, setOpened] = useState(held.opened ?? held.bonus?.opened ?? '')
  const [spent, setSpent] = useState(held.bonus ? String(held.bonus.spent) : '')
  if (!info || !card) return null
  const milestones = milestoneSummaries(card, held, today)
  const trackedSpend = milestones.find((m) => m.tracked)
  const credits = creditStates(catalog, card, held, today)
  const nights = nightStates(catalog, wallet.valuations, card, held)
  const choices = creditChoices(catalog, card, held, today, wallet.valuations)
  const picks = held.chosen?.picks ?? {}

  const change = (input: Omit<CardInput, 'id'>) => {
    void save(input).then(setError)
  }
  const saveBonus = (on: boolean, date: string, dollars: string) => {
    if (on && date !== '')
      change({
        bonus: { opened: date, spent: Math.max(0, Number(dollars) || 0) },
      })
    else if (!on && held.bonus) change({ bonus: null })
  }

  const fee = hasFee(held)
  const anniversaryLabel =
    info.needsAnniversary && fee
      ? 'Account anniversary, when its fee posts and its yearly cap resets'
      : info.needsAnniversary
        ? 'Account anniversary, when its yearly cap resets'
        : 'When its annual fee posts, so earnrate can check it still pays for itself first'

  return (
    <div class="editor">
      {error ? <p class="callout">{error}</p> : null}
      {info.choices.map((choice) => {
        const chosen = picks[choice.id] ?? []
        const one = choice.pick === 1
        const pick = (option: string) => {
          const on = chosen.includes(option)
          const next = one
            ? [option]
            : on
              ? chosen.filter((o) => o !== option)
              : [...chosen, option]
          change({ picks: { [choice.id]: next } })
        }
        const listedOptions = choice.options.filter(
          (o) =>
            pickName(catalog, card, choice.id, o) !==
            optionName(catalog, card, choice.id, o),
        )
        return (
          <fieldset class="picks" key={choice.id}>
            <legend>
              {choiceName(choice.id)} {one ? 'category' : 'categories'}
              {choice.automatic
                ? `: the ${one ? 'one' : String(choice.pick)} you expect to spend the most in`
                : ''}
              {choice.period === 'quarter' ? ', this quarter' : ''}
              <span class="muted">
                {' '}
                · {String(chosen.length)} of {String(choice.pick)} picked
              </span>
            </legend>
            <div
              class="chips"
              role={one ? 'radiogroup' : 'group'}
              aria-label={`${choiceName(choice.id)} picks`}
            >
              {choice.options.map((option) => {
                const on = chosen.includes(option)
                return (
                  <button
                    type="button"
                    class="chip"
                    key={option}
                    role={one ? 'radio' : undefined}
                    aria-checked={one ? on : undefined}
                    aria-pressed={one ? undefined : on}
                    disabled={!one && !on && chosen.length >= choice.pick}
                    onClick={() => pick(option)}
                  >
                    {capitalize(pickName(catalog, card, choice.id, option))}
                  </button>
                )
              })}
            </div>
            {listedOptions.map((option) => (
              <details class="pick-info" key={option}>
                <summary>
                  Which stores are {pickName(catalog, card, choice.id, option)}?
                </summary>
                <p class="muted small">
                  {capitalize(optionName(catalog, card, choice.id, option))}.
                </p>
              </details>
            ))}
          </fieldset>
        )
      })}
      {info.activation.length > 0 ? (
        <fieldset>
          <legend>
            Bonuses you've activated with {issuerName(info.issuer)}
          </legend>
          {info.activation
            .filter(
              (rule, i) =>
                info.activation.findIndex((r) =>
                  activationGroup(card, r).includes(rule),
                ) === i,
            )
            .map((rule) => {
              const group = activationGroup(card, rule)
              const on = group.some((r) => held.activated.includes(r))
              // Next quarter's bonus waits until the issuer opens it.
              const opens = on
                ? undefined
                : group
                    .map((r) => info.activationOpens[r])
                    .find((d) => d !== undefined)
              return (
                <label class="check" key={rule}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={opens !== undefined}
                    onChange={(e) => {
                      change({
                        activated: e.currentTarget.checked
                          ? [...held.activated, rule]
                          : held.activated.filter((r) => !group.includes(r)),
                      })
                    }}
                  />
                  <span>
                    {activationLabel(card, rule)}
                    {opens === undefined ? null : (
                      <span class="muted">
                        {' '}
                        · opens {shortDate(opens).replace(/, \d{4}$/, '')}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
        </fieldset>
      ) : null}
      {choices.length > 0 ? (
        <div class="settings-credits">
          <h4>Credits you use</h4>
          <CreditPicks
            cards={[{ cardId: held.id, choices }]}
            focus={focus?.used === false ? focus.ids : []}
            onSet={(_, ids, used) => {
              const marks = answeredMarks(heldMarks(card, held), ids, used)
              change({ enrolled: marks.used, skippedCredits: marks.skipped })
            }}
          />
          <details class="how credit-details" open={focus?.used === true}>
            <summary>Credit details</summary>
            {credits.map((c) => (
              <div
                class="credit-detail"
                key={c.credit.id}
                data-credit={c.credit.id}
              >
                <p>
                  <strong>{capitalize(c.name)}</strong>
                </p>
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
                  {c.credit.note ? ` ${c.credit.note}` : ''}
                  {c.credit.listed ? ` ${LISTED_CREDIT_USED}.` : ''}
                </p>
                {!c.skipped && (c.credit.enroll ? c.enrolled : c.confirmed) ? (
                  <SavedNumber
                    label={`Used so far ${CREDIT_THIS_PERIOD[c.period]}`}
                    value={c.used > 0 ? String(c.used) : ''}
                    placeholder="0"
                    min="0"
                    max={String(c.periodAmount)}
                    onSave={(text) =>
                      change({
                        creditUsed: {
                          [c.credit.id]: Math.max(0, Number(text) || 0),
                        },
                      })
                    }
                  />
                ) : null}
              </div>
            ))}
            {nights.map((n) => (
              <div
                class="credit-detail"
                key={n.night.id}
                data-credit={n.night.id}
              >
                <p>
                  <strong>{capitalize(FREE_NIGHT_NAME)}</strong>
                </p>
                <p class="muted small">
                  {capitalize(
                    freeNightText(
                      n.points,
                      currencyLabel(catalog, card.currency),
                    ),
                  )}
                  {n.value === null
                    ? ". It counts against the annual fee once you say what it's worth to you."
                    : `: ${freeNightValueText(
                        n.value,
                        currencyValuation(catalog, wallet, card.currency)
                          .centsPerUnit,
                      )}.`}
                </p>
                <SavedNumber
                  label={`Worth to you${n.value === null ? '' : ' (optional)'}, in dollars`}
                  value={n.own === null ? '' : String(n.own)}
                  placeholder={
                    n.value === null ? '' : String(Math.round(n.value))
                  }
                  min="1"
                  max={String(MAX_NIGHT_VALUE)}
                  onSave={(text) => {
                    const t = text.trim()
                    change({
                      nightValues: {
                        [n.night.id]:
                          t === '' ? null : Number(t.replace(/[$,]/g, '')),
                      },
                    })
                  }}
                />
              </div>
            ))}
          </details>
        </div>
      ) : null}
      {info.needsAnniversary || fee ? (
        <Anniversary
          label={anniversaryLabel}
          value={anniversaryOf(held)}
          onSave={(anniversary) => change({ anniversary })}
        />
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
              max={today}
              onChange={(e) => {
                const date = e.currentTarget.value
                setOpened(date)
                change(
                  date === ''
                    ? held.opened === undefined
                      ? {}
                      : { opened: null }
                    : { opened: date },
                )
                if (tracking) saveBonus(true, date, spent)
              }}
            />
          </label>
        </fieldset>
      ) : null}
      {fee ? (
        <fieldset class="keep" data-keep={held.id}>
          <legend>Keep or replace?</legend>
          {asked ? (
            <KeepOrReplace
              wallet={wallet}
              cardId={held.id}
              spending={spending}
            />
          ) : (
            <>
              <p class="muted small">
                What it adds to your wallet after its fee, and which cards with
                a lower fee would keep the most of that.
              </p>
              <div class="row-buttons">
                <button type="button" onClick={onAsk}>
                  Compare with cheaper cards
                </button>
              </div>
            </>
          )}
        </fieldset>
      ) : null}
      {card.welcome_offer || held.bonus || milestones.length > 0 ? (
        <details class="how more-settings" open={tracking}>
          <summary>More</summary>
          {card.welcome_offer || held.bonus ? (
            <fieldset>
              <legend>Welcome bonus</legend>
              {card.welcome_offer ? (
                <p class="muted small">{offerText(card)}</p>
              ) : null}
              <label class="check">
                <input
                  type="checkbox"
                  checked={tracking}
                  onChange={(e) => {
                    const on = e.currentTarget.checked
                    setTracking(on)
                    saveBonus(on, opened, spent)
                  }}
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
                        max={today}
                        onChange={(e) => {
                          const date = e.currentTarget.value
                          setOpened(date)
                          saveBonus(true, date, spent)
                        }}
                      />
                    </label>
                  ) : null}
                  <SavedNumber
                    label="Spent toward it so far"
                    value={spent}
                    placeholder="0"
                    min="0"
                    onSave={(text) => {
                      setSpent(text)
                      saveBonus(true, opened, text)
                    }}
                  />
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
              <SavedNumber
                label="Spent on this card so far this year"
                value={trackedSpend ? String(trackedSpend.spent) : ''}
                placeholder="Not tracked"
                min="0"
                onSave={(text) => {
                  if (text === '') return
                  // Every purchase counts toward every milestone, so one
                  // total sets them all.
                  const dollars = Math.max(0, Number(text) || 0)
                  change({
                    milestoneSpent: Object.fromEntries(
                      milestones.map((m) => [m.id, dollars]),
                    ),
                  })
                }}
              />
            </fieldset>
          ) : null}
        </details>
      ) : null}
      <div class="row-buttons">
        <button type="button" onClick={onClose}>
          Close
        </button>
        <button type="button" class="link danger-link" onClick={onRemove}>
          Remove card
        </button>
      </div>
    </div>
  )
}
