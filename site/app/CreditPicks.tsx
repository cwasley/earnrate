import { useEffect, useRef, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import type { CreditChoice } from '../../src/engine/credits.ts'
import { possessive } from '../../src/engine/text.ts'
import { noneChange, tapChange, type MarksChange } from '../rate/answers.ts'
import { enrollLine } from './credit-enroll.ts'
import { shortestName, wholeDollars } from './format.ts'
import { Check } from './QuickCards.tsx'

// Shown before "N more": the card's credits worth the most.
const SHOWN = 4

const worth = (c: CreditChoice) =>
  c.yearly === null
    ? null
    : c.night
      ? `up to ${wholeDollars(c.yearly)}`
      : `${wholeDollars(c.yearly)}/yr`

const idsWith = (choices: CreditChoice[], answer: CreditChoice['answer']) =>
  choices.filter((c) => c.answer === answer).map((c) => c.id)

// "2 of 4 used", "1 used · 3 to answer"
function foldedCount(choices: CreditChoice[]): string {
  const used = idsWith(choices, 'used').length
  const open = idsWith(choices, null).length
  if (open === 0)
    return used === 0
      ? 'None used'
      : `${String(used)} of ${String(choices.length)} used`
  return used === 0
    ? `${String(open)} to answer`
    : `${String(used)} used · ${String(open)} to answer`
}

// One card's statement credits and free nights as tiles, in the card
// picker's look. A tap marks one credit used; another tap puts it back as it
// was, unanswered unless it had been answered "no". The rest stay
// unanswered until None marks them not used. The answer lives only in
// aria-pressed and data-answer: every tile has the same elements, its check
// and "Not used" shown by CSS. A card answered before the page opened starts
// folded to one line; Done folds it again.
function CardCredits({
  cardId,
  choices,
  named,
  focus,
  onSet,
}: {
  cardId: string
  choices: CreditChoice[]
  named: boolean
  focus: string[]
  onSet: (change: MarksChange) => void
}) {
  const unanswered = idsWith(choices, null)
  const done = unanswered.length === 0
  const started = unanswered.length < choices.length
  // What each tile was before this view marked it used.
  const before = useRef(new Map<string, CreditChoice['answer']>())
  const name = shortestName(cardId)
  // Once opened, the rest stay shown; they start shown when one of them
  // is used, or is the one a to-do row opened Settings for.
  const [more, setMore] = useState(() =>
    choices
      .slice(SHOWN)
      .some((c) => c.answer === 'used' || focus.includes(c.id)),
  )
  const [folded, setFolded] = useState(
    () => done && !choices.some((c) => focus.includes(c.id)),
  )
  const opened = useRef(false)
  const firstMore = useRef<HTMLButtonElement>(null)
  const firstTile = useRef<HTMLButtonElement>(null)
  const line = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (more && opened.current) firstMore.current?.focus()
  }, [more])
  // The tapped button goes when the card folds or unfolds, so focus moves
  // to what took its place.
  const wasFolded = useRef(folded)
  useEffect(() => {
    if (wasFolded.current === folded) return
    wasFolded.current = folded
    ;(folded ? line : firstTile).current?.focus()
  }, [folded])
  if (folded)
    return (
      <div class="credit-picks-card">
        <button
          type="button"
          class="credit-picks-line"
          ref={line}
          aria-expanded={false}
          onClick={() => setFolded(false)}
        >
          <span class="credit-picks-sum">
            {named ? (
              <>
                <strong>{name}</strong>{' '}
              </>
            ) : null}
            <span class="nowrap">
              {named ? '· ' : null}
              {foldedCount(choices)}
            </span>
          </span>
          <span class="credit-picks-change">Change</span>
        </button>
      </div>
    )
  const shown = more ? choices : choices.slice(0, SHOWN)
  const hidden = choices.length - shown.length
  const enroll = enrollLine(catalog, cardId, choices)
  return (
    <div class="credit-picks-card">
      <div class="credit-picks-head">
        {named ? <strong>{name}</strong> : null}
        <span class="credit-picks-all">
          <button
            type="button"
            class="credit-pill credit-done"
            aria-expanded={true}
            aria-label={`Done with ${possessive(name)} credits`}
            aria-hidden={!started}
            tabIndex={started ? undefined : -1}
            disabled={!started}
            onClick={() => setFolded(true)}
          >
            Done
          </button>
          <button
            type="button"
            class="credit-pill"
            aria-label={`I use all of ${possessive(name)} credits`}
            onClick={() => {
              for (const c of choices)
                if (c.answer !== 'used') before.current.set(c.id, c.answer)
              onSet({ use: choices.map((c) => c.id) })
            }}
          >
            All
          </button>
          <button
            type="button"
            class="credit-pill"
            aria-label={
              done || !started
                ? `I use none of ${possessive(name)} credits`
                : `I don't use ${possessive(name)} other credits`
            }
            onClick={() => {
              before.current.clear()
              onSet(noneChange(choices))
            }}
          >
            None
          </button>
        </span>
      </div>
      <ul class="credit-tiles" aria-label={`${name} credits`}>
        {shown.map((c, i) => {
          const on = c.answer === 'used'
          const value = worth(c)
          return (
            <li key={c.id} class="credit-tile" data-credit={c.id}>
              <button
                type="button"
                class="credit-use"
                ref={i === SHOWN ? firstMore : i === 0 ? firstTile : null}
                aria-pressed={on}
                data-answer={c.answer ?? 'none'}
                onClick={() => {
                  const was = before.current.get(c.id)
                  if (on) before.current.delete(c.id)
                  else before.current.set(c.id, c.answer)
                  onSet(tapChange(c, was))
                }}
              >
                <span class="credit-name">{c.name}</span>
                {value === null ? null : (
                  <span class="credit-value">{value}</span>
                )}
                <span class="credit-no">Not used</span>
                <Check />
              </button>
            </li>
          )
        })}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          class="link credit-more"
          onClick={() => {
            opened.current = true
            setMore(true)
          }}
        >
          {hidden} more
        </button>
      ) : null}
      {enroll === null ? null : <p class="credit-enroll-line">{enroll}</p>}
    </div>
  )
}

export function CreditPicks({
  cards,
  focus = [],
  onSet,
}: {
  cards: { cardId: string; choices: CreditChoice[] }[]
  // Credits a to-do row opened Settings for: shown, not folded away.
  focus?: string[]
  onSet: (cardId: string, change: MarksChange) => void
}) {
  // Checks arrive with the motion vocabulary's fade only after first paint.
  const [settled, setSettled] = useState(false)
  useEffect(() => setSettled(true), [])
  if (cards.length === 0) return null
  return (
    <div class={settled ? 'credit-picks settled' : 'credit-picks'}>
      {cards.map((c) => (
        <CardCredits
          key={c.cardId}
          cardId={c.cardId}
          choices={c.choices}
          named={cards.length > 1}
          focus={focus}
          onSet={(change) => onSet(c.cardId, change)}
        />
      ))}
    </div>
  )
}
