import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import {
  exploreCards,
  membersOnlyLines,
  topOf,
  type CreditPick,
  type Exploration,
  type ExploreEntry,
} from '../../src/engine/explore.ts'
import { localToday } from '../../src/engine/periods.ts'
import { splitPurchaseText } from '../../src/merchants/resolve.ts'
import { ABROAD, noteOnly } from '../../src/engine/recommend.ts'
import {
  capitalize,
  categoryPhrase,
  CREDIT_GROUP,
  CREDIT_PERIODS,
  ENROLL_FIRST,
  hostname,
  money,
} from '../../src/engine/text.ts'
import {
  cards,
  feeLabel,
  issuerName,
  membershipName,
  pct,
  requirementLines,
  shortName,
} from './format.ts'
import { ABROAD_NOTE } from './AbroadToggle.tsx'
import { PayingHints, payingNote } from './PayingWith.tsx'
import type { PaymentMethod } from '../../src/schema/card.ts'
import type { Purchase } from './ThisPurchase.tsx'
import { CardArt } from './CardArt.tsx'
import { track } from './track.ts'
import { SearchInput } from './SearchInput.tsx'
import { engineOptions, type Saved, type Settings } from './settings.ts'
import {
  EVERYDAY_PURCHASES,
  quickPickText,
} from '../../src/engine/cheat-sheet.ts'

const QUICK = EVERYDAY_PURCHASES.map(quickPickText)

const TOP = 8
// The ranking shown before anyone asks, so the first screen has an answer.
const EXAMPLE = QUICK[0] ?? 'Groceries'
const EXAMPLE_ROWS = 3

export const SUGGESTIONS = [
  ...new Set([
    ...catalog.categories.flatMap((c) => [c.name, ...c.aliases]),
    ...catalog.merchants.seed.map((m) => m.name),
    ...catalog.merchants.overrides.map((m) => m.name),
  ]),
].sort((a, b) => a.localeCompare(b))

function explore(
  text: string,
  abroad: boolean,
  payment: PaymentMethod | null,
  settings: Settings,
  saved: Saved,
): Exploration {
  const { merchant, amount } = splitPurchaseText(text)
  return exploreCards(
    catalog,
    {
      merchant,
      category: null,
      amount,
      channel: null,
      date: localToday(),
      country: abroad ? ABROAD : 'US',
      payment,
    },
    engineOptions(settings, saved),
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
        <CardArt id={entry.cardId} />
        <div class="result-name">
          <strong>{shortName(entry.cardId)}</strong>
          <span class="muted">
            {issuerName(entry.issuer)} ·{' '}
            {feeLabel(entry.cardId, {
              membership: entry.needsMembership !== null,
            })}
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
            Checked against the issuer's terms {card.last_verified}. Wrong rate?{' '}
            <a href="/support">Tell us</a>.
          </p>
        ) : null}
      </details>
    </li>
  )
}

// A card with a statement credit at the store: dollars, never a percent.
function CreditRow({ pick }: { pick: CreditPick }) {
  return (
    <li class="result credit-pick">
      <div class="result-top">
        <CardArt id={pick.cardId} width={44} />
        <div class="result-name">
          <strong>{shortName(pick.cardId)}</strong>
          <span class="muted">
            {issuerName(pick.issuer)} ·{' '}
            {feeLabel(pick.cardId, { membership: false })}
          </span>
        </div>
        <span class="rate">
          {money(pick.amount)} <small>back</small>
        </span>
      </div>
      <p>
        {capitalize(CREDIT_PERIODS[pick.period])}
        {pick.terms}, then {pick.earn}.
        {pick.enroll ? (
          <strong class="credit-enroll"> {capitalize(ENROLL_FIRST)}.</strong>
        ) : null}
      </p>
      <details>
        <summary>Terms</summary>
        {pick.note ? <p>{pick.note}</p> : null}
        {pick.evidence ? (
          <blockquote>
            “{pick.evidence.quote}”{' '}
            <a href={pick.evidence.url} rel="noopener" target="_blank">
              {hostname(pick.evidence.url)}
            </a>
          </blockquote>
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

function Example({
  result,
  onOpen,
}: {
  result: Exploration
  onOpen: () => void
}) {
  return (
    <section class="example" aria-labelledby="example-title">
      <h3 id="example-title">
        For example, {title(result).toLowerCase()}
        <span class="muted"> · top 3 personal cards</span>
      </h3>
      <ol class="example-list">
        {result.ranked.slice(0, EXAMPLE_ROWS).map((e) => (
          <li key={e.cardId}>
            <CardArt id={e.cardId} width={44} />
            <span class="example-name">
              <strong>{shortName(e.cardId)}</strong>
              <span class="muted">{feeLabel(e.cardId)}</span>
            </span>
            <span class="rate">{pct(e.effectiveReturnPct)}</span>
          </li>
        ))}
      </ol>
      <button type="button" class="more" onClick={onOpen}>
        See all {result.ranked.length} personal cards and why
      </button>
    </section>
  )
}

function NextSteps({
  hasCards,
  onWallet,
}: {
  hasCards: boolean
  onWallet: () => void
}) {
  return (
    <div class="next-steps">
      {!hasCards ? (
        <p>
          Have some of these?{' '}
          <button
            type="button"
            class="link"
            onClick={() => {
              track('cta-save-cards')
              onWallet()
            }}
          >
            Add your cards
          </button>{' '}
          to rank just yours. They stay in this browser.
        </p>
      ) : null}
      <p>
        Ask the same thing from Claude, by name or with your cards:{' '}
        <a href="#claude" data-count="cta-after-answer">
          connect earnrate
        </a>
        .
      </p>
    </div>
  )
}

export function BestFor({
  settings,
  saved,
  filters,
  purchase,
  onPurchase,
  query,
  onQuery,
  onWallet,
  hasCards,
}: {
  settings: Settings
  saved: Saved
  filters: ComponentChildren
  purchase: Purchase
  onPurchase: (p: Purchase) => void
  query: string
  onQuery: (q: string) => void
  onWallet: () => void
  hasCards: boolean
}) {
  const [text, setText] = useState(query)
  const [all, setAll] = useState(false)
  const { abroad, payment } = purchase
  const result = useMemo(
    () =>
      query.trim() === ''
        ? null
        : explore(query, abroad, payment, settings, saved),
    [query, abroad, payment, settings, saved],
  )
  const example = useMemo(
    () => (result ? null : explore(EXAMPLE, false, null, settings, saved)),
    [result, settings, saved],
  )
  useEffect(() => {
    if (query.trim() !== '') track('search')
  }, [query])
  // Back, Forward or a link can change the search without the box.
  useEffect(() => setText(query), [query])

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
      <div class="panel">
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
          <SearchInput
            id="best-for"
            type="search"
            list="suggestions"
            placeholder="Store or category"
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
            onClear={() => setText('')}
          />
          <button type="submit">Compare</button>
        </form>
        <div class="chips" role="list">
          {QUICK.map((q) => (
            <button
              type="button"
              role="listitem"
              class={
                q.toLowerCase() === query.toLowerCase() ? 'chip on' : 'chip'
              }
              key={q}
              onClick={() => ask(q)}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
      {!result && example ? (
        <Example
          result={example}
          onOpen={() => {
            track('example-search')
            ask(EXAMPLE)
          }}
        />
      ) : null}
      {filters}

      <div aria-live="polite">
        {result ? (
          <section
            class="results"
            // A new question arrives; changing how you pay updates it in place.
            key={query}
          >
            <h3>
              {noteOnly(result)
                ? capitalize(title(result))
                : `Best cards for ${title(result)}`}
              {splitPurchaseText(query).amount !== null ? (
                <span class="muted">
                  {' '}
                  · {money(splitPurchaseText(query).amount ?? 0)}
                </span>
              ) : null}
              {abroad ? <span class="muted">{ABROAD_NOTE}</span> : null}
              {payment ? (
                <span class="muted">{payingNote(payment)}</span>
              ) : null}
              {result.merchant.source !== 'category' &&
              result.merchant.source !== 'none' ? (
                <span class="muted">
                  {' '}
                  · codes as {categoryPhrase(catalog, result.merchant.category)}
                </span>
              ) : null}
            </h3>
            {result.categoryNote ? (
              <p class="callout">{result.categoryNote}</p>
            ) : null}
            {result.warnings.map((w) => (
              <p class="callout" key={w}>
                {w}
              </p>
            ))}
            {result.ranked.length === 0 && !noteOnly(result) ? (
              <p class="callout">
                No card matches your filters. Open Filters and memberships to
                widen them.
              </p>
            ) : null}
            <PayingHints
              answer={result}
              onPick={(payment) => onPurchase({ ...purchase, payment })}
            />
            {result.credits.length > 0 ? (
              <>
                <h4 class="credit-group">{CREDIT_GROUP}</h4>
                <ul class="result-list">
                  {result.credits.map((c) => (
                    <CreditRow pick={c} key={`${c.cardId} ${c.creditId}`} />
                  ))}
                </ul>
                <h4 class="credit-group">By rate</h4>
              </>
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
            {membersOnlyLines(
              catalog,
              all ? result.membersOnly : topOf(result, TOP).membersOnly,
              (e) => shortName(e.cardId),
            ).map((m) => (
              <p class="muted small" key={m}>
                {m}
              </p>
            ))}
            <Excluded r={result} />
            {result.assumptions.length > 0 ? (
              <ul class="assumptions">
                {result.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
            {noteOnly(result) ? null : (
              <NextSteps hasCards={hasCards} onWallet={onWallet} />
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}
