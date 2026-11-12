import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { catalog, dataVersion } from 'virtual:catalog'
import type { Picks } from '../../src/engine/explore.ts'
import { localToday } from '../../src/engine/periods.ts'
import type { Spending } from '../../src/engine/renewal.ts'
import { searchCards } from '../../src/engine/setup.ts'
import {
  resolveSpendLines,
  spendLineFor,
  TYPICAL_MONTHLY_SPEND,
  typicalSpendLines,
  type Addition,
  type ResolvedLine,
} from '../../src/engine/simulate.ts'
import { currencyValuation } from '../../src/engine/valuation.ts'
import {
  assumedPicksText,
  bestText,
  flatText,
  gapText,
  headlineText,
  lineName,
  nextText,
  pairBeats,
  reportNotes,
  reportStart,
  type BestCards,
  type FeeVerdict,
  type Gap,
  type ReportInput,
  type ReportStart,
} from '../../src/engine/wallet-report.ts'
import { optionName } from '../../src/engine/rule-text.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { CardArt } from '../app/CardArt.tsx'
import { cards, feeLabel, shortName, wholeDollars } from '../app/format.ts'
import { QuickCards } from '../app/QuickCards.tsx'
import { loadWallet } from '../app/saved-wallet.ts'
import { SearchInput } from '../app/SearchInput.tsx'
import { track } from '../app/track.ts'
import { Bar } from './Bar.tsx'
import { encodeReport, reportPart, roundedLines } from './link.ts'
import { runReport } from './run.ts'
import type { Job, Part } from './steps.ts'
import { reportSource, savedRows, type Row, type Source } from './source.ts'

// Whether a person's own spending goes in the link unless they untick it.
export const SHARE_SPENDING = true

const GAPS_SHOWN = 3

function readSaved() {
  const raw = (() => {
    try {
      return localStorage.getItem('earnrate:spending')
    } catch {
      return null
    }
  })()
  return { wallet: loadWallet(), rows: savedRows(raw) }
}

const isTypical = (rows: Row[]) =>
  rows.length === TYPICAL_MONTHLY_SPEND.length &&
  TYPICAL_MONTHLY_SPEND.every(
    (t, i) => rows[i]?.what === t.what && rows[i].monthly === t.monthly,
  )

const TYPICAL: Spending = { lines: typicalSpendLines(catalog), typical: true }

// The person's rows as the report counts them: known lines, rounded to $10
// as a link carries them; typical amounts when there are none of their own.
function spendingOf(rows: Row[] | null): Spending {
  if (rows === null || isTypical(rows)) return TYPICAL
  const lines = roundedLines(
    resolveSpendLines(
      catalog,
      rows.map((r) => spendLineFor(catalog, r.what, r.monthly)),
    ),
  )
  return lines.length === 0 ? TYPICAL : { lines, typical: false }
}

// Picks that still name the card's options.
function validPicks(cardId: string, picks: Picks | undefined): Picks {
  const card = cards.get(cardId)
  if (!card || !picks) return {}
  return Object.fromEntries(
    card.choices.flatMap((c) => {
      const chosen = (picks[c.id] ?? [])
        .filter((o) => o in c.options)
        .slice(0, c.pick)
      return chosen.length > 0 ? [[c.id, chosen]] : []
    }),
  )
}

// A saved wallet as a report reads it: cards, picks, memberships and the
// point values it sets, as numbers.
function walletInput(
  wallet: Wallet,
  picks: Record<string, Picks>,
): ReportInput {
  return {
    cards: wallet.cards.map((h) => ({
      id: h.id,
      picks: picks[h.id] ?? validPicks(h.id, h.chosen?.picks),
    })),
    memberships: wallet.memberships.filter((m) =>
      catalog.memberships.some((x) => x.id === m),
    ),
    valuations: Object.fromEntries(
      Object.keys(wallet.valuations)
        .filter((id) => catalog.currencies.some((c) => c.id === id))
        .map((id) => [id, currencyValuation(catalog, wallet, id).centsPerUnit]),
    ),
  }
}

type Parts = {
  best: BestCards | null
  fees: Map<string, FeeVerdict | null>
  next: Addition | null | undefined
  gaps: Gap[] | null
}

const NO_PARTS: Parts = {
  best: null,
  fees: new Map(),
  next: undefined,
  gaps: null,
}

function withPart(was: Parts, p: Part): Parts {
  switch (p.part) {
    case 'best':
      return { ...was, best: p.value }
    case 'fee':
      return { ...was, fees: new Map(was.fees).set(p.cardId, p.value) }
    case 'next':
      return { ...was, next: p.value }
    case 'gaps':
      return { ...was, gaps: p.value }
    default:
      return was
  }
}

// Parts belong to the job that made them, so a change never shows the new
// headline beside the old job's parts.
function useParts(input: ReportInput, spending: Spending, today: string) {
  const job = useMemo(
    () => ({ input, spending, today }),
    [input, spending, today],
  )
  const [state, setState] = useState<{ job: Job | null; parts: Parts }>({
    job: null,
    parts: NO_PARTS,
  })
  useEffect(() => {
    setState({ job, parts: NO_PARTS })
    if (job.input.cards.length === 0) return
    return runReport(catalog, job, (p) => {
      setState((was) =>
        was.job === job ? { job, parts: withPart(was.parts, p) } : was,
      )
    })
  }, [job])
  return state.job === job ? state.parts : NO_PARTS
}

// Your cards, the best two, and the one flat-rate card, on one scale.
function Comparison({
  start,
  best,
}: {
  start: ReportStart
  best: BestCards | null
}) {
  const one = start.cards.length === 1
  const top = best === null ? null : pairBeats(best) ? best.pair : best.single
  const rows = [
    {
      label: one ? shortName(start.cards[0]?.cardId ?? '') : 'Your cards',
      value: start.net as number | null,
      mine: true,
    },
    {
      label:
        top === null
          ? 'The best two cards'
          : top.cards.length === 2
            ? `Best two: ${top.cards.map((c) => shortName(c.cardId)).join(' + ')}`
            : `Best one: ${shortName(top.cards[0]?.cardId ?? '')}`,
      value: top?.net ?? null,
      mine: false,
    },
    ...(start.flat === null
      ? []
      : [
          {
            label: `${shortName(start.flat.cardId)} alone`,
            value: start.flat.net as number | null,
            mine: false,
          },
        ]),
  ]
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0))
  return (
    <div class="rate-compare" role="list">
      {rows.map((r) => (
        <div class="rate-row" role="listitem" key={r.label}>
          <span class="rate-label">{r.label}</span>
          {r.value === null ? (
            <span class="rate-wait muted">Working it out…</span>
          ) : (
            <>
              <Bar value={r.value} max={max} quiet={!r.mine} />
              <span class="rate-amount">{wholeDollars(r.value)}</span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

function FeeCards({
  input,
  fees,
}: {
  input: ReportInput
  fees: Map<string, FeeVerdict | null>
}) {
  const ids = input.cards
    .map((c) => c.id)
    .filter((id) => (cards.get(id)?.annual_fee ?? 0) > 0)
  if (ids.length === 0) return null
  return (
    <section class="rate-part">
      <h2>{ids.length === 1 ? 'Your fee card' : 'Your fee cards'}</h2>
      <ul class="rate-fees">
        {ids.map((id) => {
          const v = fees.get(id)
          return (
            <li key={id}>
              <div class="rate-fee-head">
                <CardArt id={id} width={40} />
                <span>
                  <strong>{shortName(id)}</strong>
                  <span class="muted small"> · {feeLabel(id)}</span>
                </span>
                {v ? (
                  <span class={v.paysForItself ? 'tag' : 'tag warn'}>
                    {v.paysForItself
                      ? 'Pays for itself'
                      : "Doesn't pay for itself"}
                  </span>
                ) : null}
              </div>
              {v === undefined ? (
                <p class="muted">Working it out…</p>
              ) : v === null ? null : (
                <>
                  <p>{v.verdict}</p>
                  {v.credits === '' ? null : (
                    <p class="muted small">{v.credits}</p>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Gaps({ start, gaps }: { start: ReportStart; gaps: Gap[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? gaps : gaps.slice(0, GAPS_SHOWN)
  return (
    <section class="rate-part">
      <h2>Where another card earns more</h2>
      {gaps.length === 0 ? (
        <p>
          On every line of this spending, your cards earn close to the best card
          earnrate knows for it.
        </p>
      ) : (
        <>
          <ul class="rate-gaps">
            {shown.map((g) => (
              <li key={g.label}>
                <CardArt id={g.bestCardId} width={32} />
                <span>{gapText(catalog, start, g)}</span>
              </li>
            ))}
          </ul>
          {gaps.length > GAPS_SHOWN ? (
            <button type="button" class="link" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${String(gaps.length)}`}
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}

// The report itself: the same for your own cards and a shared link.
function Report({
  start,
  input,
  parts,
  share,
  editors,
}: {
  start: ReportStart
  input: ReportInput
  parts: Parts
  share: ComponentChildren
  editors: ComponentChildren
}) {
  const { best, fees, next, gaps } = parts
  const lead = [
    flatText(catalog, start),
    best ? bestText(catalog, start, best) : '',
  ]
    .filter((t) => t !== '')
    .join(' ')
  return (
    <div class="rate-report" aria-live="polite">
      <ul class="rate-cards" aria-label="The cards rated">
        {start.cards.map((c) => (
          <li key={c.cardId}>
            <CardArt id={c.cardId} width={44} />
            <span class="rate-card-name">{shortName(c.cardId)}</span>
          </li>
        ))}
      </ul>
      <p class="rate-figure">
        {wholeDollars(start.net)}
        <span class="rate-per"> a year after fees</span>
      </p>
      <p class="rate-lead">{headlineText(catalog, start)}</p>
      <Comparison start={start} best={best} />
      <p>{lead}</p>
      {editors}
      {share}
      <FeeCards input={input} fees={fees} />
      <section class="rate-part">
        <h2>A card to add</h2>
        {next === undefined ? (
          <p class="muted">Working it out…</p>
        ) : (
          <>
            <p>{nextText(catalog, next)}</p>
            {next ? (
              <p>
                <a href={`/cards/${next.cardId}`}>
                  See the {shortName(next.cardId)}
                </a>
              </p>
            ) : null}
          </>
        )}
      </section>
      {gaps === null ? (
        <section class="rate-part">
          <h2>Where another card earns more</h2>
          <p class="muted">Working it out…</p>
        </section>
      ) : (
        <Gaps start={start} gaps={gaps} />
      )}
      <details class="filters rate-notes">
        <summary>What this assumes</summary>
        <ul class="assumptions">
          {reportNotes(catalog, start, dataVersion).map((n) => (
            <li key={n}>{n}</li>
          ))}
          {start.lines.length > 0 ? (
            <li>
              Spending used, a month:{' '}
              {start.lines
                .map(
                  (l) =>
                    `${lineName(catalog, l.label)} ${wholeDollars(l.monthly)}`,
                )
                .join(', ')}
              .
            </li>
          ) : null}
        </ul>
      </details>
    </div>
  )
}

function SpendingEditor({
  rows,
  setRows,
  start,
}: {
  rows: Row[]
  setRows: (rows: Row[]) => void
  start: ReportStart
}) {
  const [adding, setAdding] = useState('')
  return (
    <details class="filters spend-edit">
      <summary>
        <span class="basis">
          {start.typical
            ? `On typical U.S. spending, about ${wholeDollars(start.monthly)} a month.`
            : `On your spending, ${wholeDollars(start.monthly)} a month.`}
        </span>{' '}
        Change it
      </summary>
      <div class="panel">
        <p class="muted small">
          Roughly what you spend each month. Changes here stay on this page;
          Find a card keeps its own amounts.
        </p>
        <ul class="spend">
          {rows.map((r, i) => (
            <li key={r.what}>
              <span>{r.what}</span>
              <span class="dollar">
                $
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="10"
                  aria-label={`${r.what}, dollars a month`}
                  value={r.monthly}
                  onInput={(e) =>
                    setRows(
                      rows.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              monthly: Math.max(
                                0,
                                Number(e.currentTarget.value) || 0,
                              ),
                            }
                          : x,
                      ),
                    )
                  }
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
            const what = adding.trim()
            if (what === '' || rows.some((r) => r.what === what)) return
            setRows([...rows, { what, monthly: 100 }])
            setAdding('')
          }}
        >
          <input
            type="text"
            aria-label="Add a store or category"
            placeholder="Add a store or category"
            autocomplete="off"
            value={adding}
            onInput={(e) => setAdding(e.currentTarget.value)}
          />
          <button type="submit">Add</button>
        </form>
      </div>
    </details>
  )
}

// A select for each choice that takes one pick, boxes for one that takes
// more. Unpicked, the report uses the best picks for the spending.
function PicksEditor({
  start,
  picks,
  setPicks,
}: {
  start: ReportStart
  picks: Record<string, Picks>
  setPicks: (p: Record<string, Picks>) => void
}) {
  const withChoices = start.cards.filter(
    (c) => (cards.get(c.cardId)?.choices.length ?? 0) > 0,
  )
  if (withChoices.length === 0) return null
  const assumed = assumedPicksText(catalog, start)
  return (
    <details class="filters">
      <summary>Category picks</summary>
      <div class="panel rate-picks">
        {assumed === '' ? null : <p class="muted small">{assumed}</p>}
        {withChoices.map((c) => {
          const card = cards.get(c.cardId)
          if (!card) return null
          return card.choices.map((choice) => {
            const chosen = c.picks[choice.id] ?? []
            const set = (next: string[]) =>
              setPicks({
                ...picks,
                [c.cardId]: { ...c.picks, [choice.id]: next },
              })
            const name = (o: string) => optionName(catalog, card, choice.id, o)
            return choice.pick === 1 ? (
              <label class="field" key={`${c.cardId}/${choice.id}`}>
                {shortName(c.cardId)}
                <select
                  value={chosen[0] ?? ''}
                  onChange={(e) => set([e.currentTarget.value])}
                >
                  {Object.keys(choice.options).map((o) => (
                    <option value={o} key={o}>
                      {name(o)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <fieldset class="field" key={`${c.cardId}/${choice.id}`}>
                <legend>
                  {shortName(c.cardId)}, {String(choice.pick)} picks
                </legend>
                {Object.keys(choice.options).map((o) => (
                  <label class="check" key={o}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(o)}
                      disabled={
                        !chosen.includes(o) && chosen.length >= choice.pick
                      }
                      onChange={(e) =>
                        set(
                          e.currentTarget.checked
                            ? [...chosen, o]
                            : chosen.filter((x) => x !== o),
                        )
                      }
                    />
                    {name(o)}
                  </label>
                ))}
              </fieldset>
            )
          })
        })}
      </div>
    </details>
  )
}

function ShareBox({
  input,
  spending,
  ownSpending,
  include,
  setInclude,
}: {
  input: ReportInput
  spending: Spending
  ownSpending: boolean
  include: boolean
  setInclude: (on: boolean) => void
}) {
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  const url = `${location.origin}/rate#${encodeReport(catalog, {
    input,
    lines: spending.typical ? null : spending.lines,
  })}`
  const items = [
    input.cards.length === 1 ? 'Your card' : 'Your cards',
    ...(input.cards.some((c) => Object.keys(c.picks).length > 0)
      ? ['Your category picks']
      : []),
    ...(input.memberships.length > 0 ? ['Your memberships'] : []),
    ...(Object.keys(input.valuations).length > 0
      ? ['The point values you set']
      : []),
    ...(spending.typical ? [] : ['Your monthly spending, rounded to $10']),
  ]
  const canShare = typeof navigator.share === 'function'
  return (
    <section class="panel rate-share" aria-labelledby="rate-share-title">
      <h2 id="rate-share-title">Share this report</h2>
      <div class="row-buttons">
        <button
          type="button"
          class="primary"
          onClick={() => {
            const clipboard = navigator.clipboard as Clipboard | undefined
            if (!clipboard) {
              setShown(url)
              return
            }
            clipboard.writeText(url).then(
              () => {
                track('report-made')
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              },
              () => setShown(url),
            )
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {canShare ? (
          <button
            type="button"
            onClick={() => {
              navigator
                .share({ url, title: 'My cards, rated on earnrate' })
                .then(
                  () => track('report-made'),
                  () => undefined,
                )
            }}
          >
            Share
          </button>
        ) : null}
      </div>
      {shown === null ? null : (
        <input
          class="rate-url"
          type="text"
          readOnly
          aria-label="The link"
          value={shown}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      <p class="small">The link holds:</p>
      <ul class="small rate-holds">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      {ownSpending ? (
        <label class="check small">
          <input
            type="checkbox"
            checked={include}
            onChange={(e) => setInclude(e.currentTarget.checked)}
          />
          Put my monthly spending in the link. Without it, the report above uses
          typical spending, as the link would.
        </label>
      ) : null}
      <p class="small muted">
        It's all in the part of the address after the #, which browsers don't
        send to any server, so earnrate never receives it. Whoever opens the
        link sees this report, worked out in their own browser.
      </p>
    </section>
  )
}

// Your own cards, or ones tapped in: editable on the page, never saved.
function Rated({
  initial,
  rows: savedRows,
  saveCards,
}: {
  initial: ReportInput
  rows: Row[] | null
  saveCards: boolean
}) {
  const today = useMemo(() => localToday(), [])
  const [rows, setRows] = useState<Row[]>(
    () => savedRows ?? TYPICAL_MONTHLY_SPEND.map((t) => ({ ...t })),
  )
  const [picks, setPicks] = useState<Record<string, Picks>>({})
  const [include, setInclude] = useState(SHARE_SPENDING)
  const own = useMemo(() => spendingOf(rows), [rows])
  const spending = include ? own : TYPICAL
  const input = useMemo(
    () => ({
      ...initial,
      cards: initial.cards.map((c) => ({
        id: c.id,
        picks: picks[c.id] ?? c.picks,
      })),
    }),
    [initial, picks],
  )
  const start = useMemo(
    () => reportStart(catalog, input, today, spending),
    [input, spending, today],
  )
  // The link carries the picks the report used, assumed ones included, so
  // whoever opens it gets the same figures.
  const linked = useMemo(
    () => ({
      ...input,
      cards: start.cards.map((c) => ({ id: c.cardId, picks: c.picks })),
    }),
    [input, start],
  )
  const parts = useParts(linked, spending, today)
  return (
    <>
      <Report
        start={start}
        input={linked}
        parts={parts}
        editors={
          <>
            <SpendingEditor rows={rows} setRows={setRows} start={start} />
            <PicksEditor
              start={start}
              picks={picks}
              setPicks={(p) => setPicks(p)}
            />
          </>
        }
        share={
          <ShareBox
            input={linked}
            spending={spending}
            ownSpending={!own.typical}
            include={include}
            setInclude={setInclude}
          />
        }
      />
      {saveCards ? (
        <p class="rate-save">
          <a
            class="button"
            href={`/#wallet&${input.cards.map((c) => `add=${c.id}`).join('&')}`}
          >
            Save these cards to My wallet
          </a>
        </p>
      ) : null}
    </>
  )
}

function Shared({
  input,
  lines,
}: {
  input: ReportInput
  lines: ResolvedLine[] | null
}) {
  const today = useMemo(() => localToday(), [])
  const spending = useMemo(
    (): Spending => (lines === null ? TYPICAL : { lines, typical: false }),
    [lines],
  )
  const start = useMemo(
    () => reportStart(catalog, input, today, spending),
    [input, spending, today],
  )
  const parts = useParts(input, spending, today)
  return (
    <Report
      start={start}
      input={input}
      parts={parts}
      share={null}
      editors={null}
    />
  )
}

function RateYourOwn() {
  return (
    <section class="panel rate-own">
      <h2>Rate your own cards</h2>
      <p>
        Tap the cards you have and earnrate rates them the same way. No account,
        and your cards stay in your browser.
      </p>
      <a class="button" href="/rate">
        Rate my cards
      </a>
    </section>
  )
}

function CardFinder({
  picked,
  onAdd,
}: {
  picked: string[]
  onAdd: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const wallet: Wallet = {
    valuations: {},
    memberships: [],
    cards: picked.map((id) => ({ id, cap_usage: {}, activated: [] })),
  }
  const found =
    query.trim().length < 2
      ? []
      : searchCards(catalog, query, wallet, localToday()).cards.slice(0, 6)
  return (
    <div>
      <p class="quick-search-lead">
        Not here? Find any of the {catalog.cards.length} cards earnrate knows.
      </p>
      <SearchInput
        class="search"
        type="search"
        aria-label="Find a card"
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
              <span>{shortName(c.id)}</span>
            </span>
            {c.held ? (
              <span class="muted">Added</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onAdd(c.id)
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

// No saved wallet: tap cards in, held only on this page.
function Pick({ rows }: { rows: Row[] | null }) {
  const [picked, setPicked] = useState<string[]>([])
  const [rating, setRating] = useState(false)
  const input = useMemo(
    (): ReportInput => ({
      cards: picked.map((id) => ({ id, picks: {} })),
      memberships: [],
      valuations: {},
    }),
    [picked],
  )
  const count = picked.length
  if (rating && count > 0)
    return (
      <>
        <p class="rate-change">
          <button type="button" class="link" onClick={() => setRating(false)}>
            Change cards
          </button>
        </p>
        <Rated initial={input} rows={rows} saveCards />
      </>
    )
  const wallet: Wallet = {
    valuations: {},
    memberships: [],
    cards: picked.map((id) => ({ id, cap_usage: {}, activated: [] })),
  }
  return (
    <section class="panel first rate-pick">
      <h2>Which cards do you have?</h2>
      <p>
        Tap the ones you have. earnrate works out what they earn in a year after
        their fees, and compares that with one flat-rate card and with the best
        two cards for the same spending.
      </p>
      <QuickCards
        wallet={wallet}
        added={picked}
        onAdd={(id) => setPicked((p) => (p.includes(id) ? p : [...p, id]))}
        onRemove={(id) => setPicked((p) => p.filter((x) => x !== id))}
      />
      <CardFinder
        picked={picked}
        onAdd={(id) => setPicked((p) => (p.includes(id) ? p : [...p, id]))}
      />
      {count > 0 ? (
        <div class="quick-done">
          <span>
            {count} card{count === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            class="primary"
            onClick={() => {
              setRating(true)
              requestAnimationFrame(() => scrollTo({ top: 0 }))
            }}
          >
            Rate {count === 1 ? 'it' : 'them'}
          </button>
        </div>
      ) : null}
    </section>
  )
}

const SHARED_TITLE = 'A shared wallet · earnrate'

export function Rate() {
  const [source, setSource] = useState<Source>(() =>
    reportSource(catalog, location.hash, readSaved),
  )
  const ownInput = useMemo(
    () => (source.kind === 'own' ? walletInput(source.wallet, {}) : null),
    [source],
  )
  useEffect(() => {
    if (reportPart(location.hash) !== null) track('report-opened')
    const onHash = () => {
      const next = reportSource(catalog, location.hash, readSaved)
      if (next.kind === 'shared' || next.kind === 'bad') track('report-opened')
      setSource(next)
      scrollTo({ top: 0 })
    }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  const shared = source.kind === 'shared' || source.kind === 'bad'
  useEffect(() => {
    if (shared) document.title = SHARED_TITLE
  }, [shared])

  if (source.kind === 'bad')
    return (
      <>
        <h1>A shared wallet</h1>
        <p class="callout">{source.message}</p>
        <RateYourOwn />
      </>
    )
  if (source.kind === 'shared')
    return (
      <>
        <h1>A shared wallet</h1>
        <p class="lede">
          Someone shared this report on their cards, so it's written to them.
          Your browser worked it out from the link alone: earnrate's server
          never saw it, and nothing saved in this browser was read or changed.
        </p>
        <Shared
          key={location.hash}
          input={source.link.input}
          lines={source.link.lines}
        />
        <RateYourOwn />
      </>
    )
  return (
    <>
      <h1>Rate my wallet</h1>
      {ownInput ? (
        <>
          <p class="lede">
            The cards saved in My wallet. Nothing on this page changes them.
          </p>
          <Rated
            initial={ownInput}
            rows={source.kind === 'own' ? source.rows : null}
            saveCards={false}
          />
        </>
      ) : (
        <Pick rows={source.kind === 'pick' ? source.rows : null} />
      )}
    </>
  )
}
