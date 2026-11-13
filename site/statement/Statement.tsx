import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import { localToday } from '../../src/engine/periods.ts'
import { searchCards } from '../../src/engine/setup.ts'
import { dollarsAndCents, listed, shortDate } from '../../src/engine/text.ts'
import { effectiveMemberships } from '../../src/engine/memberships.ts'
import type { CardLine } from '../../src/import/analyze.ts'
import {
  bestCardsWork,
  type BestCards as BestCardsResult,
} from '../../src/import/best-cards.ts'
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
  dateRange,
  LEFT_OUT,
  readStatement,
  refusal,
  runCheck,
  savedCards,
  type ReadFile,
} from './check.ts'
import { BestCards } from './BestCards.tsx'
import { Result } from './Result.tsx'

type LoadedFile = ReadFile & {
  key: number
  name: string
  cardId: string | null
}

const ACCEPT =
  '.csv,text/csv,.pdf,application/pdf,.xls,.xlsx,.qfx,.qif,.qbo,.ofx'

const plural = (n: number, one: string, many = `${one}s`) =>
  `${String(n)} ${n === 1 ? one : many}`

const issuerCards = (issuer: Issuer, ids: string[]) =>
  [...new Set(ids)].filter((id) => cards.get(id)?.issuer === issuer)

let nextKey = 1

// Under a frame at a phone's speed.
const SLICE_MS = 12

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
  // Cards tapped in change the answer only through a membership they imply.
  const implied = effectiveMemberships(
    catalog,
    wallet.memberships,
    wallet.cards.map((c) => c.id),
  ).join()
  // Every card's replay runs a few milliseconds at a time after the answer
  // shows, so a slow phone keeps responding. A worker would need the page's
  // policy to allow one.
  const [best, setBest] = useState<BestCardsResult | null>(null)
  useEffect(() => {
    setBest(null)
    if (entries.length === 0) return
    const work = bestCardsWork(catalog, wallet, entries)
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      const until = performance.now() + SLICE_MS
      while (performance.now() < until) {
        const step = work.next()
        if (step.done) {
          setBest(step.value)
          return
        }
      }
      timer = setTimeout(run, 0)
    }
    timer = setTimeout(run, 0)
    return () => clearTimeout(timer)
  }, [files, saved, implied])

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

  // A file still waiting for its card keeps the files on top; once each
  // has one, the answer leads and the files fold to a line each, and the
  // page goes to the answer rather than leave the visitor below it.
  const waiting = files.some((f) => f.cardId === null && f.lines.length > 0)
  const top = useRef<HTMLDivElement>(null)
  const wasWaiting = useRef(false)
  useEffect(() => {
    if (wasWaiting.current && !waiting && files.length > 0)
      top.current?.scrollIntoView({ block: 'start' })
    wasWaiting.current = waiting
  }, [waiting])

  const fileInput = (primary: boolean, label: string) => (
    <label class={primary ? 'file-button primary' : 'file-button'}>
      {label}
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
  )
  const problemLines = problems.map((p) => (
    <p class="callout" role="alert" key={p}>
      {p}
    </p>
  ))

  if (files.length === 0)
    return (
      <div class={settled ? 'check settled' : 'check'}>
        <section class="panel" aria-labelledby="choose-title">
          <h2 id="choose-title">Choose an activity file</h2>
          <p>
            A CSV file of one card's activity, downloaded from American Express
            or Chase.
          </p>
          <div class="row-buttons">{fileInput(true, 'Choose a CSV file')}</div>
          {problemLines}
          <p class="muted small">
            On your card's website, download your activity (sometimes called
            transactions) and choose CSV. A PDF statement won't be read.
          </p>
          <WhereToFind />
        </section>
      </div>
    )

  const filesPart = (
    <section class="panel arrive" aria-labelledby="files-title">
      <h2 id="files-title">
        {files.length === 1 ? 'Your file' : 'Your files'}
      </h2>
      <ul class="file-list">
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
      </ul>
      {saved ? (
        <p class="muted small">
          Compared with the {plural(saved.cards.length, 'card')} in My wallet:{' '}
          {listed(saved.cards.map((c) => nameOf(c.id)))}.
        </p>
      ) : unreadable ? (
        <p class="muted small">
          The wallet saved in this browser couldn't be read, so it isn't used
          here.
        </p>
      ) : null}
      <div class="row-buttons">{fileInput(false, 'Add another file')}</div>
      {problemLines}
    </section>
  )
  const otherCards = saved ? null : (
    <section class="panel arrive" aria-labelledby="cards-title">
      <h2 id="cards-title">Your other cards</h2>
      <p>Tap the cards you have.</p>
      <QuickCards
        wallet={{ valuations: {}, memberships: [], cards: wallet.cards }}
        added={picked}
        keptLabel="From your file"
        onAdd={(id) => setPicked((now) => [...now, id])}
        onRemove={(id) => setPicked((now) => now.filter((x) => x !== id))}
      />
      <p class="quick-search-lead">
        Not here? Find any of the {catalog.cards.length} cards earnrate knows.
      </p>
      <CardFinder
        taken={wallet.cards.map((c) => c.id)}
        action="Add"
        onPick={(id) => setPicked((now) => [...now, id])}
      />
    </section>
  )

  return (
    <div class={settled ? 'check settled' : 'check'} ref={top}>
      {waiting ? filesPart : null}
      {check ? (
        <Result check={check} wallet={wallet} saved={saved} nameOf={nameOf} />
      ) : null}
      {otherCards}
      {check && best ? (
        <BestCards best={best} analysis={check.analysis} />
      ) : null}
      {waiting ? null : filesPart}
    </div>
  )
}

function WhereToFind() {
  return (
    <details class="where">
      <summary>Where to find the file</summary>
      <ul class="muted small">
        <li>
          <strong>American Express.</strong> Sign in and open your statements at{' '}
          <a href="https://global.americanexpress.com/activity/statements">
            global.americanexpress.com/activity/statements
          </a>
          . Choose Download on a monthly or yearly statement, pick CSV, and tick
          “Include all additional transaction details”. That box adds the
          category earnrate reads; the merchant addresses that come with it are
          ignored.
        </li>
        <li>
          <strong>Chase.</strong> Sign in on a computer and open the download
          page at{' '}
          <a href="https://secure.chase.com/web/auth/dashboard#/dashboard/accountDetails/downloadAccountTransactions/index">
            secure.chase.com
          </a>
          . Set the file type to “Spreadsheet (Excel, CSV)”. Chase says the CSV
          download is on its website from a computer, and that on a phone it
          gives PDFs.
        </li>
      </ul>
      <p class="muted small">
        Checked in signed-in accounts on November 11, 2026. The issuers' own
        notes:{' '}
        <a href="https://www.americanexpress.com/us/customer-service/faq.download-export-transactions-software.html">
          American Express
        </a>
        ,{' '}
        <a href="https://www.chase.com/personal/banking/education/budgeting-saving/what-is-chase-spending-planner">
          Chase
        </a>
        .
      </p>
    </details>
  )
}

// A file with its card is one line, its details a tap away; a file still
// waiting for its card shows them, with the question.
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
  const [open, setOpen] = useState(false)
  const issuer = issuerName(file.issuer)
  const purchases = file.lines.filter((l) => l.amount > 0)
  const refunds = file.lines.length - purchases.length
  const skipped = file.rows - file.lines.length
  const dates = file.lines.map((l) => l.date).sort()
  const notHeld =
    saved !== null &&
    file.cardId !== null &&
    !saved.cards.some((c) => c.id === file.cardId)
  const waiting = file.cardId === null && file.lines.length > 0
  const shown = waiting || open
  return (
    <li class="file arrive" aria-labelledby={`${id}-title`}>
      <p class="file-line">
        <strong id={`${id}-title`}>
          {file.cardId === null ? `${issuer} activity` : nameOf(file.cardId)}
        </strong>
        <span class="muted small file-name">
          {file.name} · {plural(purchases.length, 'purchase')}
          {dates.length > 0
            ? ` · ${dateRange(dates[0] ?? '', dates.at(-1) ?? '')}`
            : ''}
        </span>
      </p>
      <div class="row-buttons file-buttons">
        {waiting ? null : (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Hide details' : 'Details'}
          </button>
        )}
        <button type="button" onClick={onForget}>
          Forget this file
        </button>
      </div>
      {file.lines.length === 0 ? (
        <p class="callout">There are no purchases in this file to check.</p>
      ) : shown ? (
        <>
          {file.cardId !== null && refunds > 0 ? (
            <p class="muted small">
              {plural(refunds, 'refund')} too, which aren't counted.
            </p>
          ) : null}
          <details class="lines">
            <summary>What it read, line by line</summary>
            <p>
              {`It read ${listed(file.read)}.`}
              {file.read.includes('Type')
                ? ' Type tells purchases from payments.'
                : ''}
              {file.ignored.length > 0
                ? ` It ignored the file's other columns and kept nothing from them: ${listed(file.ignored)}.`
                : ''}
            </p>
            {skipped > 0 ? (
              <p>
                It left out {plural(skipped, 'other row')}:{' '}
                {LEFT_OUT[file.issuer]}.
              </p>
            ) : null}
            {file.issuer === 'chase' ? (
              <p class="muted small">
                Chase lists purchases as negative amounts; here they're
                positive, and refunds negative.
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
                    onClick={() => {
                      onCard(cardId)
                      setOpen(false)
                    }}
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
            <CardFinder
              issuer={file.issuer}
              placeholder={`Another ${issuer} card`}
              taken={options}
              action="Choose"
              onPick={(cardId) => {
                onCard(cardId)
                setOpen(false)
              }}
            />
          </fieldset>
        </>
      ) : null}
      {notHeld ? (
        <p class="muted small">
          Not in My wallet, so counted for this check only.
        </p>
      ) : null}
    </li>
  )
}

function CardFinder({
  issuer,
  placeholder = 'Add a card, like Sapphire',
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
