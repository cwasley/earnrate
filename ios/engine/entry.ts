// The engine as the iPhone app runs it, in JavaScriptCore. The app loads the
// catalog once, then calls these with JSON strings and reads JSON back, so
// the Swift side never depends on the engine's internal types. Every rule,
// number and sentence the app shows comes from here; Swift only lays it out.
// Node-free, like everything the site bundles.
import { placeKinds } from '../../site/app/place-kinds.ts'
import { walletProblems } from '../../src/data/integrity.ts'
import { cardDetails } from '../../src/engine/card-details.ts'
import {
  EVERYDAY_PURCHASES,
  quickPickText,
} from '../../src/engine/cheat-sheet.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  membersOnlyLines,
  topOf,
  type Exploration,
  type ExploreEntry,
} from '../../src/engine/explore.ts'
import { effectiveMemberships } from '../../src/engine/memberships.ts'
import { offerHistoryText } from '../../src/engine/offer-history.ts'
import {
  OFFERS_MAY_DIFFER,
  offerCheckedOn,
  offerTerms,
} from '../../src/engine/offers.ts'
import { inEffect, localToday } from '../../src/engine/periods.ts'
import { noteOnly, recommend } from '../../src/engine/recommend.ts'
import { repeatRuleText } from '../../src/engine/repeat-bonus.ts'
import { cardInfo, searchCards } from '../../src/engine/setup.ts'
import {
  capitalize,
  categoryAs,
  categoryPhrase,
  CREDIT_GROUP,
  CREDIT_PERIODS,
  creditShort,
  currencyName,
  dollarsAndCents,
  earnText,
  ENROLL_FIRST,
  foreignFeeText,
  listed,
  MERCHANT_CODE_LEAD,
  money,
  NETWORK_NAMES,
  onlineAssumption,
  pct,
  shortDate,
} from '../../src/engine/text.ts'
import type {
  MerchantResolution,
  RankedCard,
  Recommendation,
} from '../../src/engine/types.ts'
import { wherePhrase } from '../../src/engine/wallet-summary.ts'
import {
  addToWallet,
  removeFromWallet,
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
import { WalletSchema, type Wallet } from '../../src/schema/wallet.ts'

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
// the site check theirs. An empty or missing one is no wallet.
function walletOf(raw: unknown): Wallet | null {
  if (raw === null || raw === undefined) return null
  const wallet = WalletSchema.parse(raw)
  return wallet.cards.length === 0 && (wallet.past_cards ?? []).length === 0
    ? null
    : wallet
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

// What the store tab shows before anything is typed: the everyday purchases
// as quick picks.
export function home(): { quick: string[] } {
  return { quick: EVERYDAY_PURCHASES.map(quickPickText) }
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
  title: string
  subtitle: string | null // "Counts as a supermarket · $80"
  scope: 'yours' | 'every'
  canChooseScope: boolean // only with cards saved
  scopeNote: string | null
  pick: {
    cardId: string
    label: string // "Use" for your card, "Best card" from every card
    name: string
    detail: string
    art: CardArt
  } | null
  callouts: string[]
  creditsTitle: string
  credits: CreditRow[]
  rankingTitle: string | null
  rows: AnswerRow[]
  more: number // ranked cards not shown until asked
  moreLabel: string | null
  footer: string[]
  // What kind of place an unknown store is, to answer for that instead.
  kinds: {
    prompt: string
    quick: { key: string; label: string }[]
    more: { key: string; label: string }[]
  } | null
  kind: string | null
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
  if (m.source === 'category') return categoryPhrase(c, m.category)
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

// Assumptions minus the merchant code, which is for Claude and the command
// line and says nothing to a shopper (the site leaves it out too).
const shopperAssumptions = (lines: string[]) =>
  lines.filter((l) => !l.startsWith(MERCHANT_CODE_LEAD))

// "Costco takes only Visa in-store. Can't use: Amex Gold."
function excludedLines(excluded: Recommendation['excluded']): string[] {
  const { shortName } = names()
  const byReason = new Map<string, string[]>()
  for (const e of excluded)
    byReason.set(e.reason, [
      ...(byReason.get(e.reason) ?? []),
      shortName(e.cardId),
    ])
  return [...byReason].map(
    ([reason, cards]) => `${reason} Can't use: ${listed(cards)}.`,
  )
}

function exploreLeftOut(r: Exploration): string[] {
  const byReason = new Map<string, number>()
  for (const e of r.excluded)
    byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1)
  return [...byReason].map(
    ([reason, count]) =>
      `${reason} ${count === 1 ? 'One card' : `${String(count)} cards`} left out.`,
  )
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

const EVERY_NOTE =
  'From every personal card earnrate knows. Add yours in My wallet to rank only those.'
const EVERY_TOO = 'From every personal card earnrate knows. Yours are marked.'

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
  const kindsFor = (m: MerchantResolution) =>
    m.source === 'none' || m.source === 'caller'
      ? {
          prompt: `What kind of place is “${m.resolvedName}”?`,
          quick: kinds.quick.map((k) => ({ key: k.key, label: k.label })),
          more: kinds.more.map((k) => ({ key: k.key, label: k.label })),
        }
      : null
  const { shortName } = names()

  if (scope === 'yours' && wallet) {
    const rec = recommend(c, wallet, purchase, resolved, { today })
    const decided = rec.decision
    const top = rec.ranked.find((r) => r.cardId === decided?.cardId)
    const only = noteOnly(rec)
    return {
      title: only
        ? capitalize(titleOf(c, rec.merchant))
        : `Best of your cards for ${titleOf(c, rec.merchant)}`,
      subtitle: subtitleOf(rec.merchant),
      scope,
      canChooseScope: true,
      scopeNote: null,
      pick:
        decided && top
          ? {
              cardId: decided.cardId,
              label: rec.bonus ? 'Use, for its welcome bonus' : 'Use',
              name: shortName(decided.cardId),
              detail: [
                `${pct(decided.effectiveReturnPct)} back`,
                ...(top.earned === null
                  ? []
                  : [`about ${dollarsAndCents(top.earned)}`]),
                ...(top.credit?.dollars
                  ? [
                      `plus ${money(top.credit.dollars)} back from its ${top.credit.name} credit`,
                    ]
                  : []),
              ].join(', '),
              art: artOf(decided.cardId),
            }
          : null,
      callouts: [
        ...(rec.categoryNote ? [rec.categoryNote] : []),
        ...(!only && !decided ? ['None of your cards work here.'] : []),
        ...excludedLines(rec.excluded),
        ...rec.warnings,
        ...rec.notes,
      ],
      creditsTitle: CREDIT_GROUP,
      credits: [],
      rankingTitle: null,
      rows: rec.ranked.map((r, i) => yourRow(r, i + 1, held)),
      more: 0,
      moreLabel: null,
      footer: [
        ...(rec.sensitivity ? [rec.sensitivity] : []),
        ...shopperAssumptions(rec.assumptions),
      ],
      kinds: only ? null : kindsFor(rec.merchant),
      kind: kindKey,
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
    title: only
      ? capitalize(titleOf(c, r.merchant))
      : `Best cards for ${titleOf(c, r.merchant)}`,
    subtitle: subtitleOf(r.merchant),
    scope: 'every',
    canChooseScope: hasCards && problems.length === 0,
    scopeNote: only ? null : hasCards ? EVERY_TOO : EVERY_NOTE,
    pick:
      first === undefined
        ? null
        : {
            cardId: first.cardId,
            label: 'Best card',
            name: shortName(first.cardId),
            detail: `${pct(first.effectiveReturnPct)} back`,
            art: artOf(first.cardId),
          },
    callouts: [
      ...problems.map(
        (p) => `The wallet saved on this phone has a problem: ${p}`,
      ),
      ...exploreLeftOut(r),
      ...(r.categoryNote ? [r.categoryNote] : []),
      ...r.warnings,
    ],
    creditsTitle: CREDIT_GROUP,
    credits: r.credits.map((p) => ({
      card: cardRow(p.cardId, held),
      amount: `${money(p.amount)} back`,
      text: `${capitalize(CREDIT_PERIODS[p.period])}${p.terms}, then ${p.earn}.${p.enroll ? ` ${capitalize(ENROLL_FIRST)}.` : ''}`,
    })),
    rankingTitle: r.credits.length > 0 ? 'By rate' : null,
    rows: shown.ranked.map((e, i) => everyRow(e, i + 1, held)),
    more,
    moreLabel: more > 0 ? `Show all ${String(r.ranked.length)} cards` : null,
    footer: [
      ...membersOnlyLines(c, shown.membersOnly, (e) => shortName(e.cardId)),
      ...shopperAssumptions(r.assumptions),
    ],
    kinds: only ? null : kindsFor(r.merchant),
    kind: kindKey,
  }
}

// Every card, by issuer, for adding cards: or, with a search, the engine's
// card search (names, short names, issuers and what they earn on).
export function cards(request: {
  wallet?: unknown
  query?: string
  today?: string
}): {
  groups: { issuer: string; cards: CardRow[] }[]
} {
  const c = loaded()
  const wallet = walletOf(request.wallet)
  const held = heldIds(wallet)
  const query = request.query?.trim() ?? ''
  if (query.length >= 2) {
    const found = searchCards(c, query, wallet, request.today ?? localToday())
    return {
      groups:
        found.cards.length === 0
          ? []
          : [
              {
                issuer: '',
                cards: found.cards.map((k) => cardRow(k.id, held)),
              },
            ],
    }
  }
  const byIssuer = new Map<string, CardRow[]>()
  for (const card of c.cards) {
    const row = cardRow(card.id, held)
    byIssuer.set(row.issuer, [...(byIssuer.get(row.issuer) ?? []), row])
  }
  return {
    groups: [...byIssuer]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([issuer, list]) => ({
        issuer,
        cards: list.sort((a, b) => a.shortName.localeCompare(b.shortName)),
      })),
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

export function removeCard(request: { wallet?: unknown; id: string }): Change {
  const wallet = walletOf(request.wallet)
  if (!wallet) return { ok: false, error: `${request.id} isn't in the wallet.` }
  return changed(removeFromWallet(wallet, request.id))
}

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
  cardPage: call(cardPage),
}

;(globalThis as { earnrate?: typeof engine }).earnrate = engine
