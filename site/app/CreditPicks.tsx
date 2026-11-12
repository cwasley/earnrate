import { useEffect, useRef, useState } from 'preact/hooks'
import type { CreditChoice } from '../../src/engine/credits.ts'
import { possessive } from '../../src/engine/text.ts'
import { shortestName, wholeDollars } from './format.ts'
import { Check } from './QuickCards.tsx'

export type CreditAnswer = CreditChoice['answer']

// Shown before "N more": the card's credits worth the most.
const SHOWN = 4

const worth = (c: CreditChoice) =>
  c.yearly === null
    ? null
    : c.night
      ? `up to ${wholeDollars(c.yearly)}`
      : `${wholeDollars(c.yearly)}/yr`

const Cross = () => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
  </svg>
)

// One card's statement credits and free nights as tiles, in the card
// picker's look: tap a tile for "I use it", its corner × for "I don't".
// Which is which lives only in aria-pressed and data-answer: every tile has
// the same elements, its check shown by CSS. Once every credit has an
// answer, the card folds to one line until it's opened again.
function CardCredits({
  cardId,
  choices,
  named,
  onAnswer,
}: {
  cardId: string
  choices: CreditChoice[]
  named: boolean
  onAnswer: (ids: string[], answer: CreditAnswer) => void
}) {
  const ids = (keep: (c: CreditChoice) => boolean) =>
    choices.filter(keep).map((c) => c.id)
  const unused = ids((c) => c.answer !== 'used')
  const open = ids((c) => c.answer === null)
  const used = choices.length - unused.length
  const name = shortestName(cardId)
  // Once opened, the rest stay shown; they start shown when one of them
  // already has an answer.
  const [more, setMore] = useState(() =>
    choices.slice(SHOWN).some((c) => c.answer !== null),
  )
  const [unfolded, setUnfolded] = useState(false)
  const folded = open.length === 0 && !unfolded
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
          onClick={() => setUnfolded(true)}
        >
          <span class="credit-picks-sum">
            {named ? <strong>{name}</strong> : null}
            <span>
              {String(used)} of {String(choices.length)} used
            </span>
          </span>
          <span class="credit-picks-change">Change</span>
        </button>
      </div>
    )
  const shown = more ? choices : choices.slice(0, SHOWN)
  const hidden = choices.length - shown.length
  return (
    <div class="credit-picks-card">
      <div class="credit-picks-head">
        {named ? <strong>{name}</strong> : null}
        <span class="credit-picks-all">
          {open.length === 0 ? (
            <button
              type="button"
              class="credit-pill"
              aria-expanded={true}
              aria-label={`Done with ${possessive(name)} credits`}
              onClick={() => setUnfolded(false)}
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                class="credit-pill"
                aria-label={`I use all of ${possessive(name)} credits`}
                onClick={() => onAnswer(unused, 'used')}
              >
                All
              </button>
              <button
                type="button"
                class="credit-pill"
                aria-label={`I don't use the rest of ${possessive(name)} credits`}
                onClick={() => onAnswer(open, 'skipped')}
              >
                None
              </button>
            </>
          )}
        </span>
      </div>
      <ul class="credit-tiles" aria-label={`${name} credits`}>
        {shown.map((c, i) => {
          const used = c.answer === 'used'
          const skipped = c.answer === 'skipped'
          const value = worth(c)
          return (
            <li key={c.id} class="credit-tile" data-answer={c.answer ?? 'none'}>
              <button
                type="button"
                class="credit-use"
                ref={i === SHOWN ? firstMore : i === 0 ? firstTile : null}
                aria-pressed={used}
                onClick={() => onAnswer([c.id], used ? null : 'used')}
              >
                <span class="credit-name">{c.name}</span>
                <span class="credit-meta">
                  {value === null ? null : (
                    <span class="credit-value">{value}</span>
                  )}
                  {c.enroll ? (
                    <span class="credit-enroll">
                      Enroll
                      <span class="visually-hidden"> with the issuer</span>
                    </span>
                  ) : null}
                </span>
                <Check />
              </button>
              <button
                type="button"
                class="credit-skip"
                aria-pressed={skipped}
                aria-label={`Don't use ${c.name}`}
                onClick={() => onAnswer([c.id], skipped ? null : 'skipped')}
              >
                <Cross />
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
    </div>
  )
}

export function CreditPicks({
  cards,
  onAnswer,
}: {
  cards: { cardId: string; choices: CreditChoice[] }[]
  onAnswer: (cardId: string, ids: string[], answer: CreditAnswer) => void
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
          onAnswer={(ids, answer) => onAnswer(c.cardId, ids, answer)}
        />
      ))}
    </div>
  )
}
