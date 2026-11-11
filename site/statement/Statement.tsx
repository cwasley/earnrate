import { useEffect, useId, useMemo, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import { HALF_CENT } from '../../src/engine/compare.ts'
import { localToday } from '../../src/engine/periods.ts'
import { searchCards } from '../../src/engine/setup.ts'
import {
  categoryAs,
  dollarsAndCents,
  listed,
  pointValuesText,
  roundCents,
  shortDate,
  wholeDollars,
} from '../../src/engine/text.ts'
import { cardValuation } from '../../src/engine/valuation.ts'
import type { CardLine } from '../../src/import/analyze.ts'
import type { Issuer } from '../../src/import/statement.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { CardArt } from '../app/CardArt.tsx'
import { cards, issuerName, shortName } from '../app/format.ts'
import { QUICK_CARDS } from '../app/quick-cards.ts'
import { QuickCards } from '../app/QuickCards.tsx'
import { loadWallet } from '../app/saved-wallet.ts'
import { SearchInput } from '../app/SearchInput.tsx'
import {
  checkWallet,
  LEFT_OUT,
  readStatement,
  refusal,
  runCheck,
  savedCards,
  yearlyPace,
  type Check,
  type ReadFile,
} from './check.ts'

type LoadedFile = ReadFile & {
  key: number
  name: string
  cardId: string | null
}

const ACCEPT =
  '.csv,text/csv,.pdf,application/pdf,.xls,.xlsx,.qfx,.qif,.qbo,.ofx'
const SHOWN_STORES = 10

const plural = (n: number, one: string, many = `${one}s`) =>
  `${String(n)} ${n === 1 ? one : many}`

const issuerCards = (issuer: Issuer, ids: string[]) =>
  [...new Set(ids)].filter((id) => cards.get(id)?.issuer === issuer)

let nextKey = 1

export function StatementCheck() {
  // Read once; the page never writes to the browser's storage.
  const [{ saved, unreadable }] = useState(() => {
    const raw = loadWallet()
    const saved = savedCards(catalog, raw)
    return { saved, unreadable: raw !== null && saved === null }
  })
  const [files, setFiles] = useState<LoadedFile[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setSettled(true))
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const today = localToday()
  const fileCards = files.flatMap((f) => (f.cardId ? [f.cardId] : []))
  const wallet = checkWallet(saved, picked, fileCards)
  const nameOf = (id: string) =>
    wallet.cards.find((c) => c.id === id)?.checkout_label ?? shortName(id)
  const entries: CardLine[] = files.flatMap((f) =>
    f.cardId ? f.lines.map((line) => ({ cardId: f.cardId ?? '', line })) : [],
  )
  const check = useMemo(
    () =>
      entries.length > 0 ? runCheck(catalog, wallet, entries, today) : null,
    [files, picked, saved, today],
  )

  const choose = async (list: FileList | null) => {
    const found: string[] = []
    const added: LoadedFile[] = []
    for (const file of list ? [...list] : []) {
      const refused = refusal(file)
      if (refused) {
        found.push(`${file.name}: ${refused}`)
        continue
      }
      const read = readStatement(await file.text())
      if (typeof read === 'string') {
        found.push(`${file.name}: ${read}`)
        continue
      }
      const same = JSON.stringify(read.lines)
      if (
        [...files, ...added].some(
          (f) => f.issuer === read.issuer && JSON.stringify(f.lines) === same,
        )
      ) {
        found.push(`${file.name}: That file is already on the page.`)
        continue
      }
      added.push({ ...read, key: nextKey++, name: file.name, cardId: null })
    }
    setProblems(found)
    if (added.length > 0) setFiles((now) => [...now, ...added])
  }

  const setCard = (key: number, cardId: string) =>
    setFiles((now) => now.map((f) => (f.key === key ? { ...f, cardId } : f)))

  return (
    <div class={settled ? 'check settled' : 'check'}>
      <section class="panel" aria-labelledby="choose-title">
        <h2 id="choose-title">
          {files.length === 0 ? 'Choose an activity file' : 'Add another file'}
        </h2>
        <p>
          {files.length === 0
            ? "A CSV file of one card's activity, downloaded from American Express or Chase."
            : "Another card's activity, or more of the same card's, to see them together."}
        </p>
        <div class="row-buttons">
          <label class="file-button primary">
            Choose a CSV file
            <input
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(e) => {
                const input = e.currentTarget
                void choose(input.files).then(() => {
                  input.value = ''
                })
              }}
            />
          </label>
        </div>
        {problems.map((p) => (
          <p class="callout" role="alert" key={p}>
            {p}
          </p>
        ))}
        <p class="muted small">
          On your card's website, download your activity (sometimes called
          transactions) and choose CSV. A PDF statement won't be read.
        </p>
      </section>

      {files.map((f) => (
        <FilePanel
          key={f.key}
          file={f}
          options={issuerCards(
            f.issuer,
            saved
              ? [...saved.cards.map((c) => c.id), ...fileCards]
              : [...QUICK_CARDS, ...picked, ...fileCards],
          )}
          saved={saved}
          nameOf={nameOf}
          onCard={(id) => setCard(f.key, id)}
          onForget={() => {
            setFiles((now) => now.filter((x) => x.key !== f.key))
            setProblems([])
          }}
        />
      ))}

      {files.length > 0 ? (
        saved ? (
          <section class="panel arrive" aria-labelledby="cards-title">
            <h2 id="cards-title">Your cards</h2>
            <p>
              The check compares the {plural(saved.cards.length, 'card')} in My
              wallet on this browser:{' '}
              {listed(saved.cards.map((c) => nameOf(c.id)))}. It reads them and
              changes nothing.
            </p>
          </section>
        ) : (
          <section class="panel arrive" aria-labelledby="cards-title">
            <h2 id="cards-title">Your other cards</h2>
            <p>
              Tap the cards you have, and the check works out which of them
              would have earned the most for each purchase. They're kept on this
              page only: nothing is saved, and they're gone when you leave.
            </p>
            {unreadable ? (
              <p class="muted small">
                The wallet saved in this browser couldn't be read, so it isn't
                used here.
              </p>
            ) : null}
            <QuickCards
              wallet={{ valuations: {}, memberships: [], cards: wallet.cards }}
              added={picked}
              keptLabel="From your file"
              onAdd={(id) => setPicked((now) => [...now, id])}
              onRemove={(id) => setPicked((now) => now.filter((x) => x !== id))}
            />
            <p class="quick-search-lead">
              Not here? Find any of the {catalog.cards.length} cards earnrate
              knows.
            </p>
            <CardFinder
              taken={wallet.cards.map((c) => c.id)}
              action="Add"
              onPick={(id) => setPicked((now) => [...now, id])}
            />
          </section>
        )
      ) : null}

      {check ? (
        <Result check={check} wallet={wallet} saved={saved} nameOf={nameOf} />
      ) : null}
    </div>
  )
}

function FilePanel({
  file,
  options,
  saved,
  nameOf,
  onCard,
  onForget,
}: {
  file: LoadedFile
  options: string[]
  saved: Wallet | null
  nameOf: (id: string) => string
  onCard: (id: string) => void
  onForget: () => void
}) {
  const id = useId()
  const issuer = issuerName(file.issuer)
  const purchases = file.lines.filter((l) => l.amount > 0)
  const refunds = file.lines.length - purchases.length
  const skipped = file.rows - file.lines.length
  const dates = file.lines.map((l) => l.date).sort()
  const notHeld =
    saved !== null &&
    file.cardId !== null &&
    !saved.cards.some((c) => c.id === file.cardId)
  return (
    <section class="panel arrive" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{issuer} activity</h2>
      <p class="muted small file-name">{file.name}</p>
      <p>
        earnrate read {plural(purchases.length, 'purchase')}
        {refunds > 0
          ? ` and ${plural(refunds, 'refund or credit', 'refunds or credits')}`
          : ''}
        {dates.length > 0
          ? `, from ${shortDate(dates[0] ?? '')} to ${shortDate(dates.at(-1) ?? '')}`
          : ''}
        .
      </p>
      <p>
        {`It read ${plural(file.read.length, 'column')}: ${listed(file.read)}.`}
        {file.read.includes('Type')
          ? ' Type tells purchases from payments.'
          : ''}
        {file.ignored.length > 0
          ? ` It ignored the file's other columns and kept nothing from them: ${listed(file.ignored)}.`
          : ''}
      </p>
      {skipped > 0 ? (
        <p>
          It left out {plural(skipped, 'other row')}: {LEFT_OUT[file.issuer]}.
        </p>
      ) : null}
      {file.lines.length > 0 ? (
        <details class="lines">
          <summary>The {plural(file.lines.length, 'line')} it read</summary>
          {file.issuer === 'chase' ? (
            <p class="muted small">
              Chase lists purchases as negative amounts; here they're positive,
              and refunds negative.
            </p>
          ) : null}
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col" class="num">
                    Amount
                  </th>
                  <th scope="col">Category</th>
                </tr>
              </thead>
              <tbody>
                {file.lines.map((l, i) => (
                  <tr key={i}>
                    <td class="date">{shortDate(l.date)}</td>
                    <td>{l.description}</td>
                    <td class="num">{dollarsAndCents(l.amount)}</td>
                    <td class="category">{l.issuerCategory ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : (
        <p class="callout">There are no purchases in this file to check.</p>
      )}
      {file.lines.length > 0 ? (
        <fieldset class="which">
          <legend>Which card is this file from?</legend>
          {options.length > 0 ? (
            <div class="chips">
              {options.map((cardId) => (
                <button
                  type="button"
                  key={cardId}
                  class={file.cardId === cardId ? 'chip on' : 'chip'}
                  aria-pressed={file.cardId === cardId}
                  onClick={() => onCard(cardId)}
                >
                  {nameOf(cardId)}
                </button>
              ))}
            </div>
          ) : saved ? (
            <p class="muted small">
              None of the cards in My wallet are {issuer} cards.
            </p>
          ) : null}
          {notHeld ? (
            <p class="muted small">
              It isn't in My wallet, so it's added for this check only. My
              wallet stays as it is.
            </p>
          ) : null}
          <CardFinder
            issuer={file.issuer}
            placeholder={`Another ${issuer} card`}
            taken={options}
            action="Choose"
            onPick={onCard}
          />
        </fieldset>
      ) : null}
      <div class="row-buttons">
        <button type="button" onClick={onForget}>
          Forget this file
        </button>
      </div>
      <p class="muted small">
        Forget this file drops it and everything read from it. Reloading or
        closing the page does the same.
      </p>
    </section>
  )
}

function CardFinder({
  issuer,
  placeholder = 'Find a card, like Sapphire',
  taken,
  action,
  onPick,
}: {
  issuer?: Issuer
  placeholder?: string
  taken: string[]
  action: string
  onPick: (cardId: string) => void
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const found = useMemo(
    () =>
      query.trim().length < 2
        ? []
        : searchCards(catalog, query, null, localToday())
            .cards.filter((c) => issuer === undefined || c.issuer === issuer)
            .slice(0, 6),
    [query, issuer],
  )
  return (
    <div class="finder">
      <label class="visually-hidden" for={id}>
        {placeholder}
      </label>
      <SearchInput
        id={id}
        class="search"
        type="search"
        placeholder={placeholder}
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
              <span>
                {shortName(c.id)}
                <span class="muted"> · {issuerName(c.issuer)}</span>
              </span>
            </span>
            {taken.includes(c.id) && action === 'Add' ? (
              <span class="muted">Added</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onPick(c.id)
                  setQuery('')
                }}
              >
                {action}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Result({
  check,
  wallet,
  saved,
  nameOf,
}: {
  check: Check
  wallet: Wallet
  saved: Wallet | null
  nameOf: (id: string) => string
}) {
  const a = check.analysis
  if (a.purchases === 0) return null
  const one = a.byCard.length === 1 ? a.byCard[0] : undefined
  const gain = roundCents(a.best - a.earned)
  const pace = yearlyPace(a)
  const shown = a.missed.slice(0, SHOWN_STORES)
  const rest = a.missed.slice(SHOWN_STORES)
  const values = pointValuesText(
    catalog,
    [
      ...a.byCard.map((t) => t.cardId),
      ...a.missed.map((m) => m.bestCardId),
    ].flatMap((id) => {
      const card = cards.get(id)
      return card ? [cardValuation(catalog, wallet, card)] : []
    }),
  )
  const unknownCount = check.unknown.reduce((n, s) => n + s.count, 0)
  const unknownSpend = roundCents(
    check.unknown.reduce((n, s) => n + s.spend, 0),
  )
  const missedItem = (m: (typeof a.missed)[number]) => (
    <li key={`${m.merchant}|${m.usedCardId}|${m.bestCardId}`}>
      <span class="store">{m.merchant}</span>
      <span class="muted">
        {' '}
        · {plural(m.count, 'purchase')}, {dollarsAndCents(m.spend)}
        {one ? '' : ` on ${nameOf(m.usedCardId)}`}
      </span>
      <br />
      Use <b>{nameOf(m.bestCardId)}</b>: about {dollarsAndCents(m.best)} instead
      of {dollarsAndCents(m.earned)} (+
      {dollarsAndCents(roundCents(m.best - m.earned))}).
      {m.categoryFromStatement ? (
        <span class="row-note">
          earnrate doesn't know this store, so this goes by the statement's
          category.
        </span>
      ) : null}
    </li>
  )
  return (
    <section class="panel arrive check-result" aria-labelledby="result-title">
      <h2 id="result-title">What these purchases earned</h2>
      <p>
        {plural(a.purchases, 'purchase')}, {dollarsAndCents(a.spend)}, from{' '}
        {shortDate(a.from)} to {shortDate(a.to)}.
        {a.refunds > 0
          ? ` Refunds and credits came to ${dollarsAndCents(a.refunds)}; they aren't counted here.`
          : ''}
      </p>
      <dl class="facts">
        <div>
          <dt>
            {one
              ? `Earned on ${nameOf(one.cardId)}`
              : 'Earned on the cards you used'}
          </dt>
          <dd>about {dollarsAndCents(a.earned)}</dd>
        </div>
        <div>
          <dt>With the best of your cards for each purchase</dt>
          <dd>about {dollarsAndCents(a.best)}</dd>
        </div>
        <div>
          <dt>Difference</dt>
          <dd>
            {Math.abs(gain) <= HALF_CENT
              ? 'none'
              : gain > 0
                ? `${dollarsAndCents(gain)} more`
                : dollarsAndCents(gain)}
          </dd>
        </div>
      </dl>
      {pace !== null ? (
        <p class="pace">At this pace, about {wholeDollars(pace)} a year.</p>
      ) : null}
      {one ? null : (
        <ul class="by-card">
          {a.byCard.map((t) => (
            <li key={t.cardId}>
              {nameOf(t.cardId)}: {plural(t.purchases, 'purchase')},{' '}
              {dollarsAndCents(t.spend)}, earned about{' '}
              {dollarsAndCents(t.earned)}
            </li>
          ))}
        </ul>
      )}
      <p class="muted small">
        {values
          ? `${values} ${saved ? 'These are the values My wallet uses.' : "These are earnrate's values."} `
          : ''}
        Each card is counted at its rewards rates. Statement credits, welcome
        bonuses and yearly spend bonuses aren't included.{' '}
        {saved
          ? "Spending caps start empty at the file's first purchase: the totals and bonus progress saved in My wallet describe today and may already include these purchases."
          : "Spending caps start empty at the file's first purchase."}
      </p>

      {a.missed.length > 0 ? (
        <>
          <h3>Where another of your cards would have earned more</h3>
          <ul class="stores">{shown.map(missedItem)}</ul>
          {rest.length > 0 ? (
            <details>
              <summary>{plural(rest.length, 'more store')}</summary>
              <ul class="stores">{rest.map(missedItem)}</ul>
            </details>
          ) : null}
        </>
      ) : (
        <p>For every purchase, the card you used was the best of your cards.</p>
      )}

      {check.unknown.length > 0 ? (
        <>
          <h3>Stores earnrate didn't recognize</h3>
          <p>
            {plural(check.unknown.length, 'store')}, with{' '}
            {plural(unknownCount, 'purchase')} ({dollarsAndCents(unknownSpend)}
            ). earnrate counted each by the category on the statement, the way
            the issuer coded it, and as an everyday purchase where that category
            doesn't say what kind of store it is. Another issuer may code the
            same store differently.
          </p>
          <details>
            <summary>How each was counted</summary>
            <ul class="stores">
              {check.unknown.map((s) => (
                <li key={s.name}>
                  <span class="store">{s.name}</span>
                  <span class="muted">
                    {' '}
                    · {plural(s.count, 'purchase')}, {dollarsAndCents(s.spend)}
                  </span>
                  <br />
                  Counted {categoryAs(catalog, s.category ?? 'other')}
                  {s.issuerCategory
                    ? ` (the statement says ${s.issuerCategory})`
                    : ''}
                  .
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}

      {a.coding.length > 0 ? (
        <>
          <h3>Stores the statement coded differently than earnrate expects</h3>
          <p>
            earnrate counted these the way it expects the store to code. If your
            issuer keeps coding them as this statement does, what a card earns
            there may differ. <a href="/support">Tell us</a> if earnrate has a
            store wrong.
          </p>
          <ul class="stores">
            {a.coding.map((c) => (
              <li key={c.merchant}>
                <span class="store">{c.merchant}</span>: earnrate counts it{' '}
                {categoryAs(catalog, c.earnrateCategory)}; the statement says{' '}
                {c.issuerCategory} ({plural(c.count, 'purchase')}).
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {a.notTaken.length > 0 ? (
        <>
          <h3>Stores earnrate has down as not taking your card</h3>
          <p>
            earnrate's data says these stores don't take the card you used, but
            your statement shows they did, so these purchases count with what
            that card earned. <a href="/support">Tell us</a> so we can correct
            the store.
          </p>
          <ul class="stores">
            {a.notTaken.map((n) => (
              <li key={`${n.merchant}|${n.cardId}`}>
                <span class="store">{n.merchant}</span>
                <span class="muted">
                  {' '}
                  · {plural(n.count, 'purchase')}, {dollarsAndCents(n.spend)} on{' '}
                  {nameOf(n.cardId)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
