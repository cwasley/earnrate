import { Fragment, type ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import { placedAmong } from '../../src/engine/memberships.ts'
import {
  offerOrder,
  OFFERS_MAY_DIFFER,
  offerTerms,
  type OfferPlan,
  type OfferSummary,
} from '../../src/engine/offers.ts'
import { gainOrder, type Addition } from '../../src/engine/simulate.ts'
import {
  capitalize,
  creditsCountedText,
  creditsOnlyIf,
  currencyName,
  feeText,
  ifCreditsUsedText,
  listed,
  minimumSpendText,
  offerPerksText,
  onlyIfText,
  shortDate,
  withArticle,
} from '../../src/engine/text.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { followingOwnLink } from './add-from-link.ts'
import { CardArt } from './CardArt.tsx'
import type { Additions } from './find/steps.ts'
import {
  cards,
  feeLabel,
  issuerName,
  issuers,
  membershipName,
  shortName,
  wholeDollars,
} from './format.ts'
import { skippedIssuersOp, type LocalOp } from './sync.ts'
import { track } from './track.ts'

// Rows shown before "N more".
const SHOWN = 3
const MORE = 10

// A card page's link to it, and this tab's own "Add to my wallet": the card
// is added and its Settings open on My wallet.
function AddLinks({ cardId }: { cardId: string }) {
  const add = `#wallet&add=${cardId}`
  return (
    <div class="row-buttons">
      <a class="row-link" href={`/cards/${cardId}`}>
        See card details
      </a>
      <a
        class="row-link primary"
        href={add}
        onClick={() => followingOwnLink(add)}
      >
        Add to my wallet
      </a>
    </div>
  )
}

function AdditionCredits({ addition }: { addition: Addition }) {
  const credits = addition.simulation.credits.find(
    (c) => c.cardId === addition.cardId && !c.held,
  )
  if (!credits) return null
  return (
    <p class="muted">
      {ifCreditsUsedText(credits, addition.gainIfCreditsUsed, 'adds')}{' '}
      {creditsOnlyIf(credits)}
    </p>
  )
}

// Issuers with a card a new-card answer can suggest.
const SKIPPABLE = issuers.filter((id) =>
  catalog.cards.some(
    (c) => c.issuer === id && !c.business && c.network !== 'store',
  ),
)

// Never assumed: nothing is left out until the person checks an issuer.
function SkipIssuers({
  wallet,
  locked,
  onChange,
}: {
  wallet: Wallet
  locked: boolean
  onChange: (op: LocalOp) => void
}) {
  const skipped = wallet.skipped_issuers ?? []
  const set = (list: string[]) => {
    track('wallet-skip-issuers')
    onChange(skippedIssuersOp(list))
  }
  return (
    <>
      {skipped.length > 0 ? (
        <p class="skip-saved">
          Leaving out cards from {listed(skipped.map(issuerName))}.{' '}
          <button
            type="button"
            class="link"
            disabled={locked}
            onClick={() => set([])}
          >
            Clear
          </button>
        </p>
      ) : null}
      <details class="filters whatif-more skip-issuers">
        <summary>Can't get cards from some issuers? Leave them out</summary>
        <fieldset class="lock" disabled={locked}>
          <legend class="visually-hidden">Issuers to leave out</legend>
          <div class="issuer-checks">
            {SKIPPABLE.map((id) => (
              <label class="check" key={id}>
                <input
                  type="checkbox"
                  checked={skipped.includes(id)}
                  onChange={(e) =>
                    set(
                      e.currentTarget.checked
                        ? [...skipped, id]
                        : skipped.filter((x) => x !== id),
                    )
                  }
                />
                {issuerName(id)}
              </label>
            ))}
          </div>
        </fieldset>
        <p class="muted small">
          Both views leave out every card from the issuers you check. Saved with
          your wallet.
        </p>
      </details>
    </>
  )
}

type View = 'yearly' | 'two-years'

const VIEWS: { view: View; label: string }[] = [
  { view: 'yearly', label: 'Every year' },
  { view: 'two-years', label: 'First two years' },
]

function OfferRow({
  offer: o,
  plan,
  rank,
  typical,
  open,
  setOpen,
}: {
  offer: OfferSummary
  plan: OfferPlan
  rank: number
  typical: boolean
  open: boolean
  setOpen: (cardId: string | null) => void
}) {
  return (
    <li class={rank === 1 ? 'result hero' : 'result'} data-whatif={o.cardId}>
      <button
        type="button"
        class="result-top result-toggle"
        aria-expanded={open}
        onClick={() => setOpen(open ? null : o.cardId)}
      >
        <span class="rank">{rank}</span>
        <CardArt id={o.cardId} />
        <span class="result-name">
          <strong>{shortName(o.cardId)}</strong>
          <span class="muted">
            <span class="year-split">
              {wholeDollars(plan.yearOne)} year one ·
            </span>{' '}
            <span class="year-split">
              {wholeDollars(plan.yearTwo)} year two
            </span>
          </span>
        </span>
        <span class="rate">
          {plan.twoYears > 0 ? '+' : ''}
          {wholeDollars(plan.twoYears)}
          <small>/2 yrs</small>
        </span>
      </button>
      {plan.minimumSpend ? (
        <p data-tone={plan.minimumSpend.reachable ? undefined : 'warn'}>
          {minimumSpendText(o.spend, o.months, plan.minimumSpend, typical)}
        </p>
      ) : null}
      {o.ineligible ? <p class="warn">{o.ineligible}</p> : null}
      <p class="muted">
        {offerTerms(o, currencyName(catalog, o.currency))}.
        {o.validTo ? ` Offer ends ${shortDate(o.validTo)}.` : ''} Public offer
        as of {shortDate(o.lastVerified)}.
      </p>
      {open ? (
        <p class="muted">
          {capitalize(feeText(o))}.{o.note ? ` ${o.note}` : ''}
          {o.credits + o.freeNights > 0
            ? ` ${offerPerksText(o.credits, o.freeNights)
                .map((t) => `${capitalize(t)}.`)
                .join(' ')} ${onlyIfText(o.credits > 0, o.freeNights > 0)}`
            : ''}
        </p>
      ) : null}
      {open ? <AddLinks cardId={o.cardId} /> : null}
    </li>
  )
}

// "With a membership: Sam's Club Mastercard +$36, Costco Anywhere Visa +$29
// a year": cards that need one the wallet doesn't have, in one line.
function MemberLine({ items, per }: { items: string[]; per: string }) {
  if (items.length === 0) return null
  return (
    <p class="muted small">
      With a membership: {items.join(', ')} {per}.
    </p>
  )
}

// A new card for the saved wallet: what each would add to it a year after
// its fee, or over its first two years with its welcome offer.
export function NewCard({
  wallet,
  additions,
  typical,
  locked,
  onChange,
  focus,
  skeleton,
}: {
  wallet: Wallet
  additions: Additions | null
  typical: boolean
  locked: boolean
  onChange: (op: LocalOp) => void
  // A card or comparison page's "See what it adds to your cards": shown,
  // and the first one open, even when they aren't in the top rows.
  focus: string[]
  // Stand-ins for the answer while the first one is worked out.
  skeleton: { intro: ComponentChildren; rows: ComponentChildren }
}) {
  const [open, setOpen] = useState<string | null>(focus[0] ?? null)
  const [view, setView] = useState<View>('yearly')
  const [more, setMore] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const [first] = focus
    if (first === undefined || scrolled || !additions) return
    setScrolled(true)
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-whatif="${CSS.escape(first)}"]`)
        ?.scrollIntoView({ block: 'center' })
    })
  }, [focus, additions])

  const viewSwitch = (
    <div
      class="segments whatif-view"
      role="radiogroup"
      aria-label="What to count"
    >
      {VIEWS.map((v) => (
        <label key={v.view}>
          <input
            type="radio"
            name="whatif-view"
            checked={view === v.view}
            onChange={() => {
              if (v.view === 'two-years') track('wallet-two-years')
              setView(v.view)
            }}
          />
          {v.label}
        </label>
      ))}
    </div>
  )
  if (!additions)
    return (
      <section class="results new-card" aria-busy="true">
        {skeleton.intro}
        {viewSwitch}
        {skeleton.rows}
      </section>
    )

  const { whatIf, offers } = additions
  const counted = whatIf.current.credits.filter((c) => c.held)
  const shownRows = more ? MORE : SHOWN
  const positive = whatIf.additions.filter((a) => a.gain > 0)
  const gains = positive.slice(0, shownRows)
  const members = placedAmong(
    whatIf.membersOnly.filter((a) => a.gain > 0),
    positive,
    shownRows,
    gainOrder,
  ).map((a) => `${shortName(a.cardId)} +${wholeDollars(a.gain)}`)
  const focused = focus
    .filter((id) => !gains.some((a) => a.cardId === id))
    .flatMap((id) =>
      [...whatIf.additions, ...whatIf.membersOnly].filter(
        (a) => a.cardId === id,
      ),
    )
  const rankOf = (f: Addition) =>
    whatIf.additions.filter((a) => gainOrder(a, f) < 0).length + 1
  const needs = (cardId: string) => {
    const id = cards.get(cardId)?.requires_membership
    return id !== undefined &&
      [...whatIf.membersOnly, ...offers.membersOnly].some(
        (m) => m.cardId === cardId,
      )
      ? `With ${withArticle(membershipName(id))}, which it needs, `
      : ''
  }
  const row = (a: Addition, rank: number) => (
    <li
      class={rank === 1 ? 'result hero' : 'result'}
      key={a.cardId}
      data-whatif={a.cardId}
    >
      <button
        type="button"
        class="result-top result-toggle"
        aria-expanded={open === a.cardId}
        onClick={() => setOpen(open === a.cardId ? null : a.cardId)}
      >
        <span class="rank">{rank}</span>
        <CardArt id={a.cardId} />
        <span class="result-name">
          <strong>{shortName(a.cardId)}</strong>
          <span class="muted">{feeLabel(a.cardId)}</span>
        </span>
        <span class="rate">
          {a.gain > 0 ? '+' : ''}
          {wholeDollars(a.gain)}
          <small>/yr</small>
        </span>
      </button>
      {open === a.cardId ? (
        <p class="muted">
          {wholeDollars(a.extraRewards)} more back a year before its fee.
        </p>
      ) : null}
      {open === a.cardId ? <AdditionCredits addition={a} /> : null}
      {open === a.cardId ? <AddLinks cardId={a.cardId} /> : null}
    </li>
  )

  const withPlans = (list: OfferSummary[]) =>
    list.flatMap((o) => (o.plan ? [{ offer: o, plan: o.plan }] : []))
  const planned = withPlans(offers.offers)
  const memberPlans = withPlans(offers.membersOnly)
  const ahead = planned.filter((p) => p.plan.twoYears > 0)
  const topOffers = ahead.slice(0, shownRows)
  const memberOffers = placedAmong(
    offers.membersOnly.filter(
      (o) => (o.plan?.twoYears ?? 0) > 0 && o.ineligible === null,
    ),
    ahead.map((p) => p.offer),
    shownRows,
    offerOrder,
  ).map((o) => `${shortName(o.cardId)} +${wholeDollars(o.plan?.twoYears ?? 0)}`)
  const focusedOffers = focus
    .filter((id) => !topOffers.some((p) => p.offer.cardId === id))
    .flatMap((id) =>
      [...planned, ...memberPlans].filter((p) => p.offer.cardId === id),
    )
  const offerRank = (p: (typeof planned)[number]) =>
    planned.filter((x) => offerOrder(x.offer, p.offer) < 0).length + 1
  const offerRow = (p: (typeof planned)[number], rank: number) => (
    <OfferRow
      key={p.offer.cardId}
      offer={p.offer}
      plan={p.plan}
      rank={rank}
      typical={typical}
      open={open === p.offer.cardId}
      setOpen={setOpen}
    />
  )
  const left = (view === 'yearly' ? positive.length : ahead.length) - shownRows
  const moreButton =
    !more && left > 0 ? (
      <button type="button" class="more" onClick={() => setMore(true)}>
        Show {Math.min(left, MORE - SHOWN)} more
      </button>
    ) : null

  return (
    <section class="results new-card">
      <p class="muted">
        Your cards earn about {wholeDollars(whatIf.current.rewards)} a year on
        this spending.
      </p>
      {viewSwitch}
      {view === 'yearly' ? (
        <>
          {gains.length === 0 ? (
            <p>No card would add more than its annual fee costs.</p>
          ) : (
            <ol class="result-list" key="yearly">
              {gains.map((a, i) => row(a, i + 1))}
            </ol>
          )}
          {moreButton}
          <MemberLine items={members} per="a year" />
          {focused.map((f) => (
            <Fragment key={f.cardId}>
              <p class="muted">
                {needs(f.cardId)}
                {shortName(f.cardId)}{' '}
                {f.gain > 0
                  ? 'would add this much, after its annual fee:'
                  : 'would add less than its annual fee costs:'}
              </p>
              <ol class="result-list">{row(f, rankOf(f))}</ol>
            </Fragment>
          ))}
        </>
      ) : (
        <>
          <p class="muted">
            With each card's welcome bonus, if the minimum spend fits, less its
            fees.
          </p>
          {topOffers.length === 0 ? (
            <p>No card's first two years would add more than its fees cost.</p>
          ) : (
            <ol class="result-list" key="two-years">
              {topOffers.map((p, i) => offerRow(p, i + 1))}
            </ol>
          )}
          {moreButton}
          <MemberLine items={memberOffers} per="over two years" />
          {focusedOffers.map((p) => (
            <Fragment key={p.offer.cardId}>
              <p class="muted">
                {needs(p.offer.cardId)}
                {shortName(p.offer.cardId)}
                {p.plan.twoYears > 0
                  ? ' over its first two years:'
                  : "'s first two years would add less than its fees cost:"}
              </p>
              <ol class="result-list">{offerRow(p, offerRank(p))}</ol>
            </Fragment>
          ))}
          <p class="muted small">{OFFERS_MAY_DIFFER}</p>
          <details class="filters whatif-more">
            <summary>How this is ranked</summary>
            {offers.notes.map((n) => (
              <p class="muted small" key={n}>
                {n}
              </p>
            ))}
          </details>
        </>
      )}
      <SkipIssuers wallet={wallet} locked={locked} onChange={onChange} />
      {counted.length > 0 ? (
        <details class="how">
          <summary>Credits on your cards</summary>
          {counted.map((c) => (
            <p class="muted small" key={c.cardId}>
              {creditsCountedText(
                shortName(c.cardId),
                cards.get(c.cardId)?.annual_fee ?? 0,
                c,
              )}
            </p>
          ))}
        </details>
      ) : null}
    </section>
  )
}
