import { Fragment, type ComponentChildren } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
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
import { walletProblems } from '../../src/data/integrity.ts'
import type { MerchantResolution } from '../../src/engine/types.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { askWallet, Assumes, WalletAnswer } from './WalletAnswer.tsx'
import {
  resolvePlace,
  splitPurchaseText,
  withCallerCategory,
} from '../../src/merchants/resolve.ts'
import { ABROAD, noteOnly } from '../../src/engine/recommend.ts'
import {
  capitalize,
  CATEGORY_CARDS_LEAD,
  categoryCards,
  categoryAs,
  categoryPhrase,
  CREDIT_GROUP,
  CREDIT_PERIODS,
  ENROLL_FIRST,
  hostname,
  money,
} from '../../src/engine/text.ts'
import { CardPicker } from './AddCards.tsx'
import { addOp, removeOp, type Outcome, type WalletOp } from './sync.ts'
import {
  cardCount,
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
import { PlaceKinds } from './PlaceKinds.tsx'
import { kindCategory } from './place-kinds.ts'
import { engineOptions, type Saved, type Settings } from './settings.ts'
import {
  EVERYDAY_PURCHASES,
  quickPickText,
} from '../../src/engine/cheat-sheet.ts'

const QUICK = EVERYDAY_PURCHASES.map(quickPickText)

const TOP = 8
// Below this width the search, chips and filters fill the first screen, so
// a search the visitor runs scrolls its answer up to the top.
const SMALL = '(max-width: 639px)'
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
  merchant: string,
  amount: number | null,
  abroad: boolean,
  payment: PaymentMethod | null,
  settings: Settings,
  saved: Saved,
  kind: string | null = null,
): Exploration {
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
    kind === null
      ? undefined
      : withCallerCategory(
          resolvePlace(catalog, merchant, null),
          kindCategory(kind),
        ),
  )
}

function title(m: MerchantResolution): string {
  if (m.source === 'category') return categoryPhrase(catalog, m.category)
  return m.source === 'none' ? `“${m.input}”` : m.resolvedName
}

// A card the visitor holds says so in data-*, never a class: Cloudflare's
// analytics reports the element path behind its speed figures.
function CardRow({
  entry,
  rank,
  held,
}: {
  entry: ExploreEntry
  rank: number
  held: boolean
}) {
  const card = cards.get(entry.cardId)
  const upgrade = entry.withMembership[0]
  return (
    <li class="result" data-held={held ? '' : undefined}>
      <div class="result-top">
        <span class="rank">{rank}</span>
        <CardArt id={entry.cardId} />
        <div class="result-name">
          <strong>
            {shortName(entry.cardId)}
            {held ? <span data-yours="">Yours</span> : null}
          </strong>
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
        <p class="muted small">
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
        <p class="callout" key={reason}>
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
        For example, {title(result.merchant).toLowerCase()}
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
        Rank all {result.ranked.length} personal cards
      </button>
    </section>
  )
}

export type Scope = 'yours' | 'every'

const SCOPES: { scope: Scope; label: string }[] = [
  { scope: 'every', label: 'Every card' },
  { scope: 'yours', label: 'Your cards' },
]

// Which cards an answer ranks. The choice is the visitor's, so it lives in
// the checked input, never a class.
function ScopeSwitch({
  scope,
  onScope,
}: {
  scope: Scope
  onScope: (scope: Scope) => void
}) {
  return (
    <div class="segments scope" role="radiogroup" aria-label="Which cards">
      {SCOPES.map((s) => (
        <label key={s.scope}>
          <input
            type="radio"
            name="best-scope"
            checked={scope === s.scope}
            onChange={() => onScope(s.scope)}
          />
          {s.label}
        </label>
      ))}
    </div>
  )
}

function NextSteps({
  addCards,
  onAdd,
}: {
  addCards: boolean
  onAdd: () => void
}) {
  return (
    <div class="next-steps">
      {addCards ? (
        <p>
          Have some of these?{' '}
          <button
            type="button"
            class="link"
            onClick={() => {
              track('cta-save-cards')
              onAdd()
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

// Your cards before any are saved: they go in here, in place of the search,
// which comes back at Done.
function AddYours({
  wallet,
  waiting,
  synced,
  locked,
  lockNote,
  perform,
  onAdded,
  onDone,
}: {
  wallet: Wallet | null
  // A store asked about before any cards were in.
  waiting: string | null
  synced: boolean
  locked: boolean
  lockNote: string | null
  perform: (op: WalletOp) => Promise<Outcome>
  onAdded: () => void
  onDone: () => void
}) {
  // Only cards added here can be tapped back out here.
  const [added, setAdded] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const count = wallet?.cards.length ?? 0
  const add = async (cardId: string) => {
    onAdded()
    const result = await perform(addOp(cardId))
    setError(result.ok ? null : result.error)
    if (result.ok)
      setAdded((ids) => (ids.includes(cardId) ? ids : [...ids, cardId]))
    return result.ok
  }
  const remove = async (cardId: string) => {
    if (!added.includes(cardId)) return
    const result = await perform(removeOp(cardId))
    setError(result.ok ? null : result.error)
  }
  return (
    <section class="add-yours" aria-labelledby="add-yours-title">
      <h3 id="add-yours-title">Which cards do you have?</h3>
      <p>
        Tap the ones you have, and earnrate picks the one to use
        {waiting === null ? ' at each store' : ` at ${waiting}`}.{' '}
        {synced
          ? "They're saved in your Claude wallet too: never a card number."
          : 'They stay in this browser: no account, and never a card number.'}
      </p>
      <CardPicker
        wallet={wallet}
        added={added}
        locked={locked}
        onAdd={add}
        onRemove={(cardId) => void remove(cardId)}
      />
      {error !== null ? (
        <p class="callout">{error}</p>
      ) : locked && lockNote !== null ? (
        <p class="muted">{lockNote}</p>
      ) : null}
      {count === 0 ? null : (
        <div class="quick-done">
          <span>{cardCount(count)} in your wallet</span>
          <button type="button" class="primary" onClick={onDone}>
            Done
          </button>
        </div>
      )}
    </section>
  )
}

export function BestFor({
  settings,
  saved,
  wallet,
  filters,
  purchase,
  onPurchase,
  query,
  onQuery,
  scope,
  onScope,
  focus,
  perform,
  synced,
  locked,
  lockNote,
}: {
  settings: Settings
  saved: Saved
  wallet: Wallet | null
  filters: ComponentChildren
  purchase: Purchase
  onPurchase: (p: Purchase) => void
  query: string
  onQuery: (q: string) => void
  scope: Scope
  onScope: (scope: Scope) => void
  // A store page's "Check with your own cards" opened this answer.
  focus: boolean
  perform: (op: WalletOp) => Promise<Outcome>
  synced: boolean
  locked: boolean
  lockNote: string | null
}) {
  const [text, setText] = useState(query)
  const [all, setAll] = useState(false)
  // A kind of place picked for a store earnrate doesn't know, for this
  // search only.
  const [picked, setPicked] = useState<{ query: string; kind: string } | null>(
    null,
  )
  const kind = picked?.query === query ? picked.kind : null
  const { abroad, payment } = purchase
  const yours = scope === 'yours'
  const hasCards = (wallet?.cards.length ?? 0) > 0
  // From the first card added under Your cards until Done.
  const [adding, setAdding] = useState(false)
  const adder = yours && (!hasCards || adding)
  const problems = useMemo(
    () => (wallet ? walletProblems(wallet, catalog) : []),
    [wallet],
  )
  const asked = useMemo(() => splitPurchaseText(query), [query])
  const amount = asked.amount
  const empty = query.trim() === ''
  // The store a link asked about before the visitor's cards were in.
  const waiting = useMemo(() => {
    if (empty) return null
    const m = resolvePlace(catalog, asked.merchant, null)
    return m.source === 'category' || m.source === 'none'
      ? null
      : m.resolvedName
  }, [empty, asked])
  const result = useMemo(
    () =>
      yours || empty
        ? null
        : explore(
            asked.merchant,
            amount,
            abroad,
            payment,
            settings,
            saved,
            kind,
          ),
    [yours, empty, asked, amount, abroad, payment, settings, saved, kind],
  )
  const rec = useMemo(
    () =>
      !yours || adder || empty || !wallet || !hasCards || problems.length > 0
        ? null
        : askWallet(wallet, asked.merchant, amount, abroad, payment, kind),
    [
      yours,
      adder,
      empty,
      wallet,
      hasCards,
      problems,
      asked,
      amount,
      abroad,
      payment,
      kind,
    ],
  )
  const example = useMemo(
    () =>
      yours || !empty
        ? null
        : explore(EXAMPLE, null, false, null, settings, saved),
    [yours, empty, settings, saved],
  )
  const heldIds = useMemo(
    () => new Set(wallet?.cards.map((c) => c.id) ?? []),
    [wallet],
  )
  useEffect(() => {
    if (!empty) track('search')
  }, [query])
  useEffect(() => {
    if (rec) track('wallet-which-card')
  }, [rec])
  useEffect(() => {
    if (focus) track('page-check')
  }, [])
  // Back, Forward or a link can change the search without the box.
  useEffect(() => setText(query), [query])

  // Counts the searches the visitor runs (not Back, Forward, a link or the
  // tab opening), so each one can bring its answer into view.
  const [shownCount, setShownCount] = useState(focus ? 1 : 0)
  const heading = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (shownCount === 0 || !matchMedia(SMALL).matches) return
    // Closes the phone's keyboard, which would cover the answer.
    if (document.activeElement instanceof HTMLInputElement)
      document.activeElement.blur()
    heading.current?.scrollIntoView({ block: 'start' })
  }, [shownCount])

  const ask = (q: string, show = true) => {
    setText(q)
    setAll(false)
    onQuery(q)
    if (show) setShownCount((n) => n + 1)
  }

  const answer = result ?? rec
  const shown = result
    ? all
      ? result.ranked
      : result.ranked.slice(0, TOP)
    : []
  const headingText = answer
    ? noteOnly(answer)
      ? capitalize(title(answer.merchant))
      : `${yours ? 'Best of your cards' : 'Best cards'} for ${title(answer.merchant)}`
    : ''
  const kinds = answer ? (
    <PlaceKinds
      merchant={answer.merchant}
      kind={kind}
      onKind={(k) => setPicked(k === null ? null : { query, kind: k })}
    />
  ) : null
  return (
    <div>
      <div class="panel store-search" ref={panel}>
        <ScopeSwitch scope={scope} onScope={onScope} />
        {adder ? (
          <AddYours
            wallet={wallet}
            waiting={waiting}
            synced={synced}
            locked={locked}
            lockNote={lockNote}
            perform={perform}
            onAdded={() => setAdding(true)}
            onDone={() => {
              setAdding(false)
              if (!empty) setShownCount((n) => n + 1)
            }}
          />
        ) : (
          <>
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
                    SUGGESTIONS.some(
                      (s) => s.toLowerCase() === value.toLowerCase(),
                    )
                  )
                    // A suggestion picked from the list moves to the
                    // answer; one typed out in full doesn't, while the
                    // keyboard is in use.
                    ask(
                      value,
                      (e as unknown as InputEvent).inputType ===
                        'insertReplacementText',
                    )
                }}
                onClear={() => setText('')}
              />
              <button type="submit">Go</button>
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
              <a class="chip" role="listitem" href="/best/">
                Every store and category
              </a>
            </div>
            {filters}
          </>
        )}
      </div>
      {example ? (
        <Example
          result={example}
          onOpen={() => {
            track('example-search')
            ask(EXAMPLE)
          }}
        />
      ) : null}
      {yours && hasCards && problems.length > 0 ? (
        <p class="callout">
          The wallet saved in this browser has problems: {problems.join(' ')}{' '}
          Open My wallet to fix it.
        </p>
      ) : null}

      <div aria-live="polite">
        {answer ? (
          <section
            class="results"
            // A new question arrives; changing how you pay updates it in place.
            key={`${scope} ${query}`}
          >
            <h3 ref={heading}>
              {headingText}
              {amount !== null ? (
                <span class="muted"> · {money(amount)}</span>
              ) : null}
              {abroad ? <span class="muted">{ABROAD_NOTE}</span> : null}
              {payment ? (
                <span class="muted">{payingNote(payment)}</span>
              ) : null}
              {answer.merchant.source !== 'category' &&
              answer.merchant.source !== 'none' ? (
                <span class="muted">
                  {' '}
                  · counts {categoryAs(catalog, answer.merchant.category)}
                </span>
              ) : null}
            </h3>
            {rec && wallet ? (
              <WalletAnswer
                wallet={wallet}
                rec={rec}
                onPayment={(p) => onPurchase({ ...purchase, payment: p })}
                kinds={kinds}
              />
            ) : result ? (
              <>
                <Excluded r={result} />
                {result.categoryNote ? (
                  <p class="callout">{result.categoryNote}</p>
                ) : null}
                {result.categoryNote ? (
                  <NamedCards
                    ids={categoryCards(catalog, result.merchant.category)}
                  />
                ) : null}
                {result.warnings.map((w) => (
                  <p class="callout" key={w}>
                    {w}
                  </p>
                ))}
                {kinds}
                {result.ranked.length === 0 && !noteOnly(result) ? (
                  <p class="callout">
                    No card matches your filters. Open Filters and memberships
                    to widen them.
                  </p>
                ) : null}
                <PayingHints
                  answer={result}
                  onPick={(p) => onPurchase({ ...purchase, payment: p })}
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
                    <CardRow
                      entry={e}
                      rank={i + 1}
                      held={heldIds.has(e.cardId)}
                      key={e.cardId}
                    />
                  ))}
                </ol>
                {result.ranked.length > shown.length ? (
                  <button
                    type="button"
                    class="more"
                    onClick={() => setAll(true)}
                  >
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
                <Assumes lines={result.assumptions} />
              </>
            ) : null}
            {noteOnly(answer) ? null : (
              <NextSteps
                addCards={!hasCards}
                onAdd={() => {
                  onScope('yours')
                  requestAnimationFrame(() => {
                    panel.current?.scrollIntoView({ block: 'start' })
                  })
                }}
              />
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}

function NamedCards({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null
  return (
    <p>
      {CATEGORY_CARDS_LEAD}{' '}
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i === 0 ? '' : i === ids.length - 1 ? ' and ' : ', '}
          <a href={`/cards/${id}`}>{shortName(id)}</a>
        </Fragment>
      ))}
      .
    </p>
  )
}
