import type { ComponentChildren } from 'preact'
import { catalog } from 'virtual:catalog'
import { EPSILON, HALF_CENT } from '../../src/engine/compare.ts'
import { ifMemberLines, placedAmong } from '../../src/engine/memberships.ts'
import { optionName } from '../../src/engine/rule-text.ts'
import {
  capitalize,
  dollarsAndCents,
  feeText,
  listed,
  roundCents,
  wholeDollars,
} from '../../src/engine/text.ts'
import type { StatementAnalysis } from '../../src/import/analyze.ts'
import {
  FEE_MIN_DAYS,
  feeShare,
  type BestCards as Best,
  type Replayed,
} from '../../src/import/best-cards.ts'
import { CardArt } from '../app/CardArt.tsx'
import { cards, shortName } from '../app/format.ts'

const SHOWN = 3

const cardLink = (id: string) => <a href={`/cards/${id}`}>{shortName(id)}</a>

const gapText = (gap: number) =>
  Math.abs(gap) < HALF_CENT
    ? 'Same as yours'
    : `${gap > 0 ? '+' : ''}${dollarsAndCents(gap)} vs. yours`

// The cards earnrate knows that would have earned the most on the file's
// purchases, next to what the cards used earned, both net of fees.
export function BestCards({
  best,
  analysis,
}: {
  best: Best
  analysis: StatementAnalysis
}) {
  const top = best.singles.slice(0, SHOWN)
  if (top.length === 0 || analysis.purchases === 0) return null
  const used = analysis.byCard.map((t) => t.cardId)
  const usedNet = roundCents(
    analysis.earned -
      used.reduce(
        (sum, id) => sum + feeShare(cards.get(id)?.annual_fee ?? 0, best.days),
        0,
      ),
  )
  const members = ifMemberLines(
    catalog,
    placedAmong(best.membersOnly, best.singles, SHOWN, (a, b) =>
      a.net > b.net + EPSILON ? -1 : 1,
    ).map((m) => ({
      membership: m.membership,
      text: `${shortName(m.cardIds[0] ?? '')}, ${dollarsAndCents(m.earned)}`,
    })),
  )
  // What the replay assumed the cardholder did: the picks it chose and any
  // bonus that needs activating while the file's dates run.
  const assumed = (r: Replayed) =>
    r.cardIds.flatMap((id) => {
      const card = cards.get(id)
      if (!card) return []
      const picked = Object.entries(r.picks[id] ?? {}).map(
        ([choice, options]) =>
          `${listed(options.map((o) => optionName(catalog, card, choice, o)))} picked`,
      )
      const activated = card.rules.some(
        (rule) =>
          rule.requires?.activation === true &&
          (rule.valid_from ?? '') <= best.to &&
          (rule.valid_to ?? '9999') >= best.from,
      )
      return activated ? [...picked, 'activation assumed'] : picked
    })
  const row = (r: Replayed, name: ComponentChildren, fees: string) => {
    const only = used.length === 1 && r.cardIds.join() === used[0]
    const fee = [fees, ...new Set(assumed(r))].join(' · ')
    return (
      <li key={r.cardIds.join('+')}>
        <span class={r.cardIds.length > 1 ? 'best-art art-pair' : 'best-art'}>
          {r.cardIds.map((id) => (
            <CardArt id={id} width={32} key={id} />
          ))}
        </span>
        <span class="best-name">{name}</span>
        <span class="best-amount">{dollarsAndCents(r.earned)}</span>
        <span class="best-gap">
          {only ? 'Your card' : gapText(roundCents(r.net - usedNet))}
        </span>
        <span class="sub best-fee">{fee}</span>
      </li>
    )
  }
  return (
    <section class="panel arrive best-cards" aria-labelledby="best-title">
      <h2 id="best-title">Best cards for these purchases</h2>
      <p class="muted small">
        The same purchases replayed on each card.{' '}
        {best.days < FEE_MIN_DAYS
          ? 'The file is too short to count annual fees fairly, so differences are earnings alone.'
          : `Differences from yours are after annual fees, prorated to these ${String(best.days)} days.`}
      </p>
      <ol class="best-list">
        {top.map((r) => {
          const id = r.cardIds[0] ?? ''
          return row(
            r,
            cardLink(id),
            capitalize(
              feeText({
                annualFee: cards.get(id)?.annual_fee ?? null,
                firstYearFee: null,
              }),
            ),
          )
        })}
      </ol>
      {best.pair ? (
        <>
          <h3>Best two together</h3>
          <ol class="best-list">
            {row(
              best.pair,
              <>
                {cardLink(best.pair.cardIds[0] ?? '')} +{' '}
                {cardLink(best.pair.cardIds[1] ?? '')}
              </>,
              best.pair.annualFees === 0
                ? 'No annual fees'
                : `${wholeDollars(best.pair.annualFees)} in annual fees`,
            )}
          </ol>
        </>
      ) : null}
      {members.map((line) => (
        <p class="muted small" key={line}>
          {line}
        </p>
      ))}
    </section>
  )
}
