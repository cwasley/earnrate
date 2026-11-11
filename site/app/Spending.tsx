import { Fragment, type ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import { HALF_CENT } from '../../src/engine/compare.ts'
import type { Picks } from '../../src/engine/explore.ts'
import { CardArt } from './CardArt.tsx'
import { track } from './track.ts'
import { localToday } from '../../src/engine/periods.ts'
import {
  ifMemberLines,
  membershipName,
  placedAmong,
} from '../../src/engine/memberships.ts'
import {
  compareOffers,
  OFFERS_MAY_DIFFER,
  offerTerms,
  type OfferSummary,
} from '../../src/engine/offers.ts'
import {
  byNet,
  countedLines,
  nothingCounted,
  resolveSpendLines,
  simulateCatalog,
  spendLineFor,
  TYPICAL_MONTHLY_SPEND,
  type Simulation,
} from '../../src/engine/simulate.ts'
import {
  categoryPhrase,
  CREDITS_APART,
  currencyName,
  ifCreditsUsedText,
  listed,
  minimumSpendText,
  money,
  pairCreditsUsedText,
  shortDate,
  withArticle,
} from '../../src/engine/text.ts'
import { cards, feeLabel, shortName, wholeDollars, words } from './format.ts'
import {
  engineOptions,
  loadList,
  save,
  type Saved,
  type Settings,
} from './settings.ts'

export type Row = { what: string; monthly: number }

export const lineFor = (what: string, monthly: number) =>
  spendLineFor(catalog, what, monthly)

// Rows shown before "Show more", and how many it shows.
const SHOWN = 3
const MORE = 10

const isTypical = (rows: Row[]) =>
  rows.length === TYPICAL_MONTHLY_SPEND.length &&
  TYPICAL_MONTHLY_SPEND.every(
    (t, i) => rows[i]?.what === t.what && rows[i].monthly === t.monthly,
  )

function picksText(picks: Picks): string | null {
  const all = Object.values(picks).flat()
  return all.length === 0 ? null : `Picks: ${all.map(words).join(', ')}`
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

function feeWords(cardId: string): string {
  const fee = cards.get(cardId)?.annual_fee
  return fee === undefined
    ? ''
    : fee === 0
      ? ', with no annual fee'
      : ` after its ${money(fee)} annual fee`
}

function Answer({
  single,
  ties,
  pair,
  offer,
  monthly,
  typical,
}: {
  single: Simulation
  ties: number
  pair: Simulation | undefined
  offer: OfferSummary | undefined
  monthly: number
  typical: boolean
}) {
  const id = single.cards[0]?.cardId ?? ''
  const first = firstYear(offer, single.net)
  const minimum = offer?.plan?.minimumSpend
  const gain = pair ? pair.net - single.net : 0
  return (
    <div class="panel find-answer">
      <p>
        {typical
          ? `On typical U.S. spending, about ${wholeDollars(monthly)} a month`
          : `On your spending, ${wholeDollars(monthly)} a month`}
        , the <strong>{shortName(id)}</strong> earns the most on its own
        {ties > 0
          ? `, tied with ${String(ties)} other card${ties === 1 ? '' : 's'}`
          : ''}
        : about {wholeDollars(single.net)} a year{feeWords(id)}.
        {first !== null
          ? ` Counting its welcome offer, the first year comes to about ${wholeDollars(first)}.`
          : ''}
      </p>
      {offer && minimum && !minimum.reachable ? (
        <p class="warn">
          {minimumSpendText(offer.spend, offer.months, minimum, typical)}
        </p>
      ) : null}
      {pair && gain >= 0.5 ? (
        <>
          <p>
            Two cards together net about {wholeDollars(pair.net)} a year after
            fees, {wholeDollars(gain)} more:
          </p>
          <Split sim={pair} />
        </>
      ) : (
        <p>One card is enough here: no pair beats the {shortName(id)}.</p>
      )}
    </div>
  )
}

export function Spending({
  settings,
  saved,
  filters,
}: {
  settings: Settings
  saved: Saved
  filters: ComponentChildren
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    loadList<Row>('spending', TYPICAL_MONTHLY_SPEND),
  )
  const [adding, setAdding] = useState('')
  // Once the amounts are someone's own, they stay in view.
  const [editing, setEditing] = useState(() => !isTypical(rows))
  const [moreSingles, setMoreSingles] = useState(false)
  const [morePairs, setMorePairs] = useState(false)
  // Cards a card or comparison page asked about (#spending&card=<id>):
  // shown with their rank even below the top ones, the first one open.
  const [focus] = useState(() =>
    new URLSearchParams(location.hash.slice(1))
      .getAll('card')
      .filter((id) => catalog.cards.some((c) => c.id === id)),
  )
  useEffect(() => {
    if (focus.length === 0) return
    track('page-spending')
    requestAnimationFrame(() => {
      document
        .getElementById(`single-${focus[0] ?? ''}`)
        ?.scrollIntoView({ block: 'center' })
    })
  }, [focus])
  // The open row: a card id, or a pair's ids joined with "+".
  const [open, setOpen] = useState<string | null>(focus[0] ?? null)
  const toggle = (key: string) => setOpen(open === key ? null : key)
  useEffect(() => save('spending', rows), [rows])

  const typical = isTypical(rows)
  const today = localToday()
  const lines = useMemo(
    () =>
      resolveSpendLines(
        catalog,
        rows.map((r) => lineFor(r.what, r.monthly)),
      ),
    [rows],
  )
  const unknown = lines.filter((l) => l.merchant.source === 'none')
  const known = useMemo(
    () => lines.filter((l) => l.merchant.source !== 'none'),
    [lines],
  )
  const leftOut = useMemo(() => nothingCounted(catalog, known), [known])
  const options = useMemo(
    () => engineOptions(settings, saved),
    [settings, saved],
  )
  const result = useMemo(
    () =>
      known.length === 0 || leftOut !== null
        ? null
        : simulateCatalog(catalog, known, { ...options, start: today }),
    [known, leftOut, options, today],
  )
  // Each card alone, as the next-card planner values it: the same spending
  // all on it, with its welcome offer in the first year.
  const offers = useMemo(() => {
    if (!result) return new Map<string, OfferSummary>()
    const comparison = compareOffers(
      catalog,
      {
        valuations: options.valuations,
        memberships: options.memberships,
        cards: [],
      },
      {
        kind: settings.kind,
        business: settings.business,
        noAnnualFee: settings.noFee,
        includeHeld: true,
      },
      today,
      { lines: known, typical },
    )
    return new Map(
      [...comparison.offers, ...comparison.membersOnly].map((o) => [
        o.cardId,
        o,
      ]),
    )
  }, [result, options, settings, known, typical, today])
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
    const picks = picksText(card.picks)
    const offer = offers.get(card.cardId)
    const first = firstYear(offer, s.net)
    const minimum = offer?.plan?.minimumSpend
    const isOpen = open === card.cardId
    return (
      <li class="result" key={card.cardId} id={`single-${card.cardId}`}>
        <button
          type="button"
          class="result-top result-toggle"
          aria-expanded={isOpen}
          onClick={() => toggle(card.cardId)}
        >
          <span class="rank">{rank}</span>
          <CardArt id={card.cardId} />
          <span class="result-name">
            <strong>{shortName(card.cardId)}</strong>
            <span class="muted">
              {wholeDollars(s.rewards)} back · {feeLabel(card.cardId)}
            </span>
          </span>
          <span class="rate">
            {wholeDollars(s.net)}
            <small>/yr</small>
            {first !== null ? (
              <small class="first-year">{wholeDollars(first)} first year</small>
            ) : null}
          </span>
        </button>
        {offer ? (
          <p class="muted">
            Welcome offer:{' '}
            {offerTerms(offer, currencyName(catalog, offer.currency))}.
            {minimum && minimum.reachable
              ? ` ${minimumSpendText(offer.spend, offer.months, minimum, typical)}`
              : ''}
          </p>
        ) : null}
        {offer && minimum && !minimum.reachable ? (
          <p class="warn">
            {minimumSpendText(offer.spend, offer.months, minimum, typical)}
          </p>
        ) : null}
        {picks ? <p class="muted">{picks}</p> : null}
        {s.credits
          .filter((c) => !c.held)
          .map((c) => (
            <p class="muted" key={c.cardId}>
              {ifCreditsUsedText(c, s.netIfCreditsUsed)}
            </p>
          ))}
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
            <a class="row-link primary" href={`#wallet&add=${card.cardId}`}>
              Add to my wallet
            </a>
          </div>
        ) : null}
      </li>
    )
  }

  const update = (i: number, monthly: number) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, monthly } : r)))

  const singlesLeft = result ? Math.min(MORE, result.singles.length) - SHOWN : 0
  const pairsLeft = result ? Math.min(MORE, result.pairs.length) - SHOWN : 0

  return (
    <div>
      <div aria-live="polite">
        {result && single ? (
          <Answer
            single={single}
            ties={
              result.singles.filter(
                (s) => s !== single && Math.abs(s.net - single.net) < HALF_CENT,
              ).length
            }
            pair={pair}
            offer={offers.get(single.cards[0]?.cardId ?? '')}
            monthly={monthly}
            typical={typical}
          />
        ) : null}
      </div>
      {unknown.length > 0 ? (
        <p class="callout">
          earnrate doesn't know{' '}
          {listed(unknown.map((l) => `“${l.merchant.input}”`))}, so the results
          leave {unknown.length === 1 ? 'it' : 'them'} out. Use a category like
          dining or groceries instead.
        </p>
      ) : null}
      {leftOut !== null ? <p class="callout">{leftOut}</p> : null}

      <details
        class="filters spend-edit"
        open={editing || !result}
        onToggle={(e) => setEditing(e.currentTarget.open)}
      >
        <summary>
          Change the spending
          <span class="muted"> · {wholeDollars(total)} a month</span>
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
            <label class="visually-hidden" for="spend-add">
              Add a store or category
            </label>
            <input
              id="spend-add"
              type="text"
              list="suggestions"
              placeholder="Add a store or category"
              autocomplete="off"
              value={adding}
              onInput={(e) => setAdding(e.currentTarget.value)}
            />
            <button type="submit">Add</button>
          </form>
          <p class="total">
            {wholeDollars(total)} a month · {wholeDollars(total * 12)} a year
          </p>
        </div>
      </details>
      {filters}

      {result && single ? (
        <section class="results">
          <h3>Each card on its own</h3>
          <ol class="result-list">
            {result.singles
              .slice(0, shownSingles)
              .map((s, i) => singleRow(s, i + 1))}
          </ol>
          {!moreSingles && singlesLeft > 0 ? (
            <button
              type="button"
              class="more"
              onClick={() => setMoreSingles(true)}
            >
              Show {singlesLeft} more cards
            </button>
          ) : null}
          {members.map((m) => (
            <p class="muted" key={m}>
              {m}
            </p>
          ))}
          {focus
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
                      {withArticle(membershipName(catalog, member.membership))},
                      which it needs:
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

          {pair ? (
            <>
              <h3>Two cards together</h3>
              <ol class="result-list">
                {result.pairs.slice(0, shownPairs).map((p, i) => (
                  <li
                    class="result"
                    key={p.cards.map((c) => c.cardId).join('+')}
                  >
                    <button
                      type="button"
                      class="result-top result-toggle"
                      aria-expanded={open === pairKey(p)}
                      onClick={() => toggle(pairKey(p))}
                    >
                      <span class="rank">{i + 1}</span>
                      <span class="art-pair">
                        {p.cards.map((c) => (
                          <CardArt id={c.cardId} key={c.cardId} />
                        ))}
                      </span>
                      <span class="result-name">
                        <strong>
                          {p.cards.map((c) => shortName(c.cardId)).join(' + ')}
                        </strong>
                        <span class="muted">
                          {wholeDollars(p.rewards)} back ·{' '}
                          {wholeDollars(p.annualFees)} in fees
                        </span>
                      </span>
                      <span class="rate">
                        {wholeDollars(p.net)}
                        <small>/yr</small>
                      </span>
                    </button>
                    <Split sim={p} />
                    {p.otherCredits > 0 ? (
                      <p class="muted">
                        {pairCreditsUsedText(
                          p.credits
                            .filter((c) => !c.held)
                            .map((c) => shortName(c.cardId)),
                          p.otherCredits,
                          p.netIfCreditsUsed,
                          p.credits.some((c) => !c.held && c.nights > 0),
                        )}
                      </p>
                    ) : null}
                    {p.alternatives.length > 0 ? (
                      <p class="muted">
                        Same result with{' '}
                        {listed(p.alternatives.map(shortName), 'or')} instead.
                      </p>
                    ) : null}
                    {open === pairKey(p) ? (
                      <div class="row-buttons">
                        {p.cards.map((c) => (
                          <a
                            class="row-link"
                            href={`/cards/${c.cardId}`}
                            key={c.cardId}
                          >
                            See {shortName(c.cardId)}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
              {!morePairs && pairsLeft > 0 ? (
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
          <ul class="assumptions">
            <li>
              Rewards minus annual fees over the next 12 months, with caps
              filling and resetting as they would. Each card uses its best
              category picks, with any bonus activations done.
            </li>
            <li>
              Welcome offers pay once, so they don't change the order. A card's
              first-year figure adds its public offer if this spending, all on
              that card, reaches the minimum in time, and uses the first year's
              fee. Pairs leave offers out. {OFFERS_MAY_DIFFER}
            </li>
            <li>{CREDITS_APART}</li>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
