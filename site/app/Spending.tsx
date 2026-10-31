import { useEffect, useMemo, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import { findCategory, type Picks } from '../../src/engine/explore.ts'
import { localToday } from '../../src/engine/periods.ts'
import { categoryPhrase } from '../../src/engine/recommend.ts'
import {
  resolveSpendLines,
  simulateCatalog,
  type Simulation,
} from '../../src/engine/simulate.ts'
import { feeText, shortName, usd, words } from './format.ts'
import { engineOptions, loadList, save, type Settings } from './settings.ts'

type Row = { what: string; monthly: number }

// Rough monthly amounts for a U.S. household, a starting point to edit.
const STARTER: Row[] = [
  { what: 'Groceries', monthly: 500 },
  { what: 'Dining', monthly: 250 },
  { what: 'Gas', monthly: 150 },
  { what: 'Amazon', monthly: 100 },
  { what: 'Streaming', monthly: 40 },
  { what: 'Travel', monthly: 150 },
  { what: 'Everything else', monthly: 800 },
]

function lineFor(what: string, monthly: number) {
  const category = findCategory(catalog, what)
  return { merchant: category === null ? what : null, category, monthly }
}

function picksText(picks: Picks): string | null {
  const all = Object.values(picks).flat()
  return all.length === 0 ? null : `Picks: ${all.map(words).join(', ')}`
}

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
          <strong>{shortName(id)}</strong> for {labels.map(phrase).join(', ')}
        </li>
      ))}
    </ul>
  )
}

export function Spending({ settings }: { settings: Settings }) {
  const [rows, setRows] = useState<Row[]>(() => loadList('spending', STARTER))
  const [adding, setAdding] = useState('')
  useEffect(() => save('spending', rows), [rows])

  const lines = useMemo(
    () =>
      resolveSpendLines(
        catalog,
        rows.map((r) => lineFor(r.what, r.monthly)),
      ),
    [rows],
  )
  const unknown = lines.filter((l) => l.merchant.source === 'none')
  const result = useMemo(
    () =>
      lines.length === 0 || unknown.length > 0
        ? null
        : simulateCatalog(catalog, lines, {
            ...engineOptions(settings),
            start: localToday(),
          }),
    [lines, settings, unknown.length],
  )
  const total = rows.reduce((sum, r) => sum + r.monthly, 0)
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

  const update = (i: number, monthly: number) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, monthly } : r)))

  return (
    <div>
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
                onInput={(e) =>
                  update(i, Math.max(0, Number(e.currentTarget.value) || 0))
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
        {usd(total)} a month · {usd(total * 12)} a year
      </p>
      {unknown.length > 0 ? (
        <p class="callout">
          earnrate doesn't know{' '}
          {unknown.map((l) => `“${l.merchant.input}”`).join(', ')}. Use a
          category like dining or groceries instead.
        </p>
      ) : null}

      <div aria-live="polite">
        {result && single ? (
          <section class="results">
            <h3>Best single cards</h3>
            <ol class="result-list">
              {result.singles.slice(0, 5).map((s, i) => {
                const card = s.cards[0]
                if (!card) return null
                const picks = picksText(card.picks)
                return (
                  <li class="result" key={card.cardId}>
                    <div class="result-top">
                      <span class="rank">{i + 1}</span>
                      <div class="result-name">
                        <strong>{shortName(card.cardId)}</strong>
                        <span class="muted">
                          {usd(s.rewards)} back · {feeText(card.cardId)}
                        </span>
                      </div>
                      <span class="rate">
                        {usd(s.net)}
                        <small>/yr</small>
                      </span>
                    </div>
                    {picks ? <p class="muted">{picks}</p> : null}
                  </li>
                )
              })}
            </ol>

            {pair ? (
              <>
                <h3>Best two-card pairs</h3>
                {pair.net > single.net ? (
                  <p class="muted">
                    The best pair earns {usd(pair.net - single.net)} a year more
                    than the best single card, after fees.
                  </p>
                ) : (
                  <p class="muted">
                    One card is enough here: no pair beats{' '}
                    {shortName(single.cards[0]?.cardId ?? '')}.
                  </p>
                )}
                <ol class="result-list">
                  {result.pairs.slice(0, 3).map((p, i) => (
                    <li
                      class="result"
                      key={p.cards.map((c) => c.cardId).join('+')}
                    >
                      <div class="result-top">
                        <span class="rank">{i + 1}</span>
                        <div class="result-name">
                          <strong>
                            {p.cards
                              .map((c) => shortName(c.cardId))
                              .join(' + ')}
                          </strong>
                          <span class="muted">
                            {usd(p.rewards)} back · {usd(p.annualFees)} in fees
                          </span>
                        </div>
                        <span class="rate">
                          {usd(p.net)}
                          <small>/yr</small>
                        </span>
                      </div>
                      <Split sim={p} />
                      {p.alternatives.length > 0 ? (
                        <p class="muted">
                          Same result with{' '}
                          {p.alternatives.map(shortName).join(' or ')} instead.
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
            <ul class="assumptions">
              <li>
                Rewards minus annual fees over the next 12 months. Caps fill and
                reset as they would; welcome bonuses aren't counted.
              </li>
              <li>
                Each card uses its best category picks, with any bonus
                activations done.
              </li>
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  )
}
