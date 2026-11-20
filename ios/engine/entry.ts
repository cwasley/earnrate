// The engine as the iPhone app runs it, in JavaScriptCore. The app loads the
// catalog once, then calls these with JSON strings and reads JSON back, so
// the Swift side never depends on the engine's internal types. Every rule,
// number and sentence the app shows comes from here; Swift only lays it out.
// Node-free, like everything the site bundles.
import {
  openedChange,
  spentChange,
  trackingChange,
} from '../../site/app/bonus-change.ts'
import { pastCardNote } from '../../site/app/card-history.ts'
import { enrollLine, usedSoFarShown } from '../../site/app/credit-enroll.ts'
import { placeKinds } from '../../site/app/place-kinds.ts'
import { QUICK_CARDS } from '../../site/app/quick-cards.ts'
import { walletProblems } from '../../src/data/integrity.ts'
import { cardDetails } from '../../src/engine/card-details.ts'
import {
  cheatSheet,
  EVERYDAY_PURCHASES,
  quickPickText,
} from '../../src/engine/cheat-sheet.ts'
import { checklistRows } from '../../src/engine/checklist.ts'
import {
  changedMarks,
  heldMarks,
  noneChange,
  settledMarks,
  tapChange,
  type MarksChange,
} from '../../src/engine/credit-marks.ts'
import {
  creditChoices,
  creditStates,
  nightStates,
} from '../../src/engine/credits.ts'
import { activationGroup } from '../../src/engine/evaluate.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  membersOnlyLines,
  topOf,
  type ExploreEntry,
} from '../../src/engine/explore.ts'
import {
  activationLabel,
  anniversaryLabel,
  bonusLine,
  cents,
  creditDetailText,
  creditWorth,
  milestoneLine,
  nightDetailText,
  offerLine,
  opensOn,
  PAST_CARDS_LEAD,
  PAST_MONTH_LABELS,
  pickedCount,
  pickLegend,
  POINT_VALUE_RANGE,
  RENEWAL_ASK,
  TRANSFER_POINTS_ASK,
} from '../../src/engine/held-text.ts'
import {
  askText,
  effectiveMemberships,
  membershipName,
  sameGroup,
  tierGroups,
} from '../../src/engine/memberships.ts'
import { milestoneSummaries } from '../../src/engine/milestones.ts'
import { offerHistoryText } from '../../src/engine/offer-history.ts'
import {
  OFFERS_MAY_DIFFER,
  offerCheckedOn,
  offerTerms,
} from '../../src/engine/offers.ts'
import { inEffect, localToday } from '../../src/engine/periods.ts'
import { VALUATION_PROFILES } from '../../src/engine/profiles.ts'
import { noteOnly, recommend } from '../../src/engine/recommend.ts'
import { anniversaryOf } from '../../src/engine/renewal.ts'
import {
  countsForRepeat,
  repeatMonthFields,
  repeatRuleText,
  type MonthAsk,
} from '../../src/engine/repeat-bonus.ts'
import { optionName, pickName } from '../../src/engine/rule-text.ts'
import {
  cardInfo,
  membershipsUsed,
  searchCards,
  setupNotes,
} from '../../src/engine/setup.ts'
import {
  BEST_CARD,
  cantUseLines,
  capitalize,
  categoryAs,
  categoryPhrase,
  CREDIT_GROUP,
  CREDIT_PERIODS,
  CREDIT_THIS_PERIOD,
  creditShort,
  currencyLabel,
  currencyName,
  earnText,
  ENROLL_FIRST,
  EVERY_CARD_NOTE,
  EVERY_CARD_TOO,
  FOR_WELCOME_BONUS,
  foreignFeeText,
  FREE_NIGHT_NAME,
  leftOutLines,
  money,
  MONTH_NAMES,
  NETWORK_NAMES,
  NONE_OF_YOURS,
  onlineAssumption,
  pct,
  placeKindAsk,
  shopperAssumptions,
  shortDate,
  SOMETHING_ELSE,
  unknownStoreExploreWarning,
  unknownStoreTapText,
  unknownStoreWarning,
  USE_CARD,
  verdictDetail,
} from '../../src/engine/text.ts'
import type { MerchantResolution, RankedCard } from '../../src/engine/types.ts'
import { cardValuation, currencyValuation } from '../../src/engine/valuation.ts'
import { wherePhrase } from '../../src/engine/wallet-summary.ts'
import {
  addToWallet,
  MAX_NIGHT_VALUE,
  pastCardInputOf,
  removeFromWallet,
  updateInWallet,
  withMemberships,
  withPastCards,
  withValuations,
  type CardInput,
  type WalletChange,
} from '../../src/engine/wallet-change.ts'
import {
  CARD_CHIP,
  cardArtTones,
  cardColor,
} from '../../src/format/card-art.ts'
import { cardText } from '../../src/format/card-text.ts'
import {
  resolvePlace,
  splitPurchaseText,
  withCallerCategory,
} from '../../src/merchants/resolve.ts'
import type { Card } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import {
  WalletSchema,
  type PastCard,
  type Wallet,
  type WalletCard,
} from '../../src/schema/wallet.ts'

let catalog: Catalog | null = null
let text: ReturnType<typeof cardText> | null = null

function loaded(): Catalog {
  if (catalog === null) throw new Error('Load the catalog first.')
  return catalog
}

function names(): ReturnType<typeof cardText> {
  return (text ??= cardText(loaded()))
}

function cardOf(id: string): Card {
  const card = names().cards.get(id)
  if (!card) throw new Error(`Unknown card '${id}'.`)
  return card
}

// The wallet the app keeps on the phone, checked the same way the CLI and
// the site check theirs. One with nothing in it is no wallet; memberships
// and point values count, since they can be set before any card.
function walletOf(raw: unknown): Wallet | null {
  if (raw === null || raw === undefined) return null
  const wallet = WalletSchema.parse(raw)
  return wallet.cards.length === 0 &&
    (wallet.past_cards ?? []).length === 0 &&
    wallet.memberships.length === 0 &&
    Object.keys(wallet.valuations).length === 0 &&
    (wallet.skipped_issuers ?? []).length === 0
    ? null
    : wallet
}

const EMPTY: Wallet = {
  version: 1,
  valuations: {},
  memberships: [],
  cards: [],
}

const heldIds = (wallet: Wallet | null) =>
  new Set(wallet?.cards.map((c) => c.id) ?? [])

// How the app draws a card: its color, and whether it's light enough to need
// dark marks (src/format/card-art.ts decides both).
export type CardArt = { color: string; chip: string; light: boolean }

function artOf(id: string): CardArt {
  const color = cardColor(loaded(), id)
  return {
    color,
    chip: CARD_CHIP,
    light: cardArtTones(color).stripe === '#000',
  }
}

export type CardRow = {
  id: string
  name: string
  shortName: string
  issuer: string
  fee: string
  art: CardArt
  held: boolean
}

function cardRow(id: string, held: Set<string>): CardRow {
  const { shortName, issuerName, feeLabel } = names()
  const card = cardOf(id)
  return {
    id,
    name: card.name,
    shortName: shortName(id),
    issuer: issuerName(card.issuer),
    fee: feeLabel(id),
    art: artOf(id),
    held: held.has(id),
  }
}

// The words the app's own screens need around the engine's answers.
export type Home = {
  quick: string[]
  months: string[]
  welcome: {
    title: string
    lead: string
    privacy: string
    add: string
    skip: string
    art: CardArt[] // two of the common cards, drawn
  }
  nudge: { text: string; button: string }
  startNote: { yours: string; every: string }
}

// What the store tab shows before anything is typed: the everyday purchases
// as quick picks; and the first-launch welcome.
export function home(): Home {
  return {
    quick: EVERYDAY_PURCHASES.map(quickPickText),
    months: MONTH_NAMES,
    welcome: {
      title: 'earnrate',
      lead: 'Which of your cards earns the most at a store, and why.',
      privacy:
        'Your cards stay on this phone. No account, and never a card number.',
      add: 'Add my cards',
      skip: 'Just check a store',
      art: ['chase-sapphire-preferred', 'amex-gold']
        .filter((id) => names().cards.has(id))
        .map(artOf),
    },
    nudge: {
      text: 'Add your cards for answers from your own wallet.',
      button: 'Add my cards',
    },
    startNote: {
      yours:
        'Answers rank the cards in My wallet. You can switch to every card on any answer.',
      every:
        'Answers cover every card earnrate knows until you add yours in My wallet.',
    },
  }
}

export type Suggestion = { text: string; kind: 'store' | 'place' }

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()

// Stores and kinds of places that match what's typed so far, as the site's
// search box suggests them: names first, then a word in a name, then an
// alias, then anywhere in the name.
export function suggest(request: { query: string; limit?: number }): {
  suggestions: Suggestion[]
} {
  const c = loaded()
  const asked = fold(request.query)
  if (asked === '') return { suggestions: [] }
  const candidates: {
    text: string
    kind: Suggestion['kind']
    terms: string[]
  }[] = [
    ...c.categories
      .filter((cat) => cat.id !== 'other')
      .map((cat) => ({
        text: cat.name,
        kind: 'place' as const,
        terms: [cat.name, ...cat.aliases],
      })),
    ...[...c.merchants.overrides, ...c.merchants.seed].map((m) => ({
      text: m.name,
      kind: 'store' as const,
      terms: [m.name, ...m.aliases],
    })),
  ]
  const score = (terms: string[]): number | null => {
    const [name = '', ...aliases] = terms.map(fold)
    if (name.startsWith(asked)) return 0
    if (name.split(' ').some((w) => w.startsWith(asked))) return 1
    if (aliases.some((a) => a.startsWith(asked))) return 2
    if (name.includes(asked) || aliases.some((a) => a.includes(asked))) return 3
    return null
  }
  const seen = new Set<string>()
  const scored = candidates
    .flatMap((s) => {
      const n = score(s.terms)
      return n === null ? [] : [{ ...s, n }]
    })
    .sort(
      (a, b) =>
        a.n - b.n ||
        a.text.length - b.text.length ||
        a.text.localeCompare(b.text),
    )
    .filter((s) => {
      const key = s.text.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  return {
    suggestions: scored
      .slice(0, request.limit ?? 8)
      .map((s) => ({ text: s.text, kind: s.kind })),
  }
}

export type AnswerRow = {
  rank: number
  card: CardRow
  rate: string
  reason: string // the matched rule, short: "4x Amex Membership Rewards at supermarkets"
  lines: string[] // what earning it takes, a credit to use, the fee
  warnings: string[]
  why: string[] // the engine's full reasoning
}

export type CreditRow = {
  card: CardRow
  amount: string // "$75 back"
  text: string
}

export type Answer = {
  title: string // the store or kind of place, once
  subtitle: string | null // "Counts as a supermarket · $80"
  scope: 'yours' | 'every'
  canChooseScope: boolean // only with cards saved
  scopeNote: string | null
  pick: {
    cardId: string
    label: string // "Use" for your card, "Best card" from every card
    name: string
    detail: string
    reason: string
    warnings: string[]
    art: CardArt
  } | null
  callouts: string[]
  creditsTitle: string
  credits: CreditRow[]
  rankingTitle: string | null
  rows: AnswerRow[] // the ranking after the pick
  more: number // ranked cards not shown until asked
  moreLabel: string | null
  footer: string[]
  // What kind of place an unknown store is, to answer for that instead.
  kinds: {
    lead: string | null // only for a store not known at all
    prompt: string
    quick: { key: string; label: string }[]
    moreLabel: string
    more: { key: string; label: string }[]
    clear: string
  } | null
  kind: string | null
  labels: {
    yours: string
    every: string
    why: string
    cardPage: string
    held: string
  }
}

const TOP = 8

// "as a streaming service, bought online", as the site's answer heading says.
function countsAs(c: Catalog, m: MerchantResolution): string {
  const as = categoryAs(c, m.category)
  return onlineAssumption(c, m, null) !== null && !as.includes('online')
    ? `${as}, bought online`
    : as
}

function titleOf(c: Catalog, m: MerchantResolution): string {
  if (m.source === 'category') return capitalize(categoryPhrase(c, m.category))
  return m.source === 'none' ? `“${m.input}”` : m.resolvedName
}

// The rule that earned the rate, in a few words: "4x Amex Membership Rewards
// at supermarkets", or "2% cash back, its base rate".
function shortReason(r: RankedCard): string {
  const c = loaded()
  const card = cardOf(r.cardId)
  const rule = card.rules.find((x) => x.id === r.matchedRule)
  return rule === undefined
    ? `${earnText(c, card.base_rate, r.currency)}, its base rate`
    : `${earnText(c, rule.rate, r.currency)} ${wherePhrase(c, card, [rule])}`
}

function everyRow(e: ExploreEntry, rank: number, held: Set<string>): AnswerRow {
  const { requirementLines, issuerName, feeLabel } = names()
  return {
    rank,
    card: cardRow(e.cardId, held),
    rate: pct(e.effectiveReturnPct),
    reason: shortReason(e),
    lines: [
      ...requirementLines(e.cardId, e.requirements),
      `${issuerName(e.issuer)} · ${feeLabel(e.cardId, { membership: e.needsMembership !== null })}`,
    ],
    warnings: e.warnings,
    why: e.reasoning,
  }
}

function yourRow(r: RankedCard, rank: number, held: Set<string>): AnswerRow {
  return {
    rank,
    card: cardRow(r.cardId, held),
    rate: pct(r.effectiveReturnPct),
    reason: shortReason(r),
    lines: r.credit ? [creditShort(r.credit, r.credit.dollars)] : [],
    warnings: r.warnings,
    why: r.reasoning,
  }
}

const ANSWER_LABELS = {
  yours: 'Your cards',
  every: 'Every card',
  why: 'Why',
  cardPage: 'Card page',
  held: 'Yours',
}

// One store or category, from the saved cards or from every card. With no
// cards saved, it's every card; that's a whole answer, never a prompt.
export function answer(request: {
  query: string
  wallet?: unknown
  scope?: 'yours' | 'every'
  kind?: string | null
  all?: boolean
  today?: string
}): Answer {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet)
  const held = heldIds(wallet)
  const hasCards = held.size > 0
  const problems = wallet ? walletProblems(wallet, c) : []
  const scope =
    hasCards && problems.length === 0 && request.scope !== 'every'
      ? 'yours'
      : 'every'
  const asked = splitPurchaseText(request.query)
  const kinds = placeKinds(c)
  const kindKey = request.kind ?? null
  const kindCategory =
    kindKey === null
      ? null
      : ([...kinds.quick, ...kinds.more].find((k) => k.key === kindKey)
          ?.category ?? null)
  const resolved = withCallerCategory(
    resolvePlace(c, asked.merchant, null),
    kindCategory,
  )
  const purchase = {
    merchant: asked.merchant,
    amount: asked.amount,
    channel: null,
    date: today,
    country: 'US',
    payment: null,
  }
  const subtitleOf = (m: MerchantResolution) => {
    const parts = [
      ...(m.source !== 'category' && m.source !== 'none'
        ? [capitalize(`counts ${countsAs(c, m)}`)]
        : []),
      ...(asked.amount === null ? [] : [money(asked.amount)]),
    ]
    return parts.length === 0 ? null : parts.join(' · ')
  }
  // On a phone the kinds of places are right there to tap, so the engine's
  // "give its category" warning gives way to one that says to tap.
  const asksKind = (m: MerchantResolution) =>
    m.source === 'none' || m.source === 'caller'
  const kindsFor = (m: MerchantResolution): Answer['kinds'] =>
    asksKind(m)
      ? {
          lead: m.source === 'none' ? unknownStoreTapText(m.input) : null,
          prompt: placeKindAsk(m.resolvedName),
          quick: kinds.quick.map((k) => ({ key: k.key, label: k.label })),
          moreLabel: SOMETHING_ELSE,
          more: kinds.more.map((k) => ({ key: k.key, label: k.label })),
          clear: 'Not sure',
        }
      : null
  const tapInstead = (m: MerchantResolution, warnings: string[]) =>
    m.source === 'none'
      ? warnings.filter(
          (w) =>
            w !== unknownStoreWarning(m.input) &&
            w !== unknownStoreExploreWarning(m.input),
        )
      : warnings
  const { shortName } = names()

  if (scope === 'yours' && wallet) {
    const rec = recommend(c, wallet, purchase, resolved, { today })
    const decided = rec.decision
    const top = rec.ranked.find((r) => r.cardId === decided?.cardId)
    const only = noteOnly(rec)
    const rows = rec.ranked.map((r, i) => yourRow(r, i + 1, held))
    return {
      title: titleOf(c, rec.merchant),
      subtitle: subtitleOf(rec.merchant),
      scope,
      canChooseScope: true,
      scopeNote: null,
      pick:
        decided && top
          ? {
              cardId: decided.cardId,
              label: rec.bonus ? `${USE_CARD}, ${FOR_WELCOME_BONUS}` : USE_CARD,
              name: shortName(decided.cardId),
              detail: verdictDetail(
                decided.effectiveReturnPct,
                top.earned,
                top.credit ?? null,
              ),
              reason: shortReason(top),
              warnings: top.warnings,
              art: artOf(decided.cardId),
            }
          : null,
      callouts: [
        ...(rec.categoryNote ? [rec.categoryNote] : []),
        ...(!only && !decided ? [NONE_OF_YOURS] : []),
        ...cantUseLines(rec.excluded, shortName),
        ...tapInstead(rec.merchant, rec.warnings),
        ...rec.notes,
      ],
      creditsTitle: CREDIT_GROUP,
      credits: [],
      rankingTitle: rows.length > 1 ? 'Your other cards' : null,
      rows: rows.filter((r) => r.card.id !== decided?.cardId),
      more: 0,
      moreLabel: null,
      footer: [
        ...(rec.sensitivity ? [rec.sensitivity] : []),
        ...shopperAssumptions(rec.assumptions),
      ],
      kinds: only ? null : kindsFor(rec.merchant),
      kind: kindKey,
      labels: ANSWER_LABELS,
    }
  }

  const r = exploreCards(
    c,
    { ...purchase, category: null },
    {
      filters: ALL_PERSONAL_CARDS,
      memberships: effectiveMemberships(c, wallet?.memberships ?? [], [
        ...held,
      ]),
      valuations: wallet?.valuations ?? {},
    },
    resolved,
  )
  const only = noteOnly(r)
  const shown = request.all === true ? r : topOf(r, TOP)
  const first = r.ranked[0]
  const more = r.ranked.length - shown.ranked.length
  return {
    title: titleOf(c, r.merchant),
    subtitle: subtitleOf(r.merchant),
    scope: 'every',
    canChooseScope: hasCards && problems.length === 0,
    scopeNote: only ? null : hasCards ? EVERY_CARD_TOO : EVERY_CARD_NOTE,
    pick:
      first === undefined
        ? null
        : {
            cardId: first.cardId,
            label: BEST_CARD,
            name: shortName(first.cardId),
            detail: `${pct(first.effectiveReturnPct)} back`,
            reason: shortReason(first),
            warnings: first.warnings,
            art: artOf(first.cardId),
          },
    callouts: [
      ...problems.map(
        (p) => `The wallet saved on this phone has a problem: ${p}`,
      ),
      ...leftOutLines(r.excluded),
      ...(r.categoryNote ? [r.categoryNote] : []),
      ...tapInstead(r.merchant, r.warnings),
    ],
    creditsTitle: CREDIT_GROUP,
    credits: r.credits.map((p) => ({
      card: cardRow(p.cardId, held),
      amount: `${money(p.amount)} back`,
      text: `${capitalize(CREDIT_PERIODS[p.period])}${p.terms}, then ${p.earn}.${p.enroll ? ` ${capitalize(ENROLL_FIRST)}.` : ''}`,
    })),
    rankingTitle:
      shown.ranked.length > 1
        ? r.credits.length > 0
          ? 'Next, by rate'
          : 'Next best'
        : null,
    rows: shown.ranked.slice(1).map((e, i) => everyRow(e, i + 2, held)),
    more,
    moreLabel: more > 0 ? `Show all ${String(r.ranked.length)} cards` : null,
    footer: [
      ...membersOnlyLines(c, shown.membersOnly, (e) => shortName(e.cardId)),
      ...shopperAssumptions(r.assumptions),
    ],
    kinds: only ? null : kindsFor(r.merchant),
    kind: kindKey,
    labels: ANSWER_LABELS,
  }
}

// Every card for adding cards: the common ones first (an editorial pick,
// the site's), then personal cards by issuer, then business cards by
// issuer. With a search, the engine's card search (names, short names,
// issuers and what they earn on).
export function cards(request: {
  wallet?: unknown
  query?: string
  today?: string
}): {
  quickTitle: string
  quick: CardRow[]
  groups: { id: string; title: string; index: string; cards: CardRow[] }[]
  searchPrompt: string
} {
  const c = loaded()
  const wallet = walletOf(request.wallet)
  const held = heldIds(wallet)
  const query = request.query?.trim() ?? ''
  const base = {
    quickTitle: 'Common cards',
    searchPrompt: 'Card name or issuer',
  }
  if (query.length >= 2) {
    const found = searchCards(c, query, wallet, request.today ?? localToday())
    return {
      ...base,
      quick: [],
      groups:
        found.cards.length === 0
          ? []
          : [
              {
                id: 'found',
                title: '',
                index: '',
                cards: found.cards.map((k) => cardRow(k.id, held)),
              },
            ],
    }
  }
  const byIssuer = (business: boolean) => {
    const groups = new Map<string, CardRow[]>()
    for (const card of c.cards.filter((k) => k.business === business)) {
      const row = cardRow(card.id, held)
      groups.set(row.issuer, [...(groups.get(row.issuer) ?? []), row])
    }
    return [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([issuer, list]) => ({
        id: `${business ? 'business' : 'personal'}:${issuer}`,
        title: business ? `${issuer} business` : issuer,
        index: business ? '' : issuer.slice(0, 1).toUpperCase(),
        cards: list.sort((a, b) => a.shortName.localeCompare(b.shortName)),
      }))
  }
  const personal = byIssuer(false)
  const business = byIssuer(true)
  // One index letter per letter, on its first issuer; business cards share
  // one entry at the end.
  const seen = new Set<string>()
  for (const g of personal) {
    if (seen.has(g.index)) g.index = ''
    else seen.add(g.index)
  }
  const [firstBusiness] = business
  if (firstBusiness) firstBusiness.index = 'Biz'
  return {
    ...base,
    quick: QUICK_CARDS.filter((id) => names().cards.has(id)).map((id) =>
      cardRow(id, held),
    ),
    groups: [...personal, ...business],
  }
}

// The saved cards, in the order they were added, and anything wrong with
// the saved file.
export function walletCards(request: { wallet?: unknown }): {
  cards: CardRow[]
  problems: string[]
} {
  const c = loaded()
  const wallet = walletOf(request.wallet)
  if (!wallet) return { cards: [], problems: [] }
  const held = heldIds(wallet)
  return {
    cards: wallet.cards
      .filter((k) => names().cards.has(k.id))
      .map((k) => cardRow(k.id, held)),
    problems: walletProblems(wallet, c),
  }
}

export type Change =
  | { ok: true; wallet: Wallet | null; notes: string[] }
  | { ok: false; error: string }

const changed = (result: WalletChange): Change =>
  result.ok
    ? {
        ok: true,
        wallet: walletOf(result.wallet),
        notes: result.notes.map((n) => n.text),
      }
    : { ok: false, error: result.error }

// Adding and removing go through the same rules as the CLI, Claude and the
// site, so what's refused and why reads the same everywhere.
export function addCard(request: {
  wallet?: unknown
  id: string
  today?: string
}): Change {
  return changed(
    addToWallet(
      loaded(),
      walletOf(request.wallet),
      { id: request.id },
      request.today ?? localToday(),
    ),
  )
}

// With `keep`, the card stays under Cards you've had, closed this month.
export function removeCard(request: {
  wallet?: unknown
  id: string
  keep?: boolean
  today?: string
}): Change {
  const wallet = walletOf(request.wallet)
  if (!wallet) return { ok: false, error: `${request.id} isn't in the wallet.` }
  return changed(
    removeFromWallet(
      wallet,
      request.id,
      request.keep === true ? { today: request.today ?? localToday() } : null,
    ),
  )
}

// What removing a card asks: whether to keep it under Cards you've had,
// offered only for a card an issuer's repeat-bonus rule can count.
export function removal(request: { id: string }): {
  title: string
  remove: string
  keep: string | null
} {
  const name = names().shortName(request.id)
  return {
    title: `Remove ${name}?`,
    remove: 'Remove',
    keep: countsForRepeat(loaded(), request.id)
      ? "Remove, and keep it under Cards you've had"
      : null,
  }
}

// ---------------------------------------------------------------------------
// After adding cards: only what changes their answers, every part skippable.

export type Toggle = { id: string; label: string; on: boolean }
export type Menu = {
  id: string
  label: string
  none: string
  options: { id: string; label: string }[]
  selected: string | null
}

export type PickGroup = {
  choice: string
  legend: string
  count: string
  single: boolean
  options: { id: string; label: string; on: boolean; enabled: boolean }[]
  info: { question: string; answer: string }[] // which stores a pick covers
}

export type ActivationRow = {
  rule: string
  label: string
  on: boolean
  opens: string | null // "Opens Dec 15", when the issuer hasn't opened it
}

function pickGroups(c: Catalog, card: Card, held: WalletCard, today: string) {
  const info = cardInfo(c, card, null, today)
  const picks = held.chosen?.picks ?? {}
  return info.choices.map((choice): PickGroup => {
    const chosen = picks[choice.id] ?? []
    const one = choice.pick === 1
    return {
      choice: choice.id,
      legend: pickLegend(choice),
      count: pickedCount(chosen.length, choice.pick),
      single: one,
      options: choice.options.map((o) => ({
        id: o,
        label: capitalize(pickName(c, card, choice.id, o)),
        on: chosen.includes(o),
        enabled: one || chosen.includes(o) || chosen.length < choice.pick,
      })),
      info: choice.options
        .filter(
          (o) =>
            pickName(c, card, choice.id, o) !==
            optionName(c, card, choice.id, o),
        )
        .map((o) => ({
          question: `Which stores are ${pickName(c, card, choice.id, o)}?`,
          answer: `${capitalize(optionName(c, card, choice.id, o))}.`,
        })),
    }
  })
}

function activationRows(
  c: Catalog,
  card: Card,
  held: WalletCard,
  today: string,
): ActivationRow[] {
  const info = cardInfo(c, card, null, today)
  return info.activation
    .filter(
      (rule, i) =>
        info.activation.findIndex((r) =>
          activationGroup(card, r).includes(rule),
        ) === i,
    )
    .map((rule) => {
      const group = activationGroup(card, rule)
      const on = group.some((r) => held.activated.includes(r))
      const opens = on
        ? undefined
        : group.map((r) => info.activationOpens[r]).find((d) => d !== undefined)
      return {
        rule,
        label: activationLabel(c, card, rule),
        on,
        opens: opens === undefined ? null : `Opens ${opensOn(opens)}`,
      }
    })
}

// The memberships asked about: a toggle each, and a menu per group of tiers
// (BofA Preferred Rewards). `only` limits them to these memberships' own.
function membershipQuestions(
  c: Catalog,
  memberships: string[],
  only: Set<string> | null,
): { toggles: Toggle[]; menus: Menu[] } {
  const groups = tierGroups(c)
  const inGroup = new Set(groups.flatMap((g) => g.tiers.map((t) => t.id)))
  const toggles = c.memberships.flatMap((m) => {
    if (inGroup.has(m.id) || (only !== null && !only.has(m.id))) return []
    const label =
      askText(c, m) ?? (only === null ? null : membershipName(c, m.id))
    return label === null
      ? []
      : [{ id: m.id, label, on: memberships.includes(m.id) }]
  })
  const menus = groups
    .filter((g) => only === null || g.tiers.some((t) => only.has(t.id)))
    .map((g) => ({
      id: g.group,
      label: g.label,
      none: 'None',
      options: g.tiers.map((t) => ({ id: t.id, label: t.name })),
      selected: g.tiers.find((t) => memberships.includes(t.id))?.id ?? null,
    }))
  return { toggles, menus }
}

export type SetupCard = {
  card: CardRow
  picks: PickGroup[]
  activations: ActivationRow[]
  activationsTitle: string
  notes: string[] // a quarter the issuer hasn't posted
}

export type Setup = {
  title: string
  lead: string
  cards: SetupCard[]
  memberships: { title: string; toggles: Toggle[]; menus: Menu[] } | null
  skip: string
  done: string
}

// What the cards just added need for their answers to be right: picks,
// memberships and activations, as the engine's setup notes find them. A card
// with none of those isn't listed; with none at all, there's nothing to ask.
// What was asked comes back as `asked`, and passing it in again keeps the
// same questions on screen once they're answered.
export type SetupAsked = {
  picks: string[] // card ids
  activations: string[]
  memberships: string[] // membership ids
}

export function setup(request: {
  wallet?: unknown
  ids: string[]
  asked?: SetupAsked
  today?: string
}): Setup & { asked: SetupAsked } {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet) ?? EMPTY
  const held = heldIds(wallet)
  const added = wallet.cards.filter((h) => request.ids.includes(h.id))
  const notesOf = (h: WalletCard) => setupNotes(c, wallet, h, today)
  const asked: SetupAsked = request.asked ?? {
    picks: added
      .filter((h) => notesOf(h).some((n) => n.kind === 'pick'))
      .map((h) => h.id),
    activations: added
      .filter((h) => notesOf(h).some((n) => n.kind === 'activation'))
      .map((h) => h.id),
    memberships: (() => {
      const used = new Set(
        added.flatMap((h) => {
          const card = names().cards.get(h.id)
          return card ? membershipsUsed(card) : []
        }),
      )
      const has = effectiveMemberships(c, wallet.memberships, [...held])
      return [...used].filter(
        (m) => !has.some((x) => x === m || sameGroup(c, x, m)),
      )
    })(),
  }
  const cards = added.flatMap((h): SetupCard[] => {
    const card = names().cards.get(h.id)
    if (!card) return []
    const picks = asked.picks.includes(h.id)
      ? pickGroups(c, card, h, today)
      : []
    const activations = asked.activations.includes(h.id)
      ? activationRows(c, card, h, today)
      : []
    const rotation = notesOf(h).filter((n) => n.kind === 'rotation')
    if (picks.length === 0 && activations.length === 0 && rotation.length === 0)
      return []
    return [
      {
        card: cardRow(h.id, held),
        picks,
        activations,
        activationsTitle: `Bonuses you've activated with ${names().issuerName(card.issuer)}`,
        notes: rotation.map((n) => n.text),
      },
    ]
  })
  const questions = membershipQuestions(
    c,
    wallet.memberships,
    new Set(asked.memberships),
  )
  const memberships =
    questions.toggles.length + questions.menus.length === 0
      ? null
      : { title: 'Memberships', ...questions }
  return {
    title: 'A few details',
    lead: 'These change which card earns the most. Skip any you’re not sure of.',
    cards,
    memberships,
    skip: 'Skip',
    done: 'Done',
    asked,
  }
}

// ---------------------------------------------------------------------------
// My wallet

export type TodoRow = {
  id: string
  cardId: string
  art: CardArt
  title: string
  detail: string // "Amex Gold · $7 left"
  when: string | null
  button: string | null
  url: string | null // the issuer's page, or one of earnrate.dev's
  focus: 'picks' | 'activations' | 'credits' | 'bonus' | 'anniversary' | null
}

export type WalletHome = {
  searchPrompt: string
  todoTitle: string
  todoShown: number // rows shown before "N more"
  todoMore: string | null
  todoFewer: string
  todo: TodoRow[]
  notes: { text: string; button: string | null; url: string | null }[]
  sheet: {
    title: string
    subtitle: string
    rows: {
      label: string
      query: string | null // the search a row opens; null for Abroad
      cardId: string | null
      name: string
      rate: string
      note: string | null
      art: CardArt | null
    }[]
  } | null
  cardsTitle: string
  cards: { card: CardRow; note: string | null; ask: boolean; action: string }[]
  addCards: string
  past: { title: string; count: string }
  settings: string
  problems: string[]
}

const focusOf = (kind: string): TodoRow['focus'] => {
  switch (kind) {
    case 'pick':
      return 'picks'
    case 'activate':
      return 'activations'
    case 'credit':
    case 'enroll':
      return 'credits'
    case 'bonus':
    case 'milestone':
    case 'intro':
      return 'bonus'
    case 'renewal':
    case 'cap':
      return 'anniversary'
    default:
      return null
  }
}

// Rows past these wait behind "N more", as on the site; the list is
// soonest first.
const TODO_SHOWN = 3

const cardCount = (n: number) => `${String(n)} card${n === 1 ? '' : 's'}`

// My wallet, top to bottom: the to-do, the cheat sheet, the cards and what
// each needs, and how many cards the person used to have.
export function walletHome(request: {
  wallet?: unknown
  today?: string
}): WalletHome {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet)
  const held = heldIds(wallet)
  const { shortName } = names()
  const problems = wallet ? walletProblems(wallet, c) : []
  const past = wallet?.past_cards ?? []
  const base = {
    searchPrompt: 'Which card at…',
    todoTitle: 'To do',
    todoFewer: 'Show fewer',
    cardsTitle: 'Your cards',
    addCards: 'Add cards',
    past: {
      title: "Cards you've had",
      count: past.length === 0 ? 'None' : cardCount(past.length),
    },
    settings: 'Memberships and point values',
    problems,
  }
  if (!wallet || wallet.cards.length === 0 || problems.length > 0)
    return {
      ...base,
      todo: [],
      todoShown: TODO_SHOWN,
      todoMore: null,
      notes: [],
      sheet: null,
      cards: [],
    }
  const items = checklistRows(c, wallet, today, undefined, shortName)
  const todo = items
    .filter((i) => i.row.note !== true)
    .map((i): TodoRow => ({
      id: `${i.kind}-${i.cardId}-${i.ref ?? i.text}`,
      cardId: i.cardId,
      art: artOf(i.cardId),
      title: i.row.title,
      detail:
        i.row.amount === null ? i.row.card : `${i.row.card} · ${i.row.amount}`,
      when: i.row.when,
      button: i.row.button,
      url: i.row.url ?? null,
      focus: focusOf(i.kind),
    }))
  const notes = items
    .filter((i) => i.row.note === true)
    .map((i) => ({
      text: i.row.title,
      button: i.row.url === undefined ? null : i.row.button,
      url: i.row.url ?? null,
    }))
  const sheet = cheatSheet(c, wallet, today)
  return {
    ...base,
    todo,
    todoShown: TODO_SHOWN,
    todoMore:
      todo.length > TODO_SHOWN
        ? `${String(todo.length - TODO_SHOWN)} more`
        : null,
    notes,
    sheet: {
      title: 'Cheat sheet',
      subtitle: `${sheet.quarter} · the card to use for each purchase`,
      rows: sheet.rows.map((row, i) => {
        const item = EVERYDAY_PURCHASES[i]
        return {
          label: row.label,
          query: item ? quickPickText(item) : null,
          cardId: row.cardId,
          name:
            row.cardId === null ? 'None of your cards' : shortName(row.cardId),
          rate:
            row.effectiveReturnPct === null ? '' : pct(row.effectiveReturnPct),
          note: row.note,
          art: row.cardId === null ? null : artOf(row.cardId),
        }
      }),
    },
    cards: wallet.cards
      .filter((h) => names().cards.has(h.id))
      .map((h) => {
        const card = cardOf(h.id)
        const info = cardInfo(c, card, wallet, today)
        const needsPick = info.choices.some(
          (x) => x.default === null && !h.chosen?.picks[x.id],
        )
        const note =
          bonusLine(c, wallet, h, today) ?? milestoneLine(card, h, today)
        const ask =
          note === null &&
          (card.annual_fee ?? 0) > 0 &&
          anniversaryOf(h) === null
        return {
          card: cardRow(h.id, held),
          note: note ?? (ask ? RENEWAL_ASK : null),
          ask: note === null && (ask || needsPick),
          action: needsPick ? 'Set picks' : 'Settings',
        }
      }),
  }
}

// ---------------------------------------------------------------------------
// A saved card's settings: only what that card needs.

export type CardSettings = {
  card: CardRow
  note: string | null
  picks: PickGroup[]
  activationsTitle: string
  activations: ActivationRow[]
  credits: {
    title: string
    all: string
    none: string
    tiles: {
      id: string
      name: string
      worth: string | null
      answer: 'used' | 'skipped' | null
      state: string // "Used", "Not used", "Not answered", for VoiceOver
    }[]
    enroll: string | null
    detailsTitle: string
    details: {
      id: string
      name: string
      text: string
      used: { label: string; value: number; max: number } | null
      night: { label: string; value: number | null; placeholder: string } | null
    }[]
  } | null
  anniversary: { label: string; month: number; day: number } | null
  intro: {
    title: string
    lines: string[]
    label: string
    opened: string | null
  } | null
  bonus: {
    title: string
    offer: string
    label: string
    tracking: boolean
    openedLabel: string
    opened: string | null
    spentLabel: string
    spent: number
  } | null
  milestone: {
    title: string
    lines: string[]
    label: string
    spent: number | null
  } | null
  remove: string
  cardPage: string
}

const STATE_WORDS = { used: 'Used', skipped: 'Not used' }

export function cardSettings(request: {
  wallet?: unknown
  id: string
  today?: string
}): CardSettings {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet) ?? EMPTY
  const card = cardOf(request.id)
  const h = wallet.cards.find((k) => k.id === card.id)
  if (!h) throw new Error(`${names().shortName(card.id)} isn't in My wallet.`)
  const info = cardInfo(c, card, wallet, today)
  const choices = creditChoices(c, card, h, today, wallet.valuations)
  const credits = creditStates(c, card, h, today)
  const nights = nightStates(c, wallet.valuations, card, h)
  const milestones = milestoneSummaries(card, h, today)
  const tracked = milestones.find((m) => m.tracked)
  const fee = (card.annual_fee ?? 0) > 0
  const anniversary = anniversaryOf(h)
  const cents = currencyValuation(c, wallet, card.currency).centsPerUnit
  return {
    card: cardRow(card.id, heldIds(wallet)),
    note: bonusLine(c, wallet, h, today) ?? milestoneLine(card, h, today),
    picks: pickGroups(c, card, h, today),
    activationsTitle: `Bonuses you've activated with ${names().issuerName(card.issuer)}`,
    activations: activationRows(c, card, h, today),
    credits:
      choices.length === 0
        ? null
        : {
            title: 'Credits you use',
            all: 'All',
            none: 'None',
            tiles: choices.map((x) => ({
              id: x.id,
              name: x.name,
              worth: creditWorth(x),
              answer: x.answer,
              state: x.answer === null ? 'Not answered' : STATE_WORDS[x.answer],
            })),
            enroll: enrollLine(c, card.id, choices),
            detailsTitle: 'Credit details',
            details: [
              ...credits.map((x) => ({
                id: x.credit.id,
                name: capitalize(x.name),
                text: creditDetailText(x),
                used: usedSoFarShown(x)
                  ? {
                      label: `Used so far ${CREDIT_THIS_PERIOD[x.period]}`,
                      value: x.used,
                      max: x.periodAmount,
                    }
                  : null,
                night: null,
              })),
              ...nights.map((n) => ({
                id: n.night.id,
                name: capitalize(FREE_NIGHT_NAME),
                text: nightDetailText(c, card, n, cents),
                used: null,
                night: {
                  label: `Worth to you${n.value === null ? '' : ' (optional)'}, in dollars`,
                  value: n.own,
                  placeholder:
                    n.value === null ? '' : String(Math.round(n.value)),
                },
              })),
            ],
          },
    anniversary:
      info.needsAnniversary || fee
        ? {
            label: anniversaryLabel(info.needsAnniversary, fee),
            month: Number(anniversary?.slice(0, 2) ?? 0),
            day: Number(anniversary?.slice(3, 5) ?? 0),
          }
        : null,
    intro:
      info.introRates.length === 0
        ? null
        : {
            title: 'First-year rate',
            lines: info.introRates.map((i) => `${capitalize(i.text)}.`),
            label: 'Account opened',
            opened: h.opened ?? h.bonus?.opened ?? null,
          },
    bonus:
      card.welcome_offer || h.bonus
        ? {
            title: 'Welcome bonus',
            offer: offerLine(c, card, today),
            label: "I'm working on this card's welcome bonus",
            tracking: h.bonus !== undefined,
            openedLabel: 'Account opened',
            opened: h.bonus?.opened ?? h.opened ?? null,
            spentLabel: 'Spent toward it so far',
            spent: h.bonus?.spent ?? 0,
          }
        : null,
    milestone:
      milestones.length === 0
        ? null
        : {
            title: 'Spend bonus',
            lines: info.milestones.map((m) => m.text),
            label: 'Spent on this card so far this year',
            spent: tracked ? tracked.spent : null,
          },
    remove: 'Remove from My wallet',
    cardPage: 'Card page',
  }
}

// One change from a card's settings, made by the same rules the site's
// controls follow, then saved through the wallet's update rules.
export type CardEdit =
  | { pick: { choice: string; option: string } }
  | { activate: { rule: string; on: boolean } }
  | { credit: { tap: string; before: 'used' | 'skipped' | null } }
  | { credits: 'all' | 'none' }
  | { creditUsed: { id: string; dollars: number } }
  | { nightValue: { id: string; dollars: number | null } }
  | { anniversary: { month: number; day: number } }
  | { tracking: { on: boolean; opened: string | null } }
  | { opened: { date: string | null; tracking: boolean } }
  | { spent: { dollars: number; opened: string | null } }
  | { milestoneSpent: number }

const two = (n: number) => String(n).padStart(2, '0')

function cardInputFor(
  c: Catalog,
  wallet: Wallet,
  card: Card,
  h: WalletCard,
  edit: CardEdit,
  today: string,
): Omit<CardInput, 'id'> | null {
  if ('pick' in edit) {
    const choice = card.choices.find((x) => x.id === edit.pick.choice)
    if (!choice) return null
    const chosen = h.chosen?.picks[choice.id] ?? []
    const option = edit.pick.option
    const on = chosen.includes(option)
    const next =
      choice.pick === 1
        ? [option]
        : on
          ? chosen.filter((o) => o !== option)
          : chosen.length < choice.pick
            ? [...chosen, option]
            : chosen
    return { picks: { [choice.id]: next } }
  }
  if ('activate' in edit) {
    const group = activationGroup(card, edit.activate.rule)
    return {
      activated: edit.activate.on
        ? [...new Set([...h.activated, edit.activate.rule])]
        : h.activated.filter((r) => !group.includes(r)),
    }
  }
  if ('credit' in edit || 'credits' in edit) {
    const choices = creditChoices(c, card, h, today, wallet.valuations)
    let change: MarksChange
    if ('credit' in edit) {
      const tile = choices.find((x) => x.id === edit.credit.tap)
      if (!tile) return null
      change = tapChange(tile, edit.credit.before)
    } else {
      change =
        edit.credits === 'all'
          ? { use: choices.map((x) => x.id) }
          : noneChange(choices)
    }
    const marks = settledMarks(
      card,
      h,
      changedMarks(heldMarks(card, h), change),
    )
    return { enrolled: marks.used, skippedCredits: marks.skipped }
  }
  if ('creditUsed' in edit)
    return {
      creditUsed: {
        [edit.creditUsed.id]: Math.max(0, edit.creditUsed.dollars),
      },
    }
  if ('nightValue' in edit) {
    const d = edit.nightValue.dollars
    return {
      nightValues: {
        [edit.nightValue.id]:
          d === null || d <= 0 ? null : Math.min(d, MAX_NIGHT_VALUE),
      },
    }
  }
  if ('anniversary' in edit) {
    const { month, day } = edit.anniversary
    return month > 0 && day > 0
      ? { anniversary: `${two(month)}-${two(day)}` }
      : null
  }
  if ('tracking' in edit)
    return trackingChange(h, edit.tracking.on, edit.tracking.opened ?? '', '')
  if ('opened' in edit)
    return openedChange(h, edit.opened.date ?? '', {
      tracking: edit.opened.tracking,
      introRates: cardInfo(c, card, null, today).introRates.length > 0,
      unsaved: '',
    })
  if ('spent' in edit)
    return spentChange(h, edit.spent.opened ?? '', String(edit.spent.dollars))
  const dollars = Math.max(0, edit.milestoneSpent)
  return {
    milestoneSpent: Object.fromEntries(
      milestoneSummaries(card, h, today).map((m) => [m.id, dollars]),
    ),
  }
}

export function editCard(request: {
  wallet?: unknown
  id: string
  edit: CardEdit
  today?: string
}): Change {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet)
  const h = wallet?.cards.find((k) => k.id === request.id)
  if (!wallet || !h)
    return { ok: false, error: `${request.id} isn't in the wallet.` }
  const input = cardInputFor(c, wallet, cardOf(h.id), h, request.edit, today)
  if (input === null) return { ok: true, wallet, notes: [] }
  return changed(updateInWallet(c, wallet, { id: h.id, ...input }, today))
}

// ---------------------------------------------------------------------------
// Memberships and point values

export type WalletSettings = {
  membershipsTitle: string
  membershipsLead: string
  // The ones the saved cards use, or already on; the rest folded away.
  toggles: Toggle[]
  menus: Menu[]
  othersTitle: string
  otherToggles: Toggle[]
  otherMenus: Menu[]
  points: {
    title: string
    transfer: Toggle | null
    values: {
      id: string
      name: string
      cents: number
      text: string // "1.7¢"
      own: boolean
      reset: string
    }[]
    range: string
    min: number
    max: number
    step: number
  } | null
}

const HEAVY: Record<string, number> = VALUATION_PROFILES['points-heavy']

export function walletSettings(request: { wallet?: unknown }): WalletSettings {
  const c = loaded()
  const wallet = walletOf(request.wallet) ?? EMPTY
  const { toggles, menus } = membershipQuestions(c, wallet.memberships, null)
  const used = new Set(
    wallet.cards.flatMap((h) => {
      const card = names().cards.get(h.id)
      return card ? membershipsUsed(card) : []
    }),
  )
  const relevant = (id: string) =>
    used.has(id) || wallet.memberships.includes(id)
  const tiersUsed = (m: Menu) =>
    m.selected !== null || m.options.some((o) => used.has(o.id))
  const ids = [
    ...new Set(
      wallet.cards.flatMap((h) => {
        const card = names().cards.get(h.id)
        return card ? [cardValuation(c, wallet, card).currency] : []
      }),
    ),
  ].filter((id) => id !== 'cash')
  const valueOf = (id: string) => {
    const own = wallet.valuations[id]
    return typeof own === 'number'
      ? own
      : (c.currencies.find((x) => x.id === id)?.value_cents ?? 1)
  }
  const transferable = ids.filter((id) => HEAVY[id] !== undefined)
  return {
    membershipsTitle: 'Memberships',
    membershipsLead: 'Some cards earn more with these.',
    toggles: toggles.filter((t) => relevant(t.id)),
    menus: menus.filter(tiersUsed),
    othersTitle: 'Other memberships',
    otherToggles: toggles.filter((t) => !relevant(t.id)),
    otherMenus: menus.filter((m) => !tiersUsed(m)),
    points:
      ids.length === 0
        ? null
        : {
            title: 'Point values',
            transfer:
              transferable.length === 0
                ? null
                : {
                    id: 'transfer',
                    label: TRANSFER_POINTS_ASK,
                    on: transferable.every(
                      (id) => wallet.valuations[id] === HEAVY[id],
                    ),
                  },
            values: ids.map((id) => ({
              id,
              name: currencyLabel(c, id),
              cents: valueOf(id),
              text: cents(valueOf(id)),
              own: typeof wallet.valuations[id] === 'number',
              reset: 'Reset',
            })),
            range: POINT_VALUE_RANGE,
            min: 0.1,
            max: 5,
            step: 0.1,
          },
  }
}

export type SettingsEdit =
  | { membership: { id: string; on: boolean } }
  | { tier: { group: string; id: string | null } }
  | { transfer: boolean }
  | { pointValue: { id: string; cents: number | null } }

export function editSettings(request: {
  wallet?: unknown
  edit: SettingsEdit
}): Change {
  const c = loaded()
  const wallet = walletOf(request.wallet) ?? EMPTY
  const { edit } = request
  const has = wallet.memberships
  if ('membership' in edit) {
    const { id, on } = edit.membership
    return changed(
      withMemberships(
        c,
        wallet,
        on ? [...has, id] : has.filter((m) => m !== id),
      ),
    )
  }
  if ('tier' in edit) {
    const tiers = tierGroups(c).find((g) => g.group === edit.tier.group)?.tiers
    const ids = tiers?.map((t) => t.id) ?? []
    return changed(
      withMemberships(c, wallet, [
        ...has.filter((m) => !ids.includes(m)),
        ...(edit.tier.id === null ? [] : [edit.tier.id]),
      ]),
    )
  }
  if ('transfer' in edit) {
    const ids =
      walletSettings({ wallet })
        .points?.values.map((v) => v.id)
        .filter((id) => HEAVY[id] !== undefined) ?? []
    return changed(
      withValuations(
        c,
        wallet,
        Object.fromEntries(
          ids.map((id) => [id, edit.transfer ? (HEAVY[id] ?? null) : null]),
        ),
      ),
    )
  }
  const value = edit.pointValue.cents
  return changed(
    withValuations(c, wallet, {
      [edit.pointValue.id]:
        value === null
          ? null
          : Math.min(5, Math.max(0.1, Math.round(value * 10) / 10)),
    }),
  )
}

// ---------------------------------------------------------------------------
// Cards you've had

export type PastRow = {
  index: number
  card: CardRow
  months: {
    field: MonthAsk['field']
    label: string
    month: string | null // YYYY-MM
    never: boolean // a bonus that was never paid
    neverLabel: string | null
  }[]
  text: string | null
  ask: { label: string; ask: MonthAsk } | null
}

export type PastCards = {
  title: string
  lead: string
  rows: PastRow[]
  addTitle: string
  add: { issuer: string; cards: CardRow[] }[]
  remove: string
}

export function pastCards(request: {
  wallet?: unknown
  today?: string
}): PastCards {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet) ?? EMPTY
  const held = heldIds(wallet)
  const past = wallet.past_cards ?? []
  const { shortName } = names()
  const rows = past.flatMap((p, i): PastRow[] => {
    if (!names().cards.has(p.id)) return []
    const fields = repeatMonthFields(c, p.id)
    const again = pastCardNote(c, wallet, p.id, today)
    const ask =
      again.ask !== null &&
      !(
        !again.ask.held &&
        again.ask.pastIndex === i &&
        fields.includes(again.ask.field)
      )
        ? again.ask
        : null
    return [
      {
        index: i,
        card: cardRow(p.id, held),
        months: fields.map((field) => {
          const month = p[field]
          return {
            field,
            label: PAST_MONTH_LABELS[field],
            month: typeof month === 'string' ? month : null,
            never: month === false,
            neverLabel: field === 'bonus_received' ? 'It never paid one' : null,
          }
        }),
        text: again.text,
        ask:
          ask === null
            ? null
            : {
                label: `${shortName(ask.cardId)}: ${PAST_MONTH_LABELS[ask.field].toLowerCase()}`,
                ask,
              },
      },
    ]
  })
  const byIssuer = new Map<string, CardRow[]>()
  for (const card of c.cards) {
    if (!countsForRepeat(c, card.id) || past.some((p) => p.id === card.id))
      continue
    const row = cardRow(card.id, held)
    byIssuer.set(row.issuer, [...(byIssuer.get(row.issuer) ?? []), row])
  }
  return {
    title: "Cards you've had",
    lead: PAST_CARDS_LEAD,
    rows,
    addTitle: "Add a card you've had",
    add: [...byIssuer]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([issuer, list]) => ({
        issuer,
        cards: list.sort((a, b) => a.shortName.localeCompare(b.shortName)),
      })),
    remove: 'Remove',
  }
}

export type PastEdit =
  | { add: string }
  | { remove: number }
  | {
      month: {
        index: number
        field: MonthAsk['field']
        month: string | null
        never?: boolean
      }
    }
  | { ask: { ask: MonthAsk; month: string } }

export function editPastCards(request: {
  wallet?: unknown
  edit: PastEdit
  today?: string
}): Change {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet) ?? EMPTY
  const past = wallet.past_cards ?? []
  const { edit } = request
  const save = (list: PastCard[]) =>
    changed(withPastCards(c, wallet, list.map(pastCardInputOf), today))
  if ('add' in edit) return save([...past, { id: edit.add }])
  if ('remove' in edit) return save(past.filter((_, i) => i !== edit.remove))
  if ('month' in edit) {
    const { index, field, month, never } = edit.month
    return save(
      past.map((p, i) => {
        if (i !== index) return p
        const { [field]: _, ...rest } = p
        const value: string | false | null =
          never === true && field === 'bonus_received' ? false : month
        return value === null ? rest : { ...rest, [field]: value }
      }),
    )
  }
  const { ask, month } = edit.ask
  if (ask.held)
    return ask.field === 'bonus_received' &&
      wallet.cards.some((k) => k.id === ask.cardId)
      ? changed(
          updateInWallet(
            c,
            wallet,
            { id: ask.cardId, bonusReceived: month },
            today,
          ),
        )
      : { ok: false, error: 'That card is no longer in My wallet.' }
  if (ask.pastIndex === null || past[ask.pastIndex]?.id !== ask.cardId)
    return {
      ok: false,
      error: "That card is no longer under Cards you've had.",
    }
  return save(
    past.map((p, i) =>
      i === ask.pastIndex ? { ...p, [ask.field]: month } : p,
    ),
  )
}

// ---------------------------------------------------------------------------
// A card's page

export type CardPage = {
  id: string
  name: string
  shortName: string
  issuer: string
  network: string
  fee: string
  foreignFee: string
  art: CardArt
  held: boolean
  earning: string[]
  ratesNote: string | null
  offer: {
    terms: string
    asOf: string
    again: string
    note: string | null
    mayDiffer: string
  } | null
  offerHistory: string | null
  credits: string[]
  perks: string[] // free nights, yearly points, spend bonuses, intro rates
  feeWorth: string | null
  changes: string[]
  checked: string
  sources: string[]
}

// A card's page: what the site's card page and search_cards say about it.
export function cardPage(request: {
  id: string
  wallet?: unknown
  today?: string
}): CardPage {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet)
  const card = cardOf(request.id)
  const row = cardRow(card.id, heldIds(wallet))
  const info = cardInfo(c, card, wallet, today)
  const [details] = cardDetails(c, [card.id], wallet, today) ?? []
  const o = card.welcome_offer
  const offer =
    o && inEffect(o, today)
      ? {
          terms: `${offerTerms(o, currencyName(c, card.currency))}${o.valid_to ? `, through ${shortDate(o.valid_to)}` : ''}.`,
          asOf: `Per the issuer's page as of ${shortDate(offerCheckedOn(card))}.`,
          again: repeatRuleText(c, card),
          note: o.note ?? null,
          mayDiffer: OFFERS_MAY_DIFFER,
        }
      : null
  return {
    id: card.id,
    name: card.name,
    shortName: row.shortName,
    issuer: row.issuer,
    network: NETWORK_NAMES[card.network] ?? card.network,
    fee: row.fee,
    foreignFee: foreignFeeText(card.foreign_transaction_fee),
    art: row.art,
    held: row.held,
    earning: details?.earning ?? [],
    ratesNote: info.ratesNote,
    offer,
    offerHistory: offerHistoryText(c, card, today)?.lead ?? null,
    credits: info.credits.map((k) => capitalize(k.text)),
    perks: [
      ...info.freeNights.map((n) => capitalize(n.text)),
      ...info.yearlyPoints.map((y) => capitalize(y.text)),
      ...info.milestones.map((m) => capitalize(m.text)),
      ...info.introRates.map((i) => `New accounts: ${i.text}`),
    ],
    feeWorth: details?.feeWorth?.text ?? null,
    changes: details?.changes ?? [],
    checked: `Checked against the issuer's terms ${shortDate(card.last_verified)}.`,
    sources: card.source_urls,
  }
}

// Tests hand the catalog over directly; the app parses it from the bundle.
export function useCatalog(next: Catalog): number {
  catalog = next
  text = null
  return next.cards.length
}

// Each call takes one JSON request and answers with JSON.
const call =
  (f: (request: never) => unknown) =>
  (request: string): string =>
    JSON.stringify(f(JSON.parse(request) as never))

const engine = {
  load: (json: string): number => useCatalog(JSON.parse(json) as Catalog),
  home: call(home),
  suggest: call(suggest),
  answer: call(answer),
  cards: call(cards),
  walletCards: call(walletCards),
  addCard: call(addCard),
  removeCard: call(removeCard),
  removal: call(removal),
  setup: call(setup),
  walletHome: call(walletHome),
  cardSettings: call(cardSettings),
  editCard: call(editCard),
  walletSettings: call(walletSettings),
  editSettings: call(editSettings),
  pastCards: call(pastCards),
  editPastCards: call(editPastCards),
  cardPage: call(cardPage),
}

;(globalThis as { earnrate?: typeof engine }).earnrate = engine
