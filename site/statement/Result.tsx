import { catalog } from 'virtual:catalog'
import { HALF_CENT } from '../../src/engine/compare.ts'
import {
  categoryAs,
  dollarsAndCents,
  pointValuesText,
  roundCents,
  wholeDollars,
} from '../../src/engine/text.ts'
import { cardValuation } from '../../src/engine/valuation.ts'
import type { MissedRewards } from '../../src/import/analyze.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { cards } from '../app/format.ts'
import { Bar, DataTable, useMore } from './charts.tsx'
import { dateRange, gainByCard, yearlyPace, type Check } from './check.ts'

const plural = (n: number, one: string, many = `${one}s`) =>
  `${String(n)} ${n === 1 ? one : many}`

const SHOWN_STORES = 10

const plus = (n: number) => `+${dollarsAndCents(n)}`

// "a supermarket" for a "Counted as" column, from "as a supermarket".
const asWhat = (category: string) =>
  categoryAs(catalog, category).replace(/^as /, '')

export function Result({
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
  const differs = gain > HALF_CENT
  const pace = yearlyPace(a)
  const scale = Math.max(a.best, a.earned)
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
  const byCard = gainByCard(a)
  return (
    <section class="panel arrive check-result" aria-labelledby="result-title">
      <h2 id="result-title">What these purchases earned</h2>
      <div class="hero">
        <p class="hero-figure">
          {differs ? `${dollarsAndCents(gain)} more` : 'No difference'}
        </p>
        <p class="hero-caption">
          {differs
            ? 'with the best of your cards for each purchase'
            : 'You used the best of your cards for every purchase.'}
        </p>
        {pace !== null ? (
          <p class="hero-pace">
            At this pace, about {wholeDollars(pace)} a year.
          </p>
        ) : null}
      </div>
      <div class="compare">
        <div class="compare-row">
          <span class="compare-label">
            {one
              ? `Earned on ${nameOf(one.cardId)}`
              : 'Earned on the cards you used'}
          </span>
          <Bar value={a.earned} max={scale} tone="quiet" />
          <span class="compare-amount">{dollarsAndCents(a.earned)}</span>
        </div>
        <div class="compare-row">
          <span class="compare-label">With the best of your cards</span>
          <Bar value={a.best} max={scale} />
          <span class="compare-amount">{dollarsAndCents(a.best)}</span>
        </div>
      </div>
      <p class="muted small">
        {plural(a.purchases, 'purchase')}, {dollarsAndCents(a.spend)},{' '}
        {dateRange(a.from, a.to)}.
        {a.refunds > 0
          ? ` Refunds and credits of ${dollarsAndCents(a.refunds)} aren't counted.`
          : ''}
      </p>

      {one ? null : (
        <DataTable
          label="By card used"
          rows={a.byCard}
          keyOf={(t) => t.cardId}
          columns={[
            { head: 'Card used', cell: (t) => nameOf(t.cardId) },
            {
              head: 'Purchases',
              num: true,
              cell: (t) => String(t.purchases),
            },
            { head: 'Spent', num: true, cell: (t) => dollarsAndCents(t.spend) },
            {
              head: 'Earned',
              num: true,
              cell: (t) => dollarsAndCents(t.earned),
            },
          ]}
        />
      )}

      {byCard ? (
        <>
          <h3>The cards that would have earned more</h3>
          <p class="muted small">
            What each would have added, where it beats the card you used.
          </p>
          <div class="compare">
            {byCard.map((g) => (
              <div class="compare-row" key={g.cardId}>
                <span class="compare-label">
                  {nameOf(g.cardId)}
                  <span class="muted"> · {plural(g.stores, 'store')}</span>
                </span>
                <Bar value={g.gain} max={byCard[0]?.gain ?? 0} />
                <span class="compare-amount">{plus(g.gain)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {a.missed.length > 0 ? (
        <>
          <h3>Where another of your cards would have earned more</h3>
          <MissedTable missed={a.missed} nameOf={nameOf} />
        </>
      ) : null}

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

      {check.unknown.length > 0 ? (
        <>
          <h3>Stores earnrate didn't recognize</h3>
          <p>
            These were counted by the category on the statement. Another issuer
            may code the same store differently.
          </p>
          <DataTable
            label="Stores earnrate didn't recognize"
            rows={check.unknown}
            keyOf={(s) => s.name}
            columns={[
              { head: 'Store', cell: (s) => s.name },
              {
                head: 'Spent',
                num: true,
                cell: (s) => dollarsAndCents(s.spend),
              },
              {
                head: 'Counted as',
                cell: (s) => (
                  <>
                    {asWhat(s.category ?? 'other')}
                    {s.issuerCategory ? (
                      <span class="sub">Statement: {s.issuerCategory}</span>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
        </>
      ) : null}

      {a.coding.length > 0 ? (
        <>
          <h3>Stores the statement coded differently than earnrate expects</h3>
          <p>
            earnrate counted these the way it expects the store to code. If your
            issuer keeps coding them as this statement does, a card may earn
            differently there. <a href="/support">Tell us</a> if earnrate has a
            store wrong.
          </p>
          <DataTable
            label="Stores coded differently"
            rows={a.coding}
            keyOf={(c) => c.merchant}
            columns={[
              { head: 'Store', cell: (c) => c.merchant },
              {
                head: 'earnrate counts it as',
                cell: (c) => asWhat(c.earnrateCategory),
              },
              { head: 'Statement says', cell: (c) => c.issuerCategory },
            ]}
          />
        </>
      ) : null}

      {a.notTaken.length > 0 ? (
        <>
          <h3>Stores earnrate has down as not taking your card</h3>
          <p>
            Your statement shows they took it, so these purchases count with
            what that card earned. <a href="/support">Tell us</a> so we can
            correct the store.
          </p>
          <DataTable
            label="Stores earnrate has down as not taking your card"
            rows={a.notTaken}
            keyOf={(n) => `${n.merchant}|${n.cardId}`}
            columns={[
              { head: 'Store', cell: (n) => n.merchant },
              { head: 'Card', cell: (n) => nameOf(n.cardId) },
              {
                head: 'Spent',
                num: true,
                cell: (n) => dollarsAndCents(n.spend),
              },
            ]}
          />
        </>
      ) : null}
    </section>
  )
}

function MissedTable({
  missed,
  nameOf,
}: {
  missed: MissedRewards[]
  nameOf: (id: string) => string
}) {
  const { shown, more } = useMore(missed, SHOWN_STORES)
  const top = Math.max(...missed.map((m) => m.best - m.earned))
  const marked = missed.some((m) => m.categoryFromStatement)
  return (
    <>
      <table
        class="missed"
        role="table"
        aria-label="Where another of your cards would have earned more, biggest gain first"
      >
        <thead>
          <tr role="row">
            <th scope="col" role="columnheader">
              Store
            </th>
            <th scope="col" role="columnheader" class="num spent">
              Spent
            </th>
            <th scope="col" role="columnheader" class="used">
              Card used
            </th>
            <th scope="col" role="columnheader" class="better">
              Better card
            </th>
            <th scope="col" role="columnheader" class="num gain" colSpan={2}>
              Gain
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => {
            const gain = roundCents(m.best - m.earned)
            return (
              <tr
                role="row"
                key={`${m.merchant}|${m.usedCardId}|${m.bestCardId}`}
              >
                <th scope="row" role="rowheader" class="store">
                  {m.merchant}
                  {m.categoryFromStatement ? (
                    <>
                      <span class="mark" aria-hidden="true">
                        *
                      </span>
                      <span class="visually-hidden">
                        {' '}
                        (counted by the statement's category)
                      </span>
                    </>
                  ) : null}
                  <span class="sub">
                    {plural(m.count, 'purchase')}
                    <span class="phone">, {dollarsAndCents(m.spend)}</span>
                  </span>
                </th>
                <td role="cell" class="num spent">
                  {dollarsAndCents(m.spend)}
                </td>
                <td role="cell" class="used">
                  {nameOf(m.usedCardId)}
                  <span class="sub">{dollarsAndCents(m.earned)}</span>
                </td>
                <td role="cell" class="better">
                  {nameOf(m.bestCardId)}
                  <span class="sub">{dollarsAndCents(m.best)}</span>
                </td>
                <td role="cell" class="gain-bar" aria-hidden="true">
                  <Bar value={gain} max={top} />
                </td>
                <td role="cell" class="num gain">
                  {plus(gain)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {more}
      {marked ? (
        <p class="muted small">
          * earnrate doesn't know this store, so it went by the category on the
          statement.
        </p>
      ) : null}
    </>
  )
}
