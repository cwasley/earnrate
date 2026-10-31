import { useMemo, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import {
  exploreCards,
  findCategory,
  type Exploration,
  type ExploreEntry,
} from '../../src/engine/explore.ts'
import { localToday } from '../../src/engine/periods.ts'
import { categoryPhrase } from '../../src/engine/recommend.ts'
import {
  cards,
  feeText,
  hostname,
  issuerName,
  membershipName,
  pct,
  requirementLines,
  shortName,
} from './format.ts'
import { engineOptions, type Settings } from './settings.ts'

const QUICK = [
  'Groceries',
  'Dining',
  'Gas',
  'Amazon',
  'Costco',
  'Travel',
  'Streaming',
  'Everything else',
]

const TOP = 8

export const SUGGESTIONS = [
  ...new Set([
    ...catalog.categories.flatMap((c) => [c.name, ...c.aliases]),
    ...catalog.merchants.seed.map((m) => m.name),
    ...catalog.merchants.overrides.map((m) => m.name),
  ]),
].sort((a, b) => a.localeCompare(b))

function explore(text: string, settings: Settings): Exploration {
  const category = findCategory(catalog, text)
  return exploreCards(
    catalog,
    {
      merchant: category === null ? text : null,
      category,
      amount: null,
      channel: null,
      date: localToday(),
    },
    engineOptions(settings),
  )
}

function title(r: Exploration): string {
  const m = r.merchant
  if (m.source === 'category') return categoryPhrase(catalog, m.category)
  return m.source === 'none' ? `“${m.input}”` : m.resolvedName
}

function CardRow({ entry, rank }: { entry: ExploreEntry; rank: number }) {
  const card = cards.get(entry.cardId)
  const upgrade = entry.withMembership[0]
  return (
    <li class="result">
      <div class="result-top">
        <span class="rank">{rank}</span>
        <div class="result-name">
          <strong>{shortName(entry.cardId)}</strong>
          <span class="muted">
            {issuerName(entry.issuer)} · {feeText(entry.cardId)}
          </span>
        </div>
        <span class="rate">{pct(entry.effectiveReturnPct)}</span>
      </div>
      {(() => {
        const lines = requirementLines(entry.cardId, entry.requirements)
        return lines.length > 0 ? (
          <ul class="needs">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : null
      })()}
      {upgrade ? (
        <p class="upgrade">
          {entry.withMembership.length > 1 ? 'Up to ' : ''}
          {pct(upgrade.effectiveReturnPct)} with{' '}
          {membershipName(upgrade.membership)}
        </p>
      ) : null}
      {entry.warnings.map((w) => (
        <p class="warn" key={w}>
          {w}
        </p>
      ))}
      <details>
        <summary>Why</summary>
        {entry.reasoning.map((r) => (
          <p key={r}>{r}</p>
        ))}
        {entry.evidence ? (
          <blockquote>
            “{entry.evidence.quote}”{' '}
            <a href={entry.evidence.url} rel="noopener" target="_blank">
              {hostname(entry.evidence.url)}
            </a>
          </blockquote>
        ) : null}
        {card ? (
          <p class="muted">
            Checked against the issuer's terms {card.last_verified}.
          </p>
        ) : null}
      </details>
    </li>
  )
}

function Excluded({ r }: { r: Exploration }) {
  const byReason = new Map<string, number>()
  for (const e of r.excluded)
    byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1)
  return (
    <>
      {[...byReason].map(([reason, count]) => (
        <p class="muted" key={reason}>
          {reason} {count === 1 ? 'One card' : `${String(count)} cards`} left
          out.
        </p>
      ))}
    </>
  )
}

export function BestFor({
  settings,
  query,
  onQuery,
}: {
  settings: Settings
  query: string
  onQuery: (q: string) => void
}) {
  const [text, setText] = useState(query)
  const [all, setAll] = useState(false)
  const result = useMemo(
    () => (query.trim() === '' ? null : explore(query, settings)),
    [query, settings],
  )

  const ask = (q: string) => {
    setText(q)
    setAll(false)
    onQuery(q)
  }

  const shown = result
    ? all
      ? result.ranked
      : result.ranked.slice(0, TOP)
    : []
  return (
    <div>
      <form
        class="ask"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
      >
        <label class="visually-hidden" for="best-for">
          Store or category
        </label>
        <input
          id="best-for"
          type="search"
          list="suggestions"
          placeholder="Whole Foods, Amazon, gas…"
          autocomplete="off"
          enterkeyhint="search"
          value={text}
          onInput={(e) => {
            const value = e.currentTarget.value
            setText(value)
            if (
              SUGGESTIONS.some((s) => s.toLowerCase() === value.toLowerCase())
            )
              ask(value)
          }}
        />
        <button type="submit">Compare</button>
      </form>
      <div class="chips" role="list">
        {QUICK.map((q) => (
          <button
            type="button"
            role="listitem"
            class={q.toLowerCase() === query.toLowerCase() ? 'chip on' : 'chip'}
            key={q}
            onClick={() => ask(q)}
          >
            {q}
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {result ? (
          <section class="results">
            <h3>
              Best cards for {title(result)}
              {result.merchant.source !== 'category' &&
              result.merchant.source !== 'none' ? (
                <span class="muted">
                  {' '}
                  · codes as {categoryPhrase(catalog, result.merchant.category)}
                </span>
              ) : null}
            </h3>
            {result.warnings.map((w) => (
              <p class="callout" key={w}>
                {w}
              </p>
            ))}
            {result.merchant.source === 'none' ? (
              <p>
                earnrate doesn't know that store yet. Try a category above, or a
                bigger store name.
              </p>
            ) : null}
            <ol class="result-list">
              {shown.map((e, i) => (
                <CardRow entry={e} rank={i + 1} key={e.cardId} />
              ))}
            </ol>
            {result.ranked.length > shown.length ? (
              <button type="button" class="more" onClick={() => setAll(true)}>
                Show all {result.ranked.length} cards
              </button>
            ) : null}
            <Excluded r={result} />
            <ul class="assumptions">
              {result.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>
        ) : (
          <p class="muted hint">
            Pick a category or type a store to rank all {catalog.cards.length}{' '}
            cards earnrate knows.
          </p>
        )}
      </div>
    </div>
  )
}
