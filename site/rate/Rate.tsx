import { render, type ComponentChildren } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { catalog, dataVersion } from 'virtual:catalog'
import type { Picks } from '../../src/engine/explore.ts'
import { localToday } from '../../src/engine/periods.ts'
import type { Spending } from '../../src/engine/renewal.ts'
import { searchCards } from '../../src/engine/setup.ts'
import {
  nothingCounted,
  TYPICAL_MONTHLY_SPEND,
  typicalSpendLines,
  type Addition,
  type ResolvedLine,
} from '../../src/engine/simulate.ts'
import {
  assumedPicksText,
  bestNote,
  breakdownText,
  cardShares,
  feeCardBadge,
  feeCardCreditsShort,
  feeCardKeepShort,
  shareCreditsShort,
  flatNote,
  gapText,
  lineName,
  nextText,
  pairBeats,
  reportNotes,
  reportStart,
  type BestCards,
  type CardShare,
  type FeeVerdict,
  type Gap,
  type ReportInput,
  type ReportStart,
} from '../../src/engine/wallet-report.ts'
import { optionName } from '../../src/engine/rule-text.ts'
import { listed, type Voice } from '../../src/engine/text.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { CardArt } from '../app/CardArt.tsx'
import { CreditPicks } from '../app/CreditPicks.tsx'
import {
  cards,
  feeLabel,
  shortestName,
  shortName,
  wholeDollars,
} from '../app/format.ts'
import { QuickCards } from '../app/QuickCards.tsx'
import { loadWallet } from '../app/saved-wallet.ts'
import { SearchInput } from '../app/SearchInput.tsx'
import { myLink, startMyLink } from '../app/my-link.ts'
import type { LinkState, LinkUpdater } from '../app/report-link.ts'
import { sameRows } from '../app/spending-rows.ts'
import { track } from '../app/track.ts'
import {
  addCard,
  answeredMarks,
  answerSaver,
  heldMarks,
  removeCard,
  sameMarks,
  type Marks,
  type SaveResult,
  type Saver,
} from './answers.ts'
import { Bar } from './Bar.tsx'
import { decodeReport, encodeReport, reportPart } from './link.ts'
import { OWN_WALLET, pullSynced, storageChanged } from './own-wallet.ts'
import { spendingLines, walletReportInput } from './own-report.ts'
import {
  comparisonRows,
  countedNote,
  perYear,
  ratePictureText,
  upToText,
  type CompareRow,
  type RatePicture,
} from './picture-text.ts'
import { countedText, shareFigures } from './fee-figures.ts'
import { SaveImage } from './SaveImage.tsx'
import { runReport } from './run.ts'
import { DELETED, notMade, ownLink, pickLink, UNDELETED } from './share.ts'
import {
  loadReport,
  newLink,
  shortUrl,
  storedId,
  type Saved,
  type Written,
} from './store.ts'
import type { Job, Part } from './steps.ts'
import {
  reportSource,
  savedRows,
  storedSource,
  type Row,
  type Source,
} from './source.ts'

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

const TYPICAL: Spending = { lines: typicalSpendLines(catalog), typical: true }

// The person's rows as the report counts them: known lines at the amounts
// given (a link rounds them to $5); typical amounts when there are none of
// their own.
function spendingOf(rows: Row[] | null): Spending {
  const lines = spendingLines(catalog, rows)
  return lines === null ? TYPICAL : { lines, typical: false }
}

type ReportCard = ReportInput['cards'][number]

const NO_MARKS: Marks = { used: [], skipped: [] }

const withMarks = (c: ReportCard, m: Marks | undefined): ReportCard => ({
  id: c.id,
  picks: c.picks,
  ...(m && m.used.length > 0 ? { used: m.used } : {}),
  ...(m && m.skipped.length > 0 ? { skipped: m.skipped } : {}),
})

const marksOf = (input: ReportInput): Record<string, Marks> =>
  Object.fromEntries(
    input.cards.map((c) => [
      c.id,
      { used: c.used ?? [], skipped: c.skipped ?? [] },
    ]),
  )

// Credit answers change the report at once. Each tap or All / None is one
// change: the card's whole used and not-used lists. With a saver (the
// visitor's own wallet) it's saved too, and then shows what was saved: a
// refusal puts the card's answers back as they are in My wallet. When the
// wallet changes elsewhere (My wallet in another tab, or Claude), its
// answers replace the page's, except on a card whose answer is still saving.
function useAnswers(initial: ReportInput, save: Saver | null) {
  const [marks, setMarks] = useState<Record<string, Marks>>(() =>
    marksOf(initial),
  )
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(marks)
  const turns = useRef(new Map<string, number>())
  const saving = useRef(new Map<string, number>())
  const put = (cardId: string, m: Marks) => {
    latest.current = { ...latest.current, [cardId]: m }
    setMarks(latest.current)
  }
  useEffect(() => {
    const now = latest.current
    const next = Object.fromEntries(
      Object.entries(marksOf(initial)).map(([id, m]) => [
        id,
        (saving.current.get(id) ?? 0) > 0 ? (now[id] ?? m) : m,
      ]),
    )
    const same =
      Object.keys(next).length === Object.keys(now).length &&
      Object.entries(next).every(([id, m]) => {
        const was = now[id]
        return was !== undefined && sameMarks(was, m)
      })
    if (same) return
    latest.current = next
    setMarks(next)
  }, [initial])
  const set = (cardId: string, ids: string[], used: string[]) => {
    const was = latest.current[cardId] ?? NO_MARKS
    const next = answeredMarks(was, ids, used)
    setError(null)
    if (sameMarks(was, next)) return
    put(cardId, next)
    if (!save) return
    const turn = (turns.current.get(cardId) ?? 0) + 1
    turns.current.set(cardId, turn)
    saving.current.set(cardId, (saving.current.get(cardId) ?? 0) + 1)
    void save(cardId, next).then((result) => {
      saving.current.set(cardId, (saving.current.get(cardId) ?? 1) - 1)
      if (turns.current.get(cardId) !== turn) return
      if (!result.ok) setError(result.error)
      const held = result.wallet?.cards.find((c) => c.id === cardId)
      const card = cards.get(cardId)
      if (!held || !card) return
      const saved = heldMarks(card, held)
      const now = latest.current[cardId] ?? NO_MARKS
      if (!sameMarks(saved, now)) put(cardId, saved)
    })
  }
  return { marks, set, error }
}

const applyMarks = (
  input: ReportInput,
  marks: Record<string, Marks>,
): ReportInput => ({
  ...input,
  cards: input.cards.map((c) =>
    withMarks(
      c,
      marks[c.id] ?? { used: c.used ?? [], skipped: c.skipped ?? [] },
    ),
  ),
})

type Parts = {
  best: BestCards | null
  // The report start the best cards were worked out with, so the comparison
  // shows one result at a time.
  bestStart: ReportStart | null
  fees: Map<string, FeeVerdict | null>
  next: Addition | null | undefined
  gaps: Gap[] | null
}

const NO_PARTS: Parts = {
  best: null,
  bestStart: null,
  fees: new Map(),
  next: undefined,
  gaps: null,
}

function withPart(was: Parts, p: Part, start: ReportStart): Parts {
  switch (p.part) {
    case 'best':
      return { ...was, best: p.value, bestStart: start }
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

const partKey = (p: Part) => (p.part === 'fee' ? `fee:${p.cardId}` : p.part)

// Which parts the current job has sent; 'done' once it has sent them all.
type Fresh = ReadonlySet<string>

const NOTHING_FRESH: Fresh = new Set()

type Busy = (key: string) => boolean

// Each part stays exactly as the last job left it until the new job sends
// its own, which then swaps in: nothing dims, clears or moves meanwhile, and
// a job a newer change overtook is stopped and its parts dropped. Busy only
// sets aria-busy. A part no job has sent yet is undefined or null, and its
// section holds a placeholder the size of the answer.
function useParts(
  input: ReportInput,
  spending: Spending,
  today: string,
  start: ReportStart,
  voice: Voice,
) {
  const job = useMemo(
    () => ({ input, spending, today, voice }),
    [input, spending, today, voice],
  )
  const startNow = useRef(start)
  startNow.current = start
  const [state, setState] = useState<{
    job: Job | null
    parts: Parts
    fresh: Fresh
  }>({ job: null, parts: NO_PARTS, fresh: NOTHING_FRESH })
  useEffect(() => {
    const jobStart = startNow.current
    setState((was) => ({ job, parts: was.parts, fresh: NOTHING_FRESH }))
    if (job.input.cards.length === 0) return
    return runReport(catalog, job, (p) => {
      setState((was) =>
        was.job === job
          ? {
              job,
              parts: withPart(was.parts, p, jobStart),
              fresh: new Set(was.fresh).add(partKey(p)),
            }
          : was,
      )
    })
  }, [job])
  const fresh = state.job === job ? state.fresh : NOTHING_FRESH
  const busy: Busy = (key) => !fresh.has('done') && !fresh.has(key)
  return { parts: state.parts, busy }
}

// An amount keeps its sign on its own line: "−$1,716", never "−" then
// "$1,716".
const AMOUNT = /([−+-]?\$[\d,]+(?:\.\d+)?)/

function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(AMOUNT).map((t, i) =>
        i % 2 === 1 ? (
          <span class="nowrap" key={i}>
            {t}
          </span>
        ) : (
          t
        ),
      )}
    </>
  )
}

// Stand-ins for text still being worked out, a line each, so the answer
// takes about the room they held.
function Lines({ n }: { n: number }) {
  return (
    <p class="rate-skel" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i}>{'\u00a0'}</span>
      ))}
    </p>
  )
}

// Your cards, the best two, and the best no-fee card with one rate, on one
// scale, each with a line on what it is.
function Comparison({
  start,
  best,
  busy,
  voice,
}: {
  start: ReportStart
  best: BestCards | null
  busy: boolean
  voice: Voice
}) {
  const [mine, , flat] = comparisonRows(start, best, shortName, voice)
  const top = best === null ? null : pairBeats(best) ? best.pair : best.single
  const rows: (CompareRow & { key: string; note: string | null })[] = [
    ...(mine ? [{ ...mine, key: 'mine', note: '' }] : []),
    {
      key: 'best',
      label: top?.cards.length === 1 ? 'Best one card' : 'Best two cards',
      value: top?.net ?? null,
      mine: false,
      note: best === null ? null : bestNote(catalog, start, best),
    },
    ...(flat ? [{ ...flat, key: 'flat', note: flatNote(start) }] : []),
  ]
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0))
  return (
    <section class="panel rate-part" aria-busy={busy}>
      <h2>Next to other cards</h2>
      <div class="rate-compare" role="list">
        {rows.map((r) => (
          <div class="rate-row" role="listitem" key={r.key}>
            <span class="rate-label">{r.label}</span>
            {r.value === null ? (
              <>
                <Bar value={0} max={0} />
                <span class="rate-amount rate-skel-amount" aria-hidden="true">
                  {'\u00a0'}
                </span>
              </>
            ) : (
              <>
                <Bar value={r.value} max={max} quiet={!r.mine} />
                <span class="rate-amount">
                  <Words text={wholeDollars(r.value)} />
                </span>
              </>
            )}
            {r.note === null ? (
              <div class="rate-note">
                <Lines n={3} />
              </div>
            ) : r.note === '' ? null : (
              <p class="rate-note muted small">{r.note}</p>
            )}
          </div>
        ))}
      </div>
      {start.counted.length === 0 && start.creditChoices.length === 0 ? null : (
        <p class="muted small">{countedNote(voice)}</p>
      )}
    </section>
  )
}

// Each card's part of the figure at the top: a card with a fee as what it
// earns here, its fee and what it nets, with whether it earns its place;
// one without as what it earns; then the total, which is the figure. The
// figures show at once, from the report's start; the verdicts follow.
function FeeCards({
  start,
  fees,
  busy,
  voice,
}: {
  start: ReportStart
  fees: Map<string, FeeVerdict | null>
  busy: Busy
  voice: Voice
}) {
  const shares = useMemo(() => cardShares(catalog, start), [start])
  const withFee = shares.filter(
    (s) => (cards.get(s.cardId)?.annual_fee ?? 0) > 0,
  )
  if (withFee.length === 0) return null
  const noFee = shares.filter((s) => !withFee.includes(s))
  return (
    <section
      class="panel rate-part"
      aria-busy={withFee.some((s) => busy(`fee:${s.cardId}`))}
    >
      <h2>
        {shares.length === 1
          ? 'Card with an annual fee'
          : 'What each card nets'}
      </h2>
      <ul class="rate-fees">
        {withFee.map((s) => {
          const id = s.cardId
          const v = fees.get(id)
          return (
            <li key={id} aria-busy={busy(`fee:${id}`)}>
              <div class="rate-fee-head">
                <CardArt id={id} width={40} />
                <span>
                  <strong>{shortName(id)}</strong>
                  <span class="muted small">
                    {' · '}
                    {feeLabel(id).replace(/ a year/g, ' a year')}
                  </span>
                </span>
                {v ? (
                  <span
                    class="tag"
                    data-tone={v.paysForItself ? undefined : 'warn'}
                  >
                    {feeCardBadge(v)}
                  </span>
                ) : v === undefined ? (
                  <span class="tag rate-skel-tag" aria-hidden="true">
                    Doesn't pay for itself
                  </span>
                ) : null}
              </div>
              <FeeLines share={s} start={start} v={v} voice={voice} />
            </li>
          )
        })}
        {noFee.map((s) => (
          <li class="rate-fee-plain" key={s.cardId}>
            <CardArt id={s.cardId} width={40} />
            <span>
              <strong>{shortName(s.cardId)}</strong>
              <span class="muted small"> · No annual fee</span>
            </span>
            <span class="rate-fee-amount">
              <span class="muted small">Earns </span>
              <Words text={wholeDollars(s.net)} />
            </span>
          </li>
        ))}
      </ul>
      {shares.length > 1 ? (
        <p class="rate-fee-total">
          <span>
            {voice === 'you' ? 'Your' : 'The'} {String(shares.length)} cards
            together
          </span>
          <strong>
            <Words text={wholeDollars(shares.reduce((n, s) => n + s.net, 0))} />
          </strong>
        </p>
      ) : null}
    </section>
  )
}

// Earns, less its fee, nets; then keep or swap in a sentence, the credits
// counted, and what the ones not answered would make it.
function FeeLines({
  share,
  start,
  v,
  voice,
}: {
  share: CardShare
  start: ReportStart
  v: FeeVerdict | null | undefined
  voice: Voice
}) {
  const counted = start.counted.find((c) => c.cardId === share.cardId)
  const unsaid = start.credits.find((c) => c.cardId === share.cardId)
  const notes = [
    countedText(counted?.names ?? []),
    shareCreditsShort(share, unsaid),
    v && v.unsaid.yearly <= 0 ? feeCardCreditsShort(v, voice) : '',
  ].filter((t) => t !== '')
  return (
    <>
      <dl class="rate-fee-figures">
        {shareFigures(share).map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>
              <Words text={f.value} />
            </dd>
          </div>
        ))}
      </dl>
      {v === undefined ? (
        <Lines n={2} />
      ) : v === null ? null : (
        <p>
          <Words text={feeCardKeepShort(catalog, share, v, voice)} />
        </p>
      )}
      {notes.length === 0 ? null : (
        <p class="muted small">
          <Words text={notes.join(' ')} />
        </p>
      )}
    </>
  )
}

function Next({
  next,
  busy,
}: {
  next: Addition | null | undefined
  busy: boolean
}) {
  return (
    <section class="panel rate-part" aria-busy={busy}>
      <h2>A card to add</h2>
      {next === undefined ? (
        <>
          <Lines n={3} />
          <Lines n={1} />
        </>
      ) : (
        <>
          <p>
            <Words text={nextText(catalog, next)} />
          </p>
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
  )
}

function Gaps({
  gaps,
  busy,
  voice,
}: {
  gaps: Gap[] | null
  busy: boolean
  voice: Voice
}) {
  const [all, setAll] = useState(false)
  return (
    <section class="panel rate-part" aria-busy={busy}>
      <h2>Where another card earns more</h2>
      {gaps === null ? (
        <>
          <ul class="rate-gaps" aria-hidden="true">
            {Array.from({ length: GAPS_SHOWN }, (_, i) => (
              <li key={i}>
                <span class="rate-skel-art" />
                <Lines n={4} />
              </li>
            ))}
          </ul>
          <Lines n={1} />
        </>
      ) : gaps.length === 0 ? (
        <p>
          On every line of this spending, {voice === 'you' ? 'your' : 'these'}{' '}
          cards earn close to the best card earnrate knows for it.
        </p>
      ) : (
        <>
          <ul class="rate-gaps">
            {(all ? gaps : gaps.slice(0, GAPS_SHOWN)).map((g) => (
              <li key={g.label}>
                <CardArt id={g.bestCardId} width={32} />
                <span>
                  <Words text={gapText(catalog, g, voice)} />
                </span>
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

// "On typical U.S. spending, about $1,990 a month."
const basisText = (start: ReportStart, voice: Voice = 'you') =>
  start.typical
    ? `On typical U.S. spending, about ${wholeDollars(start.monthly)} a month.`
    : voice === 'you'
      ? `On your spending, ${wholeDollars(start.monthly)} a month.`
      : `On spending of ${wholeDollars(start.monthly)} a month.`

// The longer line under the figure keeps its room whichever one shows,
// and the line on unanswered credits keeps its room once they're all
// answered, so answering a credit never moves the page under the tap.
const NONE_COUNTED = { counted: [] }
const ONE_COUNTED = { counted: [null] }

// The report itself: the same for your own cards and a shared link. The
// figure, the cards it's for and what makes it up, then a panel each for the
// credits, the comparison, sharing and the slower parts. What it assumes
// goes in the page's own "How this is worked out" section.
function Report({
  start,
  parts,
  busy,
  share,
  closing,
  editors,
  answers,
  voice,
  nothing = null,
}: {
  start: ReportStart
  parts: Parts
  busy: Busy
  share: ComponentChildren
  closing?: ComponentChildren
  editors: ComponentChildren
  answers: ComponentChildren
  voice: Voice
  // Why there's nothing to rate: the only spending is a kind no card is
  // ranked on, like rent.
  nothing?: string | null
}) {
  const { best, bestStart, fees, next, gaps } = parts
  const assumes = useMemo(
    () => document.querySelector('[data-rate-assumes]'),
    [],
  )
  const choices = start.creditChoices.length > 0
  const upTo = upToText(start, voice)
  if (nothing)
    return (
      <div class="rate-report">
        <p class="callout">{nothing}</p>
        {editors}
      </div>
    )
  return (
    <div class="rate-report" aria-live="polite">
      <p class="rate-figure">
        <Words text={wholeDollars(start.net)} />
        <span class="rate-per">
          <span>{perYear(start, voice)}</span>
          {choices ? (
            <>
              <span class="rate-per-room" aria-hidden="true">
                {perYear(NONE_COUNTED, voice)}
              </span>
              <span class="rate-per-room" aria-hidden="true">
                {perYear(ONE_COUNTED, voice)}
              </span>
            </>
          ) : null}
        </span>
      </p>
      {choices ? (
        <p class="rate-up-to">
          {upTo === null ? (
            <span aria-hidden="true">{' '}</span>
          ) : (
            <Words text={upTo} />
          )}
        </p>
      ) : null}
      <ul class="rate-cards" aria-label="The cards rated">
        {start.cards.map((c) => (
          <li key={c.cardId}>
            <CardArt id={c.cardId} width={28} />
            <span>{shortestName(c.cardId)}</span>
          </li>
        ))}
      </ul>
      <p class="rate-lead">
        <Words text={breakdownText(catalog, start, voice)} />
      </p>
      {editors ?? <p class="muted rate-basis">{basisText(start, voice)}</p>}
      <div class="rate-blocks">
        {answers}
        <Comparison
          start={bestStart ?? start}
          best={best}
          busy={busy('best')}
          voice={voice}
        />
        {share}
        <FeeCards start={start} fees={fees} busy={busy} voice={voice} />
        <Next next={next} busy={busy('next')} />
        <Gaps gaps={gaps} busy={busy('gaps')} voice={voice} />
        {closing}
      </div>
      <Into el={assumes}>
        <ul class="assumptions">
          {reportNotes(catalog, start, dataVersion, voice).map((n) => (
            <li key={n}>
              <Words text={n} />
            </li>
          ))}
          {/* The holder's typical-spending note already lists them. */}
          {start.lines.length > 0 && !(start.typical && voice === 'you') ? (
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
      </Into>
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
        <span class="basis">{basisText(start)}</span> Change it
      </summary>
      <div class="panel">
        <p class="muted small">
          Roughly what you spend each month. Changes here stay on this page; Get
          a card keeps its own amounts.
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
                  step="5"
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

// What a link holds, in a line: "Holds your cards, picks, credits used and
// spending (rounded to $5)."
function holds(input: ReportInput, lines: ResolvedLine[] | null): string {
  const parts = [
    input.cards.length === 1 ? 'your card' : 'your cards',
    ...(input.cards.some((c) => Object.keys(c.picks).length > 0)
      ? ['picks']
      : []),
    ...(input.memberships.length > 0 ? ['memberships'] : []),
    ...(Object.keys(input.valuations).length > 0 ? ['point values'] : []),
    // Named for any card with credits, answered or not, so the line stays
    // put while they're tapped.
    ...(input.cards.some((c) => {
      const card = cards.get(c.id)
      return (card?.credits.length ?? 0) + (card?.free_nights.length ?? 0) > 0
    })
      ? ['credits used']
      : []),
    ...(lines === null ? [] : ['spending (rounded to $5)']),
  ]
  return `Holds ${listed(parts)}.`
}

function useLinkState(mine: LinkUpdater | null): LinkState | null {
  const [state, setState] = useState(() => mine?.state() ?? null)
  useEffect(() => {
    if (!mine) return
    setState(mine.state())
    return mine.subscribe(setState)
  }, [mine])
  return state
}

// Renders into an element outside the app, as a portal would: the
// assumptions and the delete control sit in the page's own "How this is
// worked out" section.
function Into({
  el,
  children,
}: {
  el: Element | null
  children: ComponentChildren
}) {
  useEffect(() => {
    if (el) render(<>{children}</>, el)
  })
  useEffect(
    () => () => {
      if (el) render(null, el)
    },
    [el],
  )
  return null
}

// Copy link and Share name a short link on the page, so its address is
// ready inside the tap; the report is saved just after. Your wallet has one
// link, which this browser keeps and updates when the wallet changes
// (app/my-link.ts). A link that couldn't be made is forgotten, so the next
// tap names a new one.
function ShareBox({
  input,
  spending,
  ownSpending,
  include,
  setInclude,
  picture,
  mine,
  edited,
}: {
  input: ReportInput
  spending: Spending
  ownSpending: boolean
  include: boolean
  setInclude: (on: boolean) => void
  picture: RatePicture | null
  mine: LinkUpdater
  edited: boolean
}) {
  const [, redraw] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [deleted, setDeleted] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  const slot = useMemo(() => document.querySelector('[data-rate-delete]'), [])
  const linkState = useLinkState(mine)
  const own = linkState?.link ?? null
  const pageReport = encodeReport(catalog, {
    input,
    lines: spending.typical ? null : spending.lines,
  }).slice(2)
  const report = mine.report(include) ?? pageReport
  const linked = decodeReport(catalog, `w=${report}`)
  const held = linked.ok
    ? holds(linked.link.input, linked.link.lines)
    : holds(input, spending.typical ? null : spending.lines)
  const have: Saved | null = own
  const boxed = have === null ? null : shortUrl(location.origin, have.id)
  const canShare = typeof navigator.share === 'function'

  const flash = () => {
    track('report-made')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const failed = (text: string) => {
    setCopied(false)
    setShown(null)
    setNote(text)
    redraw((n) => n + 1)
  }

  // The link for this tap, its report on the way: a new one if it can't be
  // made says so, and the next tap tries again under a new name.
  const target = (): string => {
    setNote(null)
    setShown(null)
    setDeleted(null)
    mine.flush()
    const t = pickLink(location.origin, have, newLink)
    if (t.fresh) {
      redraw((n) => n + 1)
      void mine.make(t.fresh, include).then((result: Written) => {
        if (result !== 'ok') failed(notMade(result))
      })
    }
    return t.url
  }

  // Both run inside the tap: Safari allows the clipboard and the share
  // sheet only there, so nothing is awaited first.
  const copy = () => {
    const url = target()
    const clipboard = navigator.clipboard as Clipboard | undefined
    const write = clipboard
      ? clipboard.writeText(url)
      : Promise.reject(new Error())
    write.then(flash, () => setShown(url))
  }

  const share = () => {
    const url = target()
    const sheet = navigator.share({ url })
    sheet.then(
      () => track('report-made'),
      () => undefined,
    )
  }

  const remove = () => {
    if (!have) return
    void mine.remove().then((ok) => {
      if (ok) {
        setShown(null)
        setNote(null)
      }
      setDeleted(ok ? DELETED : UNDELETED)
      redraw((n) => n + 1)
    })
  }

  return (
    <section class="panel rate-share" aria-labelledby="rate-share-title">
      <h2 id="rate-share-title">Share this report</h2>
      {boxed === null ? (
        <p class="small">
          Your link stays the same, and updates when your wallet changes.
        </p>
      ) : (
        <input
          class="rate-url"
          type="text"
          readOnly
          aria-label="Your link"
          value={boxed}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      <div class="row-buttons">
        <button type="button" class="primary" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {canShare ? (
          <button type="button" onClick={share}>
            Share
          </button>
        ) : null}
        <SaveImage picture={picture} />
      </div>
      {have !== null && edited ? (
        <p class="small">Changes made only on this page aren’t in your link.</p>
      ) : null}
      {linkState?.trouble ? <p class="small">{linkState.trouble}</p> : null}
      {shown === null || shown === boxed ? null : (
        <input
          class="rate-url"
          type="text"
          readOnly
          aria-label="The link"
          value={shown}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      {note === null ? null : <p class="small">{note}</p>}
      <p class="muted small rate-holds">{held}</p>
      {ownSpending ? (
        <label class="check small">
          <input
            type="checkbox"
            checked={include}
            onChange={(e) => setInclude(e.currentTarget.checked)}
          />
          Put my monthly spending in the link. Without it, this report uses
          typical spending.
        </label>
      ) : null}
      <Into el={slot}>
        {have === null ? null : (
          <p class="small">
            <button type="button" class="link" onClick={remove}>
              Delete my link
            </button>
          </p>
        )}
        {deleted === null ? null : <p class="small">{deleted}</p>}
      </Into>
    </section>
  )
}

// Each card's credits, to tap as used or not.
function Answers({
  start,
  answers,
}: {
  start: ReportStart
  answers: ReturnType<typeof useAnswers>
}) {
  if (start.creditChoices.length === 0) return null
  return (
    <section class="panel rate-credits" aria-labelledby="rate-credits-title">
      <h2 id="rate-credits-title">Credits</h2>
      <p class="muted small rate-hint">
        Tap the ones you use. Count a credit only if you'd spend there anyway.
      </p>
      <CreditPicks cards={start.creditChoices} onSet={answers.set} />
      {answers.error === null ? null : (
        <p class="callout small">{answers.error}</p>
      )}
    </section>
  )
}

// The visitor's own wallet. Credit answers save to it; picks and amounts
// changed here stay on the page. Amounts saved from Get a card in another
// tab replace the page's.
function Rated({
  initial,
  rows: savedRows,
  save,
  mine,
}: {
  initial: ReportInput
  rows: Row[] | null
  save: Saver | null
  mine: LinkUpdater
}) {
  const today = useMemo(() => localToday(), [])
  const rowsFrom = (saved: Row[] | null) =>
    saved ?? TYPICAL_MONTHLY_SPEND.map((t) => ({ ...t }))
  const [firstRows, setFirstRows] = useState<Row[]>(() => rowsFrom(savedRows))
  const [rows, setRows] = useState<Row[]>(firstRows)
  useEffect(() => {
    const next = rowsFrom(savedRows)
    if (sameRows(next, firstRows)) return
    setFirstRows(next)
    setRows(next)
  }, [savedRows])
  const [picks, setPicks] = useState<Record<string, Picks>>({})
  const [include, setIncluded] = useState(
    () => mine.state().link?.spending ?? SHARE_SPENDING,
  )
  const setInclude = (on: boolean) => {
    setIncluded(on)
    mine.setSpending(on)
  }
  const answers = useAnswers(initial, save)
  const own = useMemo(() => spendingOf(rows), [rows])
  const spending = include ? own : TYPICAL
  const input = useMemo(() => {
    const marked = applyMarks(initial, answers.marks)
    return {
      ...marked,
      cards: marked.cards.map((c) => ({
        ...c,
        picks: picks[c.id] ?? c.picks,
      })),
    }
  }, [initial, picks, answers.marks])
  const start = useMemo(
    () => reportStart(catalog, input, today, spending),
    [input, spending, today],
  )
  // The link carries the picks the report used, assumed ones included, so
  // whoever opens it gets the same figures.
  const linked = useMemo(
    () => ({
      ...input,
      cards: start.cards.map((c) => ({
        ...input.cards.find((x) => x.id === c.cardId),
        id: c.cardId,
        picks: c.picks,
      })),
    }),
    [input, start],
  )
  const { parts, busy } = useParts(linked, spending, today, start, 'you')
  const picture = useMemo(
    () =>
      parts.bestStart === null
        ? null
        : ratePictureText(parts.bestStart, parts.best, shortestName, today),
    [parts.bestStart, parts.best, today],
  )
  return (
    <Report
      start={start}
      parts={parts}
      busy={busy}
      voice="you"
      nothing={
        spending.typical ? null : nothingCounted(catalog, spending.lines)
      }
      answers={<Answers start={start} answers={answers} />}
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
          picture={picture}
          mine={mine}
          edited={
            Object.keys(picks).length > 0 ||
            (include && !sameRows(rows, firstRows))
          }
        />
      }
    />
  )
}

// On a shared report the credits are only shown, a line per card: which
// count as used and which don't.
function CreditLines({ start }: { start: ReportStart }) {
  if (start.creditChoices.length === 0) return null
  return (
    <section class="panel" aria-labelledby="rate-credits-title">
      <h2 id="rate-credits-title">Credits</h2>
      <ul class="rate-credit-lines">
        {start.creditChoices.map((c) => {
          // Past three names, a count: "11 credits not counted".
          const names = (answer: 'used' | 'skipped' | null) => {
            const n = c.choices
              .filter((x) => x.answer === answer)
              .map((x) => x.name)
            return n.length > 3 ? [`${String(n.length)} credits`] : n
          }
          const parts = [
            [names('used'), 'used'],
            [names('skipped'), 'not used'],
            [names(null), 'not counted'],
          ] as const
          return (
            <li key={c.cardId}>
              <strong>{shortestName(c.cardId)}</strong>:{' '}
              {parts
                .filter(([n]) => n.length > 0)
                .map(([n, said]) => `${listed(n)} ${said}`)
                .join(' · ')}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// A report someone shared, as its link has it: nothing on it changes, and
// nothing is saved.
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
    () => reportStart(catalog, input, today, spending, 'neutral'),
    [input, spending, today],
  )
  const { parts, busy } = useParts(input, spending, today, start, 'neutral')
  const picture = useMemo(
    () =>
      parts.bestStart === null
        ? null
        : ratePictureText(
            parts.bestStart,
            parts.best,
            shortestName,
            today,
            'neutral',
          ),
    [parts.bestStart, parts.best, today],
  )
  if (lines !== null && nothingCounted(catalog, lines) !== null)
    return (
      <>
        <p class="callout">
          This report's only spending is{' '}
          {listed(lines.map((l) => lineName(catalog, l.label)))}, which earnrate
          doesn't count in a year of rewards, so there's nothing to rate.
        </p>
        <RateYourOwn />
      </>
    )
  return (
    <Report
      start={start}
      parts={parts}
      busy={busy}
      voice="neutral"
      share={null}
      closing={
        <section class="panel rate-end">
          <p>earnrate rates any set of cards this way, with no sign-up.</p>
          <div class="row-buttons">
            <a class="row-link primary" href="/rate">
              Rate my cards
            </a>
            <SaveImage picture={picture} />
          </div>
        </section>
      }
      editors={null}
      answers={<CreditLines start={start} />}
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
        aria-label="Add a card"
        placeholder="Add a card, like Sapphire"
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

// No saved cards yet: each card tapped in is added to My wallet, and taken
// out again if it's tapped again.
function Pick({
  wallet,
  added,
  error,
  onAdd,
  onRemove,
  onRate,
}: {
  wallet: Wallet | null
  added: string[]
  error: string | null
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  onRate: () => void
}) {
  const held = (wallet?.cards ?? [])
    .map((c) => c.id)
    .filter((id) => cards.has(id))
  const count = held.length
  return (
    <section class="panel first rate-pick">
      <h2>Which cards do you have?</h2>
      <p>
        Tap the cards you have, then see what they earn after fees and how that
        compares. They're saved to My wallet.
      </p>
      <QuickCards
        wallet={wallet}
        added={added}
        onAdd={onAdd}
        onRemove={onRemove}
      />
      <CardFinder picked={held} onAdd={onAdd} />
      {error === null ? null : <p class="callout small">{error}</p>}
      {count > 0 ? (
        <div class="quick-done">
          <span>
            {count} card{count === 1 ? '' : 's'}
          </span>
          <button type="button" class="primary" onClick={onRate}>
            Rate {count === 1 ? 'it' : 'them'}
          </button>
        </div>
      ) : null}
    </section>
  )
}

const WATCHED = ['earnrate:wallet', 'earnrate:spending', 'earnrate:sync']

const hasCards = (w: Wallet | null) =>
  (w?.cards ?? []).some((c) => cards.has(c.id))

// The same value while its contents are the same, so a wallet read again
// unchanged doesn't start the report over.
function useSame<T>(value: T): T {
  const key = JSON.stringify(value)
  const kept = useRef({ key, value })
  if (kept.current.key !== key) kept.current = { key, value }
  return kept.current.value
}

// The visitor's own wallet: the one saved in this browser, or synced with
// Claude. With no cards yet, the cards they tap in become it. It follows
// changes made elsewhere: in another tab (storage events), when the page is
// seen again, and, with sync on, the synced wallet on load and when seen.
function Mine({
  first,
  save,
  mine,
}: {
  first: Extract<Source, { kind: 'own' | 'pick' }>
  save: Saver | null
  mine: LinkUpdater
}) {
  const [wallet, setWallet] = useState<Wallet | null>(() => OWN_WALLET.read())
  const [rows, setRows] = useState<Row[] | null>(first.rows)
  const [fromPicker] = useState(first.kind === 'pick')
  const [picking, setPicking] = useState(first.kind === 'pick')
  const [added, setAdded] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const reread = () => {
      setWallet(OWN_WALLET.read())
      setRows(readSaved().rows)
    }
    const pull = () => {
      void pullSynced().then((w) => {
        if (w) setWallet(w)
      })
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && !WATCHED.includes(e.key)) return
      storageChanged()
      reread()
      if (e.key === 'earnrate:sync') pull()
    }
    const onSeen = () => {
      if (document.visibilityState !== 'visible') return
      reread()
      pull()
    }
    pull()
    addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onSeen)
    return () => {
      removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onSeen)
    }
  }, [])

  const change = (run: Promise<SaveResult>) => {
    setError(null)
    void run.then((result) => {
      setWallet(result.wallet)
      if (!result.ok) setError(result.error)
    })
  }
  const saveAnswer: Saver | null = save
    ? async (cardId, marks) => {
        const result = await save(cardId, marks)
        setWallet(result.wallet)
        return result
      }
    : null

  const input = useSame(
    wallet === null ? null : walletReportInput(catalog, wallet),
  )
  const steadyRows = useSame(rows)

  if (picking || !input || input.cards.length === 0 || !hasCards(wallet))
    return (
      <Pick
        wallet={wallet}
        added={added}
        error={error}
        onAdd={(id) => {
          setAdded((a) => (a.includes(id) ? a : [...a, id]))
          if (!wallet?.cards.some((c) => c.id === id))
            change(addCard(OWN_WALLET, id))
        }}
        onRemove={(id) => change(removeCard(OWN_WALLET, id))}
        onRate={() => {
          setPicking(false)
          requestAnimationFrame(() => scrollTo({ top: 0 }))
        }}
      />
    )
  return (
    <>
      {fromPicker ? (
        <>
          <p class="rate-change">
            <button type="button" class="link" onClick={() => setPicking(true)}>
              Change cards
            </button>
          </p>
          <p class="lede">
            Saved to <a href="/#wallet">My wallet</a>. Credits you mark here
            save there too.
          </p>
        </>
      ) : (
        <p class="lede">
          Your saved cards. Credits you mark here save to My wallet.
        </p>
      )}
      <Rated initial={input} rows={steadyRows} save={saveAnswer} mine={mine} />
    </>
  )
}

const SHARED_TITLE = 'A shared wallet · earnrate'

export function Rate() {
  // A short link (/r/<id>) is read from earnrate.dev by its id; anything
  // else from the address, then this browser's saved wallet.
  const [stored] = useState(() => storedId(location.pathname))
  const [source, setSource] = useState<Source>(() =>
    stored !== null
      ? { kind: 'loading' }
      : reportSource(catalog, location.hash, readSaved),
  )
  useEffect(() => {
    if (stored !== null) {
      track('report-opened')
      void loadReport(stored).then((text) => {
        setSource(storedSource(catalog, text))
      })
      return
    }
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
  useEffect(() => {
    if (ownLink(source, myLink)) startMyLink()
  }, [source])
  const shared =
    source.kind === 'shared' ||
    source.kind === 'bad' ||
    source.kind === 'loading'
  useEffect(() => {
    if (shared) document.title = SHARED_TITLE
  }, [shared])

  if (source.kind === 'loading')
    return (
      <>
        <h1>A shared wallet</h1>
        <p class="muted">Opening the report…</p>
      </>
    )
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
        <Shared
          key={stored ?? location.hash}
          input={source.link.input}
          lines={source.link.lines}
        />
      </>
    )
  const mine = ownLink(source, myLink)
  return (
    <>
      <h1>Rate my wallet</h1>
      {mine ? (
        <Mine
          first={source}
          save={answerSaver(source, OWN_WALLET)}
          mine={mine}
        />
      ) : null}
    </>
  )
}
