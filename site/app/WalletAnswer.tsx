import { Fragment, type ComponentChildren } from 'preact'
import { catalog } from 'virtual:catalog'
import { localToday } from '../../src/engine/periods.ts'
import { ABROAD, noteOnly, recommend } from '../../src/engine/recommend.ts'
import {
  creditShort,
  dollarsAndCents,
  listed,
  MERCHANT_CODE_LEAD,
  money,
} from '../../src/engine/text.ts'
import type { Recommendation } from '../../src/engine/types.ts'
import {
  resolvePlace,
  withCallerCategory,
} from '../../src/merchants/resolve.ts'
import type { PaymentMethod } from '../../src/schema/card.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { CardArt } from './CardArt.tsx'
import { pct, shortName } from './format.ts'
import { PayingHints } from './PayingWith.tsx'
import { kindCategory } from './place-kinds.ts'

// Which of the wallet's cards to use for one purchase: the engine's
// recommend() with the saved wallet as it is, so memberships, picks,
// activations, caps used and how you pay all count.
export function askWallet(
  wallet: Wallet,
  merchant: string,
  amount: number | null,
  abroad: boolean,
  payment: PaymentMethod | null,
  kind: string | null,
): Recommendation {
  return recommend(
    catalog,
    wallet,
    {
      merchant,
      amount,
      channel: null,
      date: localToday(),
      country: abroad ? ABROAD : 'US',
      payment,
    },
    withCallerCategory(
      resolvePlace(catalog, merchant, null),
      kind === null ? null : kindCategory(kind),
    ),
  )
}

// What an answer assumed, one tap away. The merchant code is for Claude
// and the command line; it says nothing to a shopper.
export function Assumes({ lines: all }: { lines: string[] }) {
  const lines = all.filter((l) => !l.startsWith(MERCHANT_CODE_LEAD))
  if (lines.length === 0) return null
  return (
    <details class="how assumes">
      <summary>What this assumes</summary>
      <ul class="assumptions">
        {lines.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </details>
  )
}

// "Can't use here: Amex Gold. Costco takes only Visa in-store."
function cantUseHere(excluded: Recommendation['excluded']): string[] {
  const byReason = new Map<string, string[]>()
  for (const e of excluded)
    byReason.set(e.reason, [
      ...(byReason.get(e.reason) ?? []),
      shortName(e.cardId),
    ])
  return [...byReason].map(
    ([reason, names]) => `${reason} Can't use: ${listed(names)}.`,
  )
}

export function WalletAnswer({
  wallet,
  rec,
  onPayment,
  kinds,
}: {
  wallet: Wallet
  rec: Recommendation
  onPayment: (payment: PaymentMethod) => void
  kinds: ComponentChildren
}) {
  const decided = rec.decision
  const top = rec.ranked.find((r) => r.cardId === decided?.cardId)
  const held = wallet.cards.find((c) => c.id === decided?.cardId)
  if (noteOnly(rec))
    return (
      <div class="answer">
        <p class="callout">{rec.categoryNote}</p>
        <Assumes lines={rec.assumptions} />
      </div>
    )
  return (
    <div class="answer">
      {rec.categoryNote ? <p class="callout">{rec.categoryNote}</p> : null}
      {decided && held ? (
        <p class="verdict">
          Use <strong>{shortName(held.id)}</strong>
          {rec.bonus ? ' for its welcome bonus' : ''}:{' '}
          {pct(decided.effectiveReturnPct)} back
          {top?.earned !== null && top?.earned !== undefined
            ? `, about ${dollarsAndCents(top.earned)}`
            : ''}
          {top?.credit?.dollars
            ? `, plus ${money(top.credit.dollars)} back from its ${top.credit.name} credit`
            : ''}
          .
        </p>
      ) : (
        <p class="verdict">None of your cards work here.</p>
      )}
      {cantUseHere(rec.excluded).map((line) => (
        <p class="callout" key={line}>
          {line}
        </p>
      ))}
      {/* The engine warns about a store it doesn't know first, and what kind
          of place it is gets asked right under that. */}
      {rec.warnings.map((w, i) => (
        <Fragment key={w}>
          <p class="callout">{w}</p>
          {i === 0 ? kinds : null}
        </Fragment>
      ))}
      {rec.warnings.length === 0 ? kinds : null}
      <PayingHints answer={rec} onPick={onPayment} />
      {rec.notes.map((n) => (
        <p class="muted" key={n}>
          {n}
        </p>
      ))}
      <ol class="result-list">
        {rec.ranked
          .map((r, i) => ({ r, rank: i + 1 }))
          .filter(({ r, rank }) => rank <= 3 || r.cardId === rec.bonus?.cardId)
          .map(({ r, rank }) => (
            <li class="result" key={r.cardId}>
              <div class="result-top">
                <span class="rank">{rank}</span>
                <CardArt id={r.cardId} />
                <div class="result-name">
                  <strong>{shortName(r.cardId)}</strong>
                  {r.cardId === rec.bonus?.cardId ? (
                    <span class="muted">The pick, for its welcome bonus</span>
                  ) : null}
                </div>
                <span class="rate">{pct(r.effectiveReturnPct)}</span>
              </div>
              {r.credit ? (
                <p class="upgrade">{creditShort(r.credit, r.credit.dollars)}</p>
              ) : null}
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
                <p class="muted">
                  Wrong rate? <a href="/support">Tell us</a>.
                </p>
              </details>
            </li>
          ))}
      </ol>
      {rec.sensitivity ? <p class="muted">{rec.sensitivity}</p> : null}
      <Assumes lines={rec.assumptions} />
    </div>
  )
}
