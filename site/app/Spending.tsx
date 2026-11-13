import { Fragment, type ComponentChildren } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import { HALF_CENT } from '../../src/engine/compare.ts'
import { pickName } from '../../src/engine/rule-text.ts'
import type { Picks } from '../../src/engine/explore.ts'
import { followingOwnLink } from './add-from-link.ts'
import { CardArt } from './CardArt.tsx'
import { debouncer } from './debounce.ts'
import {
  answerFor,
  jobFor,
  readyAnswer,
  type Answer as FindAnswer,
} from './find/run.ts'
import { track } from './track.ts'
import { localToday } from '../../src/engine/periods.ts'
import {
  ifMemberLines,
  membershipName,
  placedAmong,
} from '../../src/engine/memberships.ts'
import {
  OFFERS_MAY_DIFFER,
  offerTerms,
  type OfferSummary,
} from '../../src/engine/offers.ts'
import {
  byNet,
  countedLines,
  nothingCounted,
  resolveSpendLines,
  spendLineFor,
  TYPICAL_MONTHLY_SPEND,
  type CatalogSimulation,
  type PairSimulation,
  type Simulation,
} from '../../src/engine/simulate.ts'
import {
  categoryPhrase,
  CREDITS_APART,
  currencyName,
  ifCreditsUsedText,
  listed,
  minimumSpendText,
  pairCreditsUsedText,
  shortDate,
  withArticle,
} from '../../src/engine/text.ts'
import { cards, feeLabel, shortName, wholeDollars, words } from './format.ts'
import {
  isTypicalRows,
  loadSpendingRows,
  saveSpendingRows,
  type Row as SpendingRow,
} from './spending-rows.ts'
import type { Saved, Settings } from './settings.ts'
import { NewCard } from './NewCard.tsx'
import type { Outcome, WalletOp } from './sync.ts'
import type { Wallet } from '../../src/schema/wallet.ts'

export type Row = SpendingRow

export const lineFor = (what: string, monthly: number) =>
  spendLineFor(catalog, what, monthly)

// How long typing pauses before the answer is worked out again.
const SETTLE_MS = 250

// Rows shown before "Show more", and how many it shows: the best card and
// the best pair, then the rest of each ranking.
const SHOWN = 1
const MORE = 10

function picksText(cardId: string, picks: Picks): string | null {
  const card = cards.get(cardId)
  const all = Object.entries(picks).flatMap(([choice, options]) =>
    options.map((o) => (card ? pickName(catalog, card, choice, o) : words(o))),
  )
  return all.length === 0 ? null : `Picks: ${listed(all)}`
}

const pairKey = (sim: Simulation) => sim.cards.map((c) => c.cardId).join('+')

// "Everything else" reads last in a card's list.
const OTHER = catalog.categories.find((c) => c.id === 'other')?.name

// Category names read mid-sentence in lower case; store names keep theirs.
function phrase(label: string): string {
  const category = catalog.categories.find((c) => c.name === label)
  return category ? categoryPhrase(catalog, category.id) : label
}

function Split({ sim }: { sim: Simulation }) {
  const byCard = new Map<string, string[]>()
  for (const line of sim.lines) {
    const first = line.cards[0]
    if (first !== undefined)
      byCard.set(first, [...(byCard.get(first) ?? []), line.label])
  }
  return (
    <ul class="split">
      {[...byCard].map(([id, labels]) => (
        <li key={id}>
          <strong>{shortName(id)}</strong> for{' '}
          {listed(
            [...labels]
              .sort((a, b) => Number(a === OTHER) - Number(b === OTHER))
              .map(phrase),
          )}
        </li>
      ))}
    </ul>
  )
}

// The first year with the card's welcome offer, when it differs from the
// yearly figure shown beside it.
function firstYear(offer: OfferSummary | undefined, net: number) {
  const yearOne = offer?.plan?.yearOne
  return yearOne === undefined || Math.round(yearOne) === Math.round(net)
    ? null
    : yearOne
}

// The pair's cards with what each covers; the one that takes "Everything
// else" covers the rest.
function pairParts(sim: Simulation): { id: string; covers: string }[] {
  const byCard = new Map<string, string[]>()
  for (const line of sim.lines) {
    const first = line.cards[0]
    if (first !== undefined)
      byCard.set(first, [...(byCard.get(first) ?? []), line.label])
  }
  return [...byCard]
    .map(([id, labels]) => ({
      id,
      covers:
        OTHER !== undefined && labels.includes(OTHER)
          ? 'the rest'
          : listed(labels.map(phrase)),
    }))
    .sort(
      (a, b) =>
        Number(a.covers === 'the rest') - Number(b.covers === 'the rest'),
    )
}

// Stand-ins for text still being worked out, a line each, so the answer
// takes about the room they held.
// `mid` and `wide` are how many lines the text takes on wider screens.
function Lines({
  n,
  mid = n,
  wide = mid,
}: {
  n: number
  mid?: number
  wide?: number
}) {
  return (
    <span class="skel" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          class={
            i >= mid
              ? 'skel-past-mid'
              : i >= wide
                ? 'skel-past-wide'
                : undefined
          }
        >
          {'\u00a0'}
        </span>
      ))}
    </span>
  )
}

// The top rows' shapes in typical spending's answer at phone width: lines
// of name and fee, and whether a first-year figure sits under the amount.
const SKEL_SINGLES = [
  {
    name: { n: 2, mid: 2, wide: 1 },
    fee: { n: 2, mid: 2, wide: 1 },
    first: true,
  },
]
const SKEL_PAIRS = [{ name: { n: 3, mid: 3, wide: 2 } }]
// The best pair's split under it.
const SKEL_SPLIT = { n: 4, mid: 3, wide: 1 }
// A new card for the wallet's top rows.
const SKEL_ADDITIONS = [
  { name: { n: 2, mid: 2, wide: 1 }, fee: 1 },
  { name: { n: 2, mid: 1, wide: 1 }, fee: 1 },
  { name: 1, fee: 1 },
]

// A result row before the answer is in.
// Lines of text at phone, mid and wide widths, or the same at all three.
type Shape = number | { n: number; mid?: number; wide?: number }
const lines = (shape: Shape) =>
  typeof shape === 'number' ? { n: shape } : shape

function SkelRow({
  rank,
  name,
  fee = 1,
  first = false,
  pair = false,
}: {
  rank: number
  name: Shape
  fee?: Shape
  first?: boolean
  pair?: boolean
}) {
  return (
    <div class="result-top" aria-hidden="true">
      <span class="rank">{rank}</span>
      {pair ? (
        <span class="art-pair">
          <span class="card-art skel-art" />
          <span class="card-art skel-art" />
        </span>
      ) : (
        <span class="card-art skel-art" />
      )}
      <span class="result-name">
        <strong>
          <Lines {...lines(name)} />
        </strong>
        <span class="muted">
          <Lines {...lines(fee)} />
        </span>
      </span>
      <span class="rate skel-rate">
        <Lines n={1} />
        {first ? (
          <small class="first-year">
            <Lines n={1} />
          </small>
        ) : null}
      </span>
    </div>
  )
}

type Shown = {
  rows: Row[]
  found: FindAnswer
  result: CatalogSimulation | null
  offers: Map<string, OfferSummary>
}

function shownAnswer(rows: Row[], found: FindAnswer | null): Shown | null {
  return found
    ? {
        rows,
        found,
        result: found.result,
        offers: new Map(found.offers.map((o) => [o.cardId, o])),
      }
    : null
}

export type FindMode = 'add' | 'scratch'

const MODES: { mode: FindMode; label: string }[] = [
  { mode: 'add', label: 'A new card for my wallet' },
  { mode: 'scratch', label: 'Best cards from scratch' },
]

// What a card adds to the saved wallet, or the best cards with none.
function ModeSwitch({
  mode,
  onMode,
}: {
  mode: FindMode
  onMode: (mode: FindMode) => void
}) {
  return (
    <div class="segments find-mode" role="radiogroup" aria-label="Which cards">
      {MODES.map((m) => (
        <label key={m.mode}>
          <input
            type="radio"
            name="find-mode"
            checked={mode === m.mode}
            onChange={() => onMode(m.mode)}
          />
          {m.label}
        </label>
      ))}
    </div>
  )
}

// "Yours", on a card the visitor holds: data-*, never a class.
const Yours = ({ held }: { held: boolean }) =>
  held ? <span data-yours="">Yours</span> : null

export function Spending({
  settings,
  saved,
  wallet,
  filters,
  mode,
  onMode,
  perform,
  locked,
}: {
  settings: Settings
  saved: Saved
  wallet: Wallet | null
  filters: ComponentChildren
  mode: FindMode
  onMode: (mode: FindMode) => void
  perform: (op: WalletOp) => Promise<Outcome>
  locked: boolean
}) {
  const [rows, setStateRows] = useState<Row[]>(loadSpendingRows)
  const today = localToday()
  const hasCards = (wallet?.cards.length ?? 0) > 0
  // A new card for the saved wallet, or the best cards from scratch.
  const forWallet = hasCards && mode === 'add' ? wallet : null
  const heldIds = useMemo(
    () => new Set(wallet?.cards.map((c) => c.id) ?? []),
    [wallet],
  )
  // The answer on screen and the rows it's for, from the start when the
  // home page worked it out before the tab opened. Each card alone, as the
  // next-card planner values it, comes with it: the same spending all on
  // it, with its welcome offer in the first year.
  const [answer, setAnswer] = useState<Shown | null>(() =>
    shownAnswer(
      rows,
      readyAnswer(jobFor(rows, settings, saved, today, forWallet)),
    ),
  )
  // The rows the answer is for. Null until the tab has painted, so it shows
  // before the first answer is worked out.
  const [settled, setSettled] = useState<Row[] | null>(() =>
    answer ? rows : null,
  )
  const settle = useMemo(() => debouncer(SETTLE_MS), [])
  useEffect(() => {
    setSettled(rows)
    return () => settle.cancel()
  }, [])
  // Typing waits for a pause before the answer is worked out again; other
  // changes don't.
  const setRows = (next: Row[], typing = false) => {
    setStateRows(next)
    saveSpendingRows(next)
    if (typing) settle.run(() => setSettled(next))
    else {
      settle.cancel()
      setSettled(next)
    }
  }
  const [newRow, setNewRow] = useState('')
  // Closed on every visit: the line above them says what they add up to.
  const [editing, setEditing] = useState(false)
  const [moreSingles, setMoreSingles] = useState(false)
  const [morePairs, setMorePairs] = useState(false)
  // Cards a card or comparison page asked about (#spending&card=<id>, or
  // #wallet&whatif=<id> for what it adds to the wallet): shown with their
  // rank even below the top ones, the first one open.
  const [focus] = useState(() => {
    const hash = new URLSearchParams(location.hash.slice(1))
    return [...hash.getAll('card'), ...hash.getAll('whatif')].filter((id) =>
      catalog.cards.some((c) => c.id === id),
    )
  })
  useEffect(() => {
    if (focus.length > 0) track(forWallet ? 'page-whatif' : 'page-spending')
  }, [focus])
  // The open row: a card id, or a pair's ids joined with "+".
  const [open, setOpen] = useState<string | null>(focus[0] ?? null)
  const toggle = (key: string) => setOpen(open === key ? null : key)
  useEffect(() => {
    if (settled === null) return
    // A newer answer stops this one; the one on screen stays until it's in.
    return answerFor(
      catalog,
      jobFor(settled, settings, saved, today, forWallet),
      (a) =>
        setAnswer((was) =>
          was?.found === a && was.rows === settled
            ? was
            : shownAnswer(settled, a),
        ),
    )
  }, [settled, settings, saved, today, forWallet])
  const working = settled !== rows || answer?.rows !== settled
  const result = answer?.result ?? null
  const offers = answer?.offers ?? new Map<string, OfferSummary>()
  // What the answer on screen is for, or before the first one, the rows.
  const shown = answer?.rows ?? settled ?? rows
  const typical = isTypicalRows(shown)
  const lines = useMemo(
    () =>
      resolveSpendLines(
        catalog,
        shown.map((r) => lineFor(r.what, r.monthly)),
      ),
    [shown],
  )
  const unknown = lines.filter((l) => l.merchant.source === 'none')
  const known = useMemo(
    () => lines.filter((l) => l.merchant.source !== 'none'),
    [lines],
  )
  const leftOut = useMemo(() => nothingCounted(catalog, known), [known])
  // Known before it's worked out: the answer has no result for this.
  const nothing = known.length === 0 || leftOut !== null
  // Nothing shown yet: the answer's parts hold its room.
  const pending = answer === null && !nothing
  const shownSingles = moreSingles ? MORE : SHOWN
  const shownPairs = morePairs ? MORE : SHOWN
  const members = result
    ? ifMemberLines(
        catalog,
        placedAmong(
          result.membersOnly,
          result.singles,
          shownSingles,
          byNet,
        ).map((s) => ({
          membership: s.membership,
          text: `${shortName(s.cards[0]?.cardId ?? '')}, ${wholeDollars(s.net)} a year`,
        })),
      )
    : []
  const total = rows.reduce((sum, r) => sum + r.monthly, 0)
  const monthly = countedLines(catalog, known).reduce(
    (sum, l) => sum + l.monthly,
    0,
  )
  const single = result?.singles[0]
  const pair = result?.pairs[0]
  // A pair is worth showing first only when it beats the best card alone.
  const pairBetter =
    pair !== undefined && single !== undefined && pair.net - single.net >= 0.5
  const ties =
    result && single
      ? result.singles.filter(
          (s) => s !== single && Math.abs(s.net - single.net) < HALF_CENT,
        ).length
      : 0
  // The first answer scrolls to a card a page asked about.
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current || focus.length === 0 || !result) return
    scrolled.current = true
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-single="${CSS.escape(focus[0] ?? '')}"]`)
        ?.scrollIntoView({ block: 'center' })
    })
  }, [focus, result])
  const notes = result
    ? [
        ...new Set([
          ...result.singles.slice(0, 3).flatMap((s) => s.notes),
          ...result.pairs.slice(0, 3).flatMap((s) => s.notes),
        ]),
      ]
    : []

  const singleRow = (s: Simulation, rank: number) => {
    const card = s.cards[0]
    if (!card) return null
    const picks = picksText(card.cardId, card.picks)
    const offer = offers.get(card.cardId)
    const first = firstYear(offer, s.net)
    const minimum = offer?.plan?.minimumSpend
    const isOpen = open === card.cardId
    const held = heldIds.has(card.cardId)
    return (
      // Keyed by rank, so a new answer changes the rows in place.
      <li
        class={rank === 1 ? 'result hero' : 'result'}
        key={rank}
        data-single={card.cardId}
        data-held={held ? '' : undefined}
      >
        <button
          type="button"
          class="result-top result-toggle"
          aria-expanded={isOpen}
          onClick={() => toggle(card.cardId)}
        >
          <span class="rank">{rank}</span>
          <CardArt id={card.cardId} />
          <span class="result-name">
            <strong>
              {shortName(card.cardId)}
              <Yours held={held} />
            </strong>
            <span class="muted">
              {feeLabel(card.cardId)}
              {rank === 1 && ties > 0
                ? ` · ${String(ties)} more ${ties === 1 ? 'ties' : 'tie'}`
                : ''}
            </span>
          </span>
          <span class="rate">
            {wholeDollars(s.net)}
            <small>/yr</small>
            {first !== null ? (
              <small class="first-year">{wholeDollars(first)} first year</small>
            ) : minimum && !minimum.reachable ? (
              <small class="first-year">bonus out of reach</small>
            ) : null}
          </span>
        </button>
        {isOpen ? (
          <p class="muted">
            {wholeDollars(s.rewards)} back a year before the fee.
          </p>
        ) : null}
        {isOpen && offer ? (
          <p class="muted">
            Welcome offer:{' '}
            {offerTerms(offer, currencyName(catalog, offer.currency))}.
            {minimum && minimum.reachable
              ? ` ${minimumSpendText(offer.spend, offer.months, minimum, typical)}`
              : ''}
          </p>
        ) : null}
        {isOpen && offer && minimum && !minimum.reachable ? (
          <p class="warn">
            {minimumSpendText(offer.spend, offer.months, minimum, typical)}
          </p>
        ) : null}
        {isOpen && picks ? <p class="muted">{picks}</p> : null}
        {isOpen
          ? s.credits
              .filter((c) => !c.held)
              .map((c) => (
                <p class="muted" key={c.cardId}>
                  {ifCreditsUsedText(c, s.netIfCreditsUsed)}
                </p>
              ))
          : null}
        {isOpen && offer ? (
          <p class="muted">
            {offer.validTo ? `Offer ends ${shortDate(offer.validTo)}. ` : ''}
            Public offer as of {shortDate(offer.lastVerified)}.
            {offer.note ? ` ${offer.note}` : ''}
          </p>
        ) : null}
        {isOpen ? (
          <div class="row-buttons">
            <a class="row-link" href={`/cards/${card.cardId}`}>
              See card details
            </a>
            {held ? null : (
              <a
                class="row-link primary"
                href={`#wallet&add=${card.cardId}`}
                onClick={() => followingOwnLink(`#wallet&add=${card.cardId}`)}
              >
                Add to my wallet
              </a>
            )}
          </div>
        ) : null}
      </li>
    )
  }

  const pairRow = (p: PairSimulation, rank: number) => {
    const isOpen = open === pairKey(p)
    const parts = pairParts(p)
    return (
      <li class={rank === 1 ? 'result hero' : 'result'} key={rank}>
        <button
          type="button"
          class="result-top result-toggle"
          aria-expanded={isOpen}
          onClick={() => toggle(pairKey(p))}
        >
          <span class="rank">{rank}</span>
          <span class="art-pair">
            {p.cards.map((c) => (
              <CardArt id={c.cardId} key={c.cardId} />
            ))}
          </span>
          <span class="result-name">
            <strong>
              {p.cards.map((c, i) => (
                <Fragment key={c.cardId}>
                  {i > 0 ? ' + ' : ''}
                  {shortName(c.cardId)}
                  <Yours held={heldIds.has(c.cardId)} />
                </Fragment>
              ))}
            </strong>
            <span class="muted">{wholeDollars(p.annualFees)} in fees</span>
          </span>
          <span class="rate">
            {wholeDollars(p.net)}
            <small>/yr</small>
          </span>
        </button>
        {/* The best pair says how it splits the spending without a tap. */}
        {rank === 1 && parts.length === 2 ? (
          <p class="muted pair-split">
            {parts.map((part, i) => (
              <Fragment key={part.id}>
                {i > 0 ? '; ' : ''}
                {shortName(part.id)} for {part.covers}
              </Fragment>
            ))}
          </p>
        ) : null}
        {isOpen ? (
          <p class="muted">
            {wholeDollars(p.rewards)} back a year before fees.
          </p>
        ) : null}
        {isOpen && rank !== 1 ? <Split sim={p} /> : null}
        {isOpen && p.otherCredits > 0 ? (
          <p class="muted">
            {pairCreditsUsedText(
              p.credits.filter((c) => !c.held).map((c) => shortName(c.cardId)),
              p.otherCredits,
              p.netIfCreditsUsed,
              p.credits.some((c) => !c.held && c.nights > 0),
            )}
          </p>
        ) : null}
        {isOpen && p.alternatives.length > 0 ? (
          <p class="muted">
            Same result with {listed(p.alternatives.map(shortName), 'or')}{' '}
            instead.
          </p>
        ) : null}
        {isOpen ? (
          <div class="row-buttons">
            {p.cards.map((c) => (
              <a class="row-link" href={`/cards/${c.cardId}`} key={c.cardId}>
                See {shortName(c.cardId)}
              </a>
            ))}
          </div>
        ) : null}
      </li>
    )
  }

  const add = (text: string) => {
    const what = text.trim()
    if (what === '' || rows.some((r) => r.what === what)) return
    setRows([...rows, { what, monthly: 100 }])
    setNewRow('')
  }

  const update = (i: number, monthly: number) =>
    setRows(
      rows.map((r, j) => (j === i ? { ...r, monthly } : r)),
      true,
    )

  const singlesLeft = result ? Math.min(MORE, result.singles.length) - SHOWN : 0
  const pairsLeft = result
    ? Math.min(MORE, result.pairs.length) - (pairBetter ? SHOWN : 0)
    : 0

  const skelRows = (pairs: boolean) =>
    (pairs ? SKEL_PAIRS : SKEL_SINGLES).map((shape, i) => (
      <li class={i === 0 ? 'result hero' : 'result'} key={i + 1}>
        <SkelRow rank={i + 1} pair={pairs} {...shape} />
        {pairs ? (
          <p class="muted pair-split">
            <Lines {...SKEL_SPLIT} />
          </p>
        ) : null}
      </li>
    ))
  const skelMore = (
    <div class="more skel-more" aria-hidden="true">
      <Lines n={1} />
    </div>
  )

  const editor = (
    <details
      class="filters spend-edit"
      open={editing || nothing}
      onToggle={(e) => setEditing(e.currentTarget.open)}
    >
      <summary>
        <span class="basis">
          {typical
            ? `On typical U.S. spending, about ${wholeDollars(monthly)} a month.`
            : `On your spending, ${wholeDollars(monthly)} a month.`}
        </span>{' '}
        Change it
      </summary>
      <div class="panel">
        <p class="muted">
          Roughly what you spend each month. Change the numbers, remove what
          doesn't apply, or add stores.
        </p>
        <ul class="spend">
          {rows.map((r, i) => (
            <li key={r.what}>
              <label for={`spend-${String(i)}`}>{r.what}</label>
              <span class="dollar">
                $
                <input
                  id={`spend-${String(i)}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="10"
                  value={r.monthly}
                  onInput={(e) => {
                    track('spending-edit')
                    update(i, Math.max(0, Number(e.currentTarget.value) || 0))
                  }}
                  onBlur={() => settle.flush()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') settle.flush()
                  }}
                />
              </span>
              <button
                type="button"
                class="remove"
                aria-label={`Remove ${r.what}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <form
          class="ask small"
          onSubmit={(e) => {
            e.preventDefault()
            add(newRow)
          }}
        >
          <label class="visually-hidden" for="spend-add">
            Add a store or category
          </label>
          <input
            id="spend-add"
            type="text"
            list="suggestions"
            placeholder="Add a store or category"
            autocomplete="off"
            value={newRow}
            onInput={(e) => setNewRow(e.currentTarget.value)}
            // WebKit keeps Enter for the suggestion list and doesn't submit.
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.isComposing) return
              e.preventDefault()
              add(e.currentTarget.value)
            }}
          />
          <button type="submit">Add</button>
        </form>
        <p class="total">
          {wholeDollars(total)} a month · {wholeDollars(total * 12)} a year
        </p>
        {isTypicalRows(rows) ? null : (
          <p class="reset-typical">
            <button
              type="button"
              class="link"
              onClick={() =>
                setRows(TYPICAL_MONTHLY_SPEND.map((t) => ({ ...t })))
              }
            >
              Use typical amounts
            </button>
          </p>
        )}
      </div>
    </details>
  )

  return (
    <div>
      {hasCards ? <ModeSwitch mode={mode} onMode={onMode} /> : null}
      {unknown.length > 0 ? (
        <p class="callout">
          earnrate doesn't know{' '}
          {listed(unknown.map((l) => `“${l.merchant.input}”`))}, so the results
          leave {unknown.length === 1 ? 'it' : 'them'} out. Use a category like
          dining or groceries instead.
        </p>
      ) : null}
      {leftOut !== null ? <p class="callout">{leftOut}</p> : null}
      {editor}
      {forWallet ? null : filters}

      {forWallet ? (
        nothing ? null : (
          <NewCard
            wallet={forWallet}
            additions={answer?.found.additions ?? null}
            typical={typical}
            locked={locked}
            onChange={(op) => void perform(op)}
            focus={focus}
            skeleton={{
              intro: (
                <p class="muted">
                  <Lines n={2} mid={1} />
                </p>
              ),
              rows: (
                <>
                  <ol class="result-list">
                    {SKEL_ADDITIONS.map((shape, i) => (
                      <li class="result" key={i + 1}>
                        <SkelRow rank={i + 1} {...shape} />
                      </li>
                    ))}
                  </ol>
                  {skelMore}
                </>
              ),
            }}
          />
        )
      ) : pending || (result && single) ? (
        <section class="results" aria-busy={working}>
          <h3>Each card on its own</h3>
          <ol class="result-list">
            {result?.singles
              .slice(0, shownSingles)
              .map((s, i) => singleRow(s, i + 1)) ?? skelRows(false)}
          </ol>
          {pending ? (
            skelMore
          ) : !moreSingles && singlesLeft > 0 ? (
            <button
              type="button"
              class="more"
              onClick={() => setMoreSingles(true)}
            >
              Show {singlesLeft} more cards
            </button>
          ) : null}
          {/* Lists in both cases, or Preact can move what follows. */}
          {pending
            ? [
                <p class="muted" key="">
                  <Lines n={2} mid={2} wide={1} />
                </p>,
              ]
            : members.map((m) => (
                <p class="muted" key={m}>
                  {m}
                </p>
              ))}
          {!result
            ? []
            : focus
                .filter(
                  (id) =>
                    !result.singles
                      .slice(0, shownSingles)
                      .some((s) => s.cards[0]?.cardId === id),
                )
                .map((id) => {
                  const rank = result.singles.findIndex(
                    (s) => s.cards[0]?.cardId === id,
                  )
                  const s = result.singles[rank]
                  const member = result.membersOnly.find(
                    (m) => m.cards[0]?.cardId === id,
                  )
                  if (!s && member)
                    return (
                      <Fragment key={id}>
                        <p class="muted">
                          Where the {shortName(id)} ranks on this spending, with{' '}
                          {withArticle(
                            membershipName(catalog, member.membership),
                          )}
                          , which it needs:
                        </p>
                        <ol class="result-list">
                          {singleRow(
                            member,
                            result.singles.filter((x) => byNet(x, member) < 0)
                              .length + 1,
                          )}
                        </ol>
                      </Fragment>
                    )
                  return s ? (
                    <Fragment key={id}>
                      <p class="muted">
                        Where the {shortName(id)} ranks on this spending:
                      </p>
                      <ol class="result-list">{singleRow(s, rank + 1)}</ol>
                    </Fragment>
                  ) : (
                    <p class="muted" key={id}>
                      {catalog.cards.find((c) => c.id === id)?.business
                        ? `${shortName(id)} is a business card: choose Business cards instead in Filters to see it.`
                        : `${shortName(id)} isn't among the cards your Filters compare.`}
                    </p>
                  )
                })}

          {pending || pair ? (
            <>
              <h3>Two cards together</h3>
              {!pending && !pairBetter && single ? (
                <p class="muted">
                  No pair beats the {shortName(single.cards[0]?.cardId ?? '')}{' '}
                  alone.
                </p>
              ) : null}
              <ol class="result-list">
                {result
                  ? result.pairs
                      .slice(0, pairBetter || morePairs ? shownPairs : 0)
                      .map((p, i) => pairRow(p, i + 1))
                  : skelRows(true)}
              </ol>
              {pending ? (
                skelMore
              ) : !morePairs && pairsLeft > 0 ? (
                <button
                  type="button"
                  class="more"
                  onClick={() => setMorePairs(true)}
                >
                  Show {pairsLeft} more pairs
                </button>
              ) : null}
            </>
          ) : null}
          <details class="how">
            <summary>How this is figured</summary>
            <ul class="assumptions">
              <li>
                Rewards minus annual fees over the next 12 months, with caps
                filling and resetting as they would. Each card uses its best
                category picks, with any bonus activations done.
              </li>
              <li>
                Welcome offers pay once, so they don't change the order. A
                card's first-year figure adds its public offer if this spending,
                all on that card, reaches the minimum in time, and uses the
                first year's fee. Pairs leave offers out. {OFFERS_MAY_DIFFER}
              </li>
              <li>{CREDITS_APART}</li>
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </div>
  )
}
