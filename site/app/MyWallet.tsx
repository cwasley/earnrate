import { useMemo, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import { walletProblems } from '../../src/data/integrity.ts'
import { cheatSheet } from '../../src/engine/cheat-sheet.ts'
import { categoryResolution, findCategory } from '../../src/engine/explore.ts'
import { localToday } from '../../src/engine/periods.ts'
import { recordPurchase } from '../../src/engine/record.ts'
import { categoryPhrase, recommend } from '../../src/engine/recommend.ts'
import {
  cardInfo,
  knownMemberships,
  membershipsUsed,
  searchCards,
  type SetupNote,
} from '../../src/engine/setup.ts'
import {
  resolveSpendLines,
  simulateAdditions,
} from '../../src/engine/simulate.ts'
import type { Recommendation } from '../../src/engine/types.ts'
import {
  addToWallet,
  removeFromWallet,
  updateInWallet,
  withMemberships,
  type CardInput,
  type WalletChange,
} from '../../src/engine/wallet-change.ts'
import { resolveMerchant } from '../../src/merchants/resolve.ts'
import type { Wallet, WalletCard } from '../../src/schema/wallet.ts'
import {
  cards,
  feeText,
  issuerName,
  membershipName,
  pct,
  shortName,
  usd,
  words,
} from './format.ts'
import { loadList, loadWallet, saveWallet } from './settings.ts'
import { lineFor, STARTER, type Row } from './Spending.tsx'

const QUICK = ['Groceries', 'Dining', 'Gas', 'Amazon', 'Costco', 'Travel']

// Setup notes name what to set in CLI terms; this says where on the page.
function noteText(note: SetupNote, name: string): string {
  switch (note.kind) {
    case 'pick':
      return `${name} needs its bonus category picks: tap it under Your cards.`
    case 'membership':
      return `${name} earns more with a membership: check Memberships below.`
    case 'activation':
      return `${name} has bonuses you activate with the issuer: tap it under Your cards to mark them.`
    case 'anniversary':
      return `${name} has a cap that resets on your account anniversary: tap it under Your cards to add it.`
    case 'rotation':
      return note.text
  }
}

const label = (held: WalletCard) => held.checkout_label ?? shortName(held.id)

function ask(wallet: Wallet, text: string, amount: number | null) {
  const category = findCategory(catalog, text)
  const purchase = {
    merchant: text,
    amount,
    channel: null,
    date: localToday(),
    country: 'US',
  }
  const merchant =
    category === null
      ? resolveMerchant(catalog, text, null)
      : categoryResolution(catalog, category, null)
  const rec = recommend(catalog, wallet, purchase, merchant)
  // A category asked for directly isn't an unknown merchant.
  const warnings =
    category === null
      ? rec.warnings
      : rec.warnings.filter(
          (w) => !w.includes("isn't in earnrate's merchant list"),
        )
  return { ...rec, warnings }
}

function Answer({
  wallet,
  rec,
  onRecord,
}: {
  wallet: Wallet
  rec: Recommendation
  onRecord: (cardId: string, amount: number) => void
}) {
  const [paid, setPaid] = useState('')
  const top = rec.ranked[0]
  const decided = rec.decision
  const held = wallet.cards.find((c) => c.id === decided?.cardId)
  const tracks = wallet.cards.some((h) => {
    const card = cards.get(h.id)
    return (card?.caps.length ?? 0) > 0 || card?.rules.some((r) => r.cap)
  })
  return (
    <div class="answer">
      {decided && held ? (
        <p class="verdict">
          Use <strong>{label(held)}</strong>: {pct(decided.effectiveReturnPct)}{' '}
          back
          {top?.earned !== null && top?.earned !== undefined
            ? `, about $${top.earned.toFixed(2)}`
            : ''}
          .
        </p>
      ) : (
        <p class="verdict">None of your cards work here.</p>
      )}
      {rec.warnings.map((w) => (
        <p class="callout" key={w}>
          {w}
        </p>
      ))}
      {rec.notes.map((n) => (
        <p class="muted" key={n}>
          {n}
        </p>
      ))}
      <ol class="result-list">
        {rec.ranked.slice(0, 3).map((r, i) => (
          <li class="result" key={r.cardId}>
            <div class="result-top">
              <span class="rank">{i + 1}</span>
              <div class="result-name">
                <strong>{r.checkoutLabel ?? shortName(r.cardId)}</strong>
              </div>
              <span class="rate">{pct(r.effectiveReturnPct)}</span>
            </div>
            {r.warnings.map((w) => (
              <p class="warn" key={w}>
                {w}
              </p>
            ))}
            <details>
              <summary>Why</summary>
              {r.reasoning.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </details>
          </li>
        ))}
      </ol>
      {rec.sensitivity ? <p class="muted">{rec.sensitivity}</p> : null}
      {decided && tracks ? (
        <form
          class="ask small"
          onSubmit={(e) => {
            e.preventDefault()
            const amount = Number(paid)
            if (amount > 0) {
              onRecord(decided.cardId, amount)
              setPaid('')
            }
          }}
        >
          <label class="visually-hidden" for="paid">
            Amount paid
          </label>
          <input
            id="paid"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="Paid with it? Amount"
            value={paid}
            onInput={(e) => setPaid(e.currentTarget.value)}
          />
          <button type="submit">Record</button>
        </form>
      ) : null}
      <ul class="assumptions">
        {rec.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  )
}

function CheatSheet({ wallet }: { wallet: Wallet }) {
  const sheet = useMemo(
    () => cheatSheet(catalog, wallet, localToday()),
    [wallet],
  )
  return (
    <>
      <h3>Your cheat sheet for {sheet.quarter}</h3>
      <p class="muted">The card to use for each kind of purchase right now.</p>
      <table class="cheat">
        <tbody>
          {sheet.rows.map((row) => {
            const held = wallet.cards.find((c) => c.id === row.cardId)
            return (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>
                  {held ? label(held) : 'None of your cards'}
                  {row.note ? <span class="row-note">{row.note}</span> : null}
                </td>
                <td class="rate">
                  {row.effectiveReturnPct === null
                    ? ''
                    : pct(row.effectiveReturnPct)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function CardEditor({
  wallet,
  held,
  onChange,
}: {
  wallet: Wallet
  held: WalletCard
  onChange: (change: WalletChange, cardId: string) => void
}) {
  const card = cards.get(held.id)
  const info = card ? cardInfo(card, wallet, localToday()) : null
  const [picks, setPicks] = useState<Record<string, string[]>>(
    held.chosen?.picks ?? {},
  )
  const [activated, setActivated] = useState<string[]>(held.activated)
  const [checkout, setCheckout] = useState(held.checkout_label ?? '')
  const [anniversary, setAnniversary] = useState(held.anniversary ?? '')
  if (!info) return null

  const save = () => {
    const chosen = Object.fromEntries(
      Object.entries(picks).filter(([, options]) => options.length > 0),
    )
    const input: CardInput = { id: held.id, activated }
    if (Object.keys(chosen).length > 0) input.picks = chosen
    if (checkout.trim() !== '') input.checkoutLabel = checkout
    if (anniversary !== '') input.anniversary = anniversary
    onChange(updateInWallet(catalog, wallet, input, localToday()), held.id)
  }

  return (
    <div class="editor">
      {info.choices.map((choice) => {
        const chosen = picks[choice.id] ?? []
        return (
          <fieldset key={choice.id}>
            <legend>
              {words(choice.id)}: pick {choice.pick}
              {choice.period === 'quarter' ? ' this quarter' : ''}
            </legend>
            {choice.options.map((option) => {
              const on = chosen.includes(option)
              return (
                <label class="check" key={option}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && chosen.length >= choice.pick}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked
                      setPicks((prev) => {
                        const now = prev[choice.id] ?? []
                        return {
                          ...prev,
                          [choice.id]: checked
                            ? [...now, option]
                            : now.filter((o) => o !== option),
                        }
                      })
                    }}
                  />
                  {words(option)}
                </label>
              )
            })}
          </fieldset>
        )
      })}
      {info.activation.length > 0 ? (
        <fieldset>
          <legend>
            Bonuses you've activated with {issuerName(info.issuer)}
          </legend>
          {info.activation.map((rule) => (
            <label class="check" key={rule}>
              <input
                type="checkbox"
                checked={activated.includes(rule)}
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  setActivated((prev) =>
                    checked ? [...prev, rule] : prev.filter((r) => r !== rule),
                  )
                }}
              />
              {words(rule)}
            </label>
          ))}
        </fieldset>
      ) : null}
      <label class="field">
        Name at checkout (optional)
        <input
          type="text"
          placeholder={shortName(held.id)}
          value={checkout}
          onInput={(e) => setCheckout(e.currentTarget.value)}
        />
      </label>
      {info.needsAnniversary ? (
        <label class="field">
          Account anniversary (MM-DD), for its yearly cap
          <input
            type="text"
            inputMode="numeric"
            placeholder="03-15"
            value={anniversary}
            onInput={(e) => setAnniversary(e.currentTarget.value)}
          />
        </label>
      ) : null}
      <div class="row-buttons">
        <button type="button" class="primary" onClick={save}>
          Save
        </button>
        <button
          type="button"
          onClick={() => onChange(removeFromWallet(wallet, held.id), held.id)}
        >
          Remove card
        </button>
      </div>
    </div>
  )
}

function CardList({
  wallet,
  onChange,
}: {
  wallet: Wallet
  onChange: (change: WalletChange, cardId: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const today = localToday()
  return (
    <ul class="held">
      {wallet.cards.map((held) => {
        const card = cards.get(held.id)
        const info = card ? cardInfo(card, wallet, today) : null
        const needsPick = info?.choices.some(
          (c) => c.default === null && !held.chosen?.picks[c.id],
        )
        return (
          <li key={held.id}>
            <button
              type="button"
              class="held-row"
              aria-expanded={open === held.id}
              onClick={() => setOpen(open === held.id ? null : held.id)}
            >
              <span>
                <strong>{label(held)}</strong>
                <span class="muted"> · {feeText(held.id)}</span>
              </span>
              <span class="muted">
                {needsPick ? 'Set picks' : open === held.id ? 'Close' : 'Edit'}
              </span>
            </button>
            {open === held.id ? (
              <CardEditor
                wallet={wallet}
                held={held}
                onChange={(change, id) => {
                  if (change.ok) setOpen(null)
                  onChange(change, id)
                }}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function AddCard({
  wallet,
  onChange,
}: {
  wallet: Wallet | null
  onChange: (change: WalletChange, cardId: string) => void
}) {
  const [query, setQuery] = useState('')
  const found = useMemo(
    () =>
      query.trim().length < 2
        ? []
        : searchCards(catalog, query, wallet, localToday()).cards.slice(0, 6),
    [query, wallet],
  )
  return (
    <div>
      <label class="visually-hidden" for="card-search">
        Find a card
      </label>
      <input
        id="card-search"
        class="search"
        type="search"
        placeholder="Find a card: sapphire, amex gold, double cash…"
        autocomplete="off"
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      <ul class="found">
        {found.map((c) => (
          <li key={c.id}>
            <span>
              {shortName(c.id)}
              <span class="muted"> · {issuerName(c.issuer)}</span>
            </span>
            {c.held ? (
              <span class="muted">Added</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onChange(
                    addToWallet(catalog, wallet, { id: c.id }, localToday()),
                    c.id,
                  )
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

function Memberships({
  wallet,
  onChange,
}: {
  wallet: Wallet
  onChange: (change: WalletChange) => void
}) {
  const used = new Set(
    wallet.cards.flatMap((h) => {
      const card = cards.get(h.id)
      return card ? membershipsUsed(card) : []
    }),
  )
  const relevant = knownMemberships(catalog).filter((m) => used.has(m))
  if (relevant.length === 0) return null
  return (
    <section>
      <h3>Memberships</h3>
      <p class="muted">Some of your cards earn more with these.</p>
      {relevant.map((m) => (
        <label class="check" key={m}>
          <input
            type="checkbox"
            checked={wallet.memberships.includes(m)}
            onChange={(e) =>
              onChange(
                withMemberships(
                  catalog,
                  wallet,
                  e.currentTarget.checked
                    ? [...wallet.memberships, m]
                    : wallet.memberships.filter((x) => x !== m),
                ),
              )
            }
          />
          {membershipName(m)}
        </label>
      ))}
    </section>
  )
}

function WhatIf({ wallet }: { wallet: Wallet }) {
  const result = useMemo(() => {
    const rows = loadList<Row>('spending', STARTER)
    const lines = resolveSpendLines(
      catalog,
      rows.map((r) => lineFor(r.what, r.monthly)),
    ).filter((l) => l.merchant.source !== 'none')
    if (lines.length === 0) return null
    return simulateAdditions(catalog, wallet, lines, {
      filters: {
        kind: 'any',
        business: false,
        noAnnualFee: false,
        issuer: null,
        includeClosed: false,
      },
      memberships: wallet.memberships,
      valuations: wallet.valuations,
      start: localToday(),
    })
    // The spending rows come from storage and change only on the other tab.
  }, [wallet])
  if (!result) return null
  const gains = result.additions.filter((a) => a.gain > 0).slice(0, 3)
  return (
    <section>
      <h3>Would another card help?</h3>
      <p class="muted">
        On your spending from the My spending tab, your cards earn about{' '}
        {usd(result.current.rewards)} a year.
      </p>
      {gains.length === 0 ? (
        <p>No card would add more than its annual fee costs.</p>
      ) : (
        <ol class="result-list">
          {gains.map((a, i) => (
            <li class="result" key={a.cardId}>
              <div class="result-top">
                <span class="rank">{i + 1}</span>
                <div class="result-name">
                  <strong>{shortName(a.cardId)}</strong>
                  <span class="muted">
                    +{usd(a.extraRewards)} back · {feeText(a.cardId)}
                  </span>
                </div>
                <span class="rate">
                  +{usd(a.gain)}
                  <small>/yr</small>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function compact(wallet: Wallet) {
  return {
    ...(Object.keys(wallet.valuations).length > 0
      ? { valuations: wallet.valuations }
      : {}),
    ...(wallet.memberships.length > 0
      ? { memberships: wallet.memberships }
      : {}),
    cards: wallet.cards.map((c) => ({
      id: c.id,
      ...(c.checkout_label === undefined
        ? {}
        : { checkout_label: c.checkout_label }),
      ...(c.anniversary === undefined ? {} : { anniversary: c.anniversary }),
      ...(Object.keys(c.cap_usage).length > 0
        ? { cap_usage: c.cap_usage }
        : {}),
      ...(c.chosen === undefined ? {} : { chosen: c.chosen }),
      ...(c.activated.length > 0 ? { activated: c.activated } : {}),
      ...(c.bonus === undefined ? {} : { bonus: c.bonus }),
    })),
  }
}

async function exportWallet(wallet: Wallet) {
  const { stringify } = await import('yaml')
  const text = `# Your earnrate wallet: the cards you hold, by id. Never card numbers.\n# For the command line, save it as ~/.earnrate/wallet.yaml\n\n${stringify(compact(wallet))}`
  const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'wallet.yaml'
  a.click()
  URL.revokeObjectURL(url)
}

async function importWallet(file: File): Promise<Wallet | string> {
  const [{ parse }, { WalletSchema }] = await Promise.all([
    import('yaml'),
    import('../../src/schema/wallet.ts'),
  ])
  let raw: unknown
  try {
    raw = parse(await file.text())
  } catch {
    return "That file isn't a wallet: it isn't valid YAML."
  }
  const result = WalletSchema.safeParse(raw)
  if (!result.success) return "That file isn't an earnrate wallet."
  const problems = walletProblems(result.data, catalog)
  return problems.length > 0 ? problems.join(' ') : result.data
}

function Transfer({
  wallet,
  onReplace,
}: {
  wallet: Wallet | null
  onReplace: (wallet: Wallet | null) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  return (
    <section>
      <h3>Move your wallet</h3>
      <p class="muted">
        Your wallet is saved only in this browser. Export it to keep a copy or
        to use it with the command line version; import one to bring it here.
      </p>
      <div class="row-buttons">
        {wallet ? (
          <button type="button" onClick={() => void exportWallet(wallet)}>
            Export wallet.yaml
          </button>
        ) : null}
        <label class="file-button">
          Import a wallet file
          <input
            type="file"
            accept=".yaml,.yml,text/yaml"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              if (!file) return
              void importWallet(file).then((result) => {
                if (typeof result === 'string') setError(result)
                else {
                  setError(null)
                  onReplace(result)
                }
              })
              e.currentTarget.value = ''
            }}
          />
        </label>
        {wallet ? (
          confirming ? (
            <button
              type="button"
              class="danger"
              onClick={() => {
                setConfirming(false)
                onReplace(null)
              }}
            >
              Yes, delete it from this browser
            </button>
          ) : (
            <button type="button" onClick={() => setConfirming(true)}>
              Delete wallet
            </button>
          )
        ) : null}
      </div>
      {error ? <p class="callout">{error}</p> : null}
      <p class="muted small">
        Statement import stays in the command line version: never upload a card
        statement to a website, this one included.
      </p>
    </section>
  )
}

export function MyWallet() {
  const [wallet, setWallet] = useState<Wallet | null>(loadWallet)
  const [message, setMessage] = useState<{
    text: string
    error: boolean
  } | null>(null)
  const [query, setQuery] = useState('')
  const [amount, setAmount] = useState('')
  const [asked, setAsked] = useState<{
    text: string
    amount: number | null
  } | null>(null)

  const replace = (next: Wallet | null) => {
    setWallet(next)
    saveWallet(next)
  }
  const apply = (change: WalletChange, cardId?: string) => {
    if (!change.ok) {
      setMessage({ text: change.error, error: true })
      return
    }
    replace(change.wallet)
    setMessage(
      change.notes.length > 0
        ? {
            text: change.notes
              .map((n) => noteText(n, shortName(cardId ?? '')))
              .join(' '),
            error: false,
          }
        : null,
    )
  }

  const problems = wallet ? walletProblems(wallet, catalog) : []
  const rec = useMemo(
    () =>
      wallet && asked && problems.length === 0
        ? ask(wallet, asked.text, asked.amount)
        : null,
    [wallet, asked, problems.length],
  )

  if (wallet && problems.length > 0) {
    return (
      <div>
        <p class="callout">
          The wallet saved in this browser has problems: {problems.join(' ')}
        </p>
        <Transfer wallet={wallet} onReplace={replace} />
      </div>
    )
  }

  if (!wallet) {
    return (
      <div>
        <p>
          Add the cards you have, and earnrate tells you which one to use
          anywhere. Your wallet is saved only in this browser: no account, and
          never a card number.
        </p>
        <AddCard wallet={null} onChange={apply} />
        {message ? (
          <p class={message.error ? 'callout' : 'muted'}>{message.text}</p>
        ) : null}
        <Transfer wallet={null} onReplace={replace} />
      </div>
    )
  }

  return (
    <div>
      <form
        class="ask"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim() !== '')
            setAsked({ text: query.trim(), amount: Number(amount) || null })
        }}
      >
        <label class="visually-hidden" for="wallet-ask">
          Where are you paying?
        </label>
        <input
          id="wallet-ask"
          type="search"
          list="suggestions"
          placeholder="Where are you paying?"
          autocomplete="off"
          enterkeyhint="search"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <input
          class="amount"
          type="number"
          inputMode="decimal"
          min="0"
          placeholder="$"
          aria-label="Amount (optional)"
          value={amount}
          onInput={(e) => setAmount(e.currentTarget.value)}
        />
        <button type="submit">Ask</button>
      </form>
      <div class="chips">
        {QUICK.map((q) => (
          <button
            type="button"
            class={asked?.text === q ? 'chip on' : 'chip'}
            key={q}
            onClick={() => {
              setQuery(q)
              setAsked({ text: q, amount: Number(amount) || null })
            }}
          >
            {q}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {rec ? (
          <section class="results">
            <h3>
              {rec.merchant.source === 'caller'
                ? `For ${categoryPhrase(catalog, rec.merchant.category)}`
                : `At ${rec.merchant.resolvedName}`}
            </h3>
            <Answer
              wallet={wallet}
              rec={rec}
              onRecord={(cardId, paid) => {
                replace(
                  recordPurchase(catalog, wallet, {
                    cardId,
                    merchant: asked?.text ?? '',
                    amount: paid,
                    date: localToday(),
                    channel: null,
                  }),
                )
                setMessage({
                  text: `Recorded ${usd(paid)} on ${shortName(cardId)}. Caps update for your next answer.`,
                  error: false,
                })
              }}
            />
          </section>
        ) : null}
      </div>

      {message ? (
        <p class={message.error ? 'callout' : 'muted'}>{message.text}</p>
      ) : null}

      <section>
        <CheatSheet wallet={wallet} />
      </section>

      <section>
        <h3>Your cards</h3>
        <CardList wallet={wallet} onChange={apply} />
        <AddCard wallet={wallet} onChange={apply} />
      </section>

      <Memberships wallet={wallet} onChange={apply} />
      <WhatIf wallet={wallet} />
      <Transfer wallet={wallet} onReplace={replace} />
    </div>
  )
}
