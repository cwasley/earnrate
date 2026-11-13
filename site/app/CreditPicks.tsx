import { useEffect, useRef, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import type { CreditChoice } from '../../src/engine/credits.ts'
import { possessive } from '../../src/engine/text.ts'
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

const usedIds = (choices: CreditChoice[]) =>
  choices.filter((c) => c.answer === 'used').map((c) => c.id)

// A card's answer is the credits it uses; the rest of its credits are then
// not used. Every credit on it has an answer once any tile or All / None on
// it is tapped.
const answered = (choices: CreditChoice[]) =>
  choices.every((c) => c.answer !== null)

// One card's statement credits and free nights as tiles, in the card
// picker's look: a tap toggles a credit between used and not. Which is which
// lives only in aria-pressed: every tile has the same elements, its check
// shown by CSS. A card answered before the page opened starts folded to one
// line; Done folds it again.
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
  onSet: (used: string[]) => void
}) {
  const used = usedIds(choices)
  const done = answered(choices)
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
              {used.length === 0
                ? 'None used'
                : `${String(used.length)} of ${String(choices.length)} used`}
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
            aria-hidden={!done}
            tabIndex={done ? undefined : -1}
            disabled={!done}
            onClick={() => setFolded(true)}
          >
            Done
          </button>
          <button
            type="button"
            class="credit-pill"
            aria-label={`I use all of ${possessive(name)} credits`}
            onClick={() => onSet(choices.map((c) => c.id))}
          >
            All
          </button>
          <button
            type="button"
            class="credit-pill"
            aria-label={`I use none of ${possessive(name)} credits`}
            onClick={() => onSet([])}
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
                onClick={() =>
                  onSet(on ? used.filter((id) => id !== c.id) : [...used, c.id])
                }
              >
                <span class="credit-name">{c.name}</span>
                {value === null ? null : (
                  <span class="credit-value">{value}</span>
                )}
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
  onSet: (cardId: string, ids: string[], used: string[]) => void
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
          onSet={(used) =>
            onSet(
              c.cardId,
              c.choices.map((x) => x.id),
              used,
            )
          }
        />
      ))}
    </div>
  )
}
