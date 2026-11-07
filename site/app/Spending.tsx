import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import type { Picks } from '../../src/engine/explore.ts'
import { CardArt } from './CardArt.tsx'
import { track } from './track.ts'
import { localToday } from '../../src/engine/periods.ts'
import {
  resolveSpendLines,
  simulateCatalog,
  spendLineFor,
  TYPICAL_MONTHLY_SPEND,
  type Simulation,
} from '../../src/engine/simulate.ts'
import {
  categoryPhrase,
  CREDITS_APART,
  ifCreditsUsedText,
  listed,
  pairCreditsUsedText,
} from '../../src/engine/text.ts'
import { feeLabel, shortName, wholeDollars, words } from './format.ts'
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
  // The open row: a card id, or a pair's ids joined with "+".
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (key: string) => setOpen(open === key ? null : key)
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
  const result = useMemo(() => {
    const known = lines.filter((l) => l.merchant.source !== 'none')
    return known.length === 0
      ? null
      : simulateCatalog(catalog, known, {
          ...engineOptions(settings, saved),
          start: localToday(),
        })
  }, [lines, settings, saved])
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
        {unknown.length > 0 ? (
          <p class="callout">
            earnrate doesn't know{' '}
            {listed(unknown.map((l) => `“${l.merchant.input}”`))}, so the
            results leave {unknown.length === 1 ? 'it' : 'them'} out. Use a
            category like dining or groceries instead.
          </p>
        ) : null}
      </div>
      {filters}

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
                    <button
                      type="button"
                      class="result-top result-toggle"
                      aria-expanded={open === card.cardId}
                      onClick={() => toggle(card.cardId)}
                    >
                      <span class="rank">{i + 1}</span>
                      <CardArt id={card.cardId} />
                      <span class="result-name">
                        <strong>{shortName(card.cardId)}</strong>
                        <span class="muted">
                          {wholeDollars(s.rewards)} back ·{' '}
                          {feeLabel(card.cardId)}
                        </span>
                      </span>
                      <span class="rate">
                        {wholeDollars(s.net)}
                        <small>/yr</small>
                      </span>
                    </button>
                    {picks ? <p class="muted">{picks}</p> : null}
                    {s.credits
                      .filter((c) => !c.held)
                      .map((c) => (
                        <p class="muted" key={c.cardId}>
                          {ifCreditsUsedText(c, s.netIfCreditsUsed)}
                        </p>
                      ))}
                    {open === card.cardId ? (
                      <div class="row-buttons">
                        <a class="row-link" href={`/cards/${card.cardId}`}>
                          See card details
                        </a>
                        <a
                          class="row-link primary"
                          href={`#wallet&add=${card.cardId}`}
                        >
                          Add to my wallet
                        </a>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ol>

            {pair ? (
              <>
                <h3>Best two-card pairs</h3>
                {pair.net > single.net ? (
                  <p class="muted">
                    The best pair earns {wholeDollars(pair.net - single.net)} a
                    year more than the best single card, after fees.
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
                            {p.cards
                              .map((c) => shortName(c.cardId))
                              .join(' + ')}
                          </strong>
                          <span class="muted">
                            {wholeDollars(p.rewards)} back ·{' '}
                            {wholeDollars(p.annualFees + p.membershipFees)} in
                            fees
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
              <li>{CREDITS_APART}</li>
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
