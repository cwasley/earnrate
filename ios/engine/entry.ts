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
import {
  passForm,
  PASS_NOTE_IN_APP,
  PASS_URL,
} from '../../site/app/pass-request.ts'
import { placeKinds } from '../../site/app/place-kinds.ts'
import {
  ABROAD_LABEL,
  ABROAD_WORDS,
  PAYING_CHOICES,
  PAYING_WITH,
  payingHints,
  payingHintText,
  THIS_PURCHASE,
} from '../../site/app/purchase-options.ts'
import { QUICK_CARDS } from '../../site/app/quick-cards.ts'
import {
  NO_CARD_OF_YOURS,
  SHEET_PICTURE_SITE,
  SHEET_PICTURE_TITLE,
  sheetPictureFile,
  sheetPictureFooter,
  sheetPictureSubtitle,
} from '../../site/app/sheet-picture-text.ts'
import {
  CATALOG_FILE_FORMAT,
  compareDataVersions,
  parseCatalogFile,
} from '../../src/data/catalog-file.ts'
import { walletProblems } from '../../src/data/integrity.ts'
import {
  BONUS_RULES_COLUMN,
  BONUS_RULES_HAD,
  BONUS_RULES_SHORT,
  BONUS_RULES_TITLE,
  BONUS_RULES_UNPUBLISHED,
  bonusRules,
  bonusRulesLead,
} from '../../src/engine/bonus-rules.ts'
import {
  CARDS_INDEX,
  cardIndexName,
  cardNames,
  cardSearchWords,
  cardsIndexLead,
  matchesTyped,
  typedCloseness,
} from '../../src/engine/card-search.ts'
import { cardDetails } from '../../src/engine/card-details.ts'
import {
  EARNING_ONLY,
  feeWorthAnswer,
  feeWorthCredits,
  feeWorthKit,
  feeWorthTransfer,
  feeWorthVerdict,
  fromAmount,
  highText,
  lineWords,
  TRANSFER_VALUES,
  withCreditsAmount,
} from '../../src/engine/fee-worth.ts'
import {
  catalogCheatSheet,
  cheatSheet,
  EVERYDAY_PURCHASES,
  quickPickText,
} from '../../src/engine/cheat-sheet.ts'
import {
  activationNotOpen,
  checklistRows,
  type ChecklistRowItem,
} from '../../src/engine/checklist.ts'
import { HALF_CENT } from '../../src/engine/compare.ts'
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
import { activationGroup, usableAt } from '../../src/engine/evaluate.ts'
import {
  ALL_PERSONAL_CARDS,
  exploreCards,
  type CardFilters,
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
  monthAskLabel,
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
  ifMemberLines,
  membershipName,
  placedAmong,
  sameGroup,
  tierGroups,
} from '../../src/engine/memberships.ts'
import { milestoneSummaries } from '../../src/engine/milestones.ts'
import { offerHistoryText } from '../../src/engine/offer-history.ts'
import {
  backBeforeFeesText,
  backBeforeFeeText,
  BEST_SETUPS,
  BEST_SETUPS_LEAD,
  BEST_SETUPS_WORKING,
  BONUS_OUT_OF_REACH,
  BONUS_UNLIKELY,
  BONUS_UNSURE,
  BUSINESS_FILTER,
  feesText,
  firstYearText,
  shortFeeText,
  HOW_CALCULATED,
  HOW_RANKED,
  HOW_SETUPS,
  NEXT_CARD_LEAD,
  NO_FEE_FILTER,
  NO_OFFER_AHEAD,
  noPairBeatsText,
  offerAsOfShortText,
  offerAsOfText,
  pairParts,
  pairSplitText,
  PER_YEAR,
  picksText,
  REWARD_KINDS,
  sameResultText,
  sameRuleText,
  showMoreText,
  signedDollars,
  SINGLE_CARD,
  spendingBasisText,
  splitParts,
  tiesText,
  TWO_CARDS,
  TWO_YEARS_LEAD,
  TWO_YEARS_PER,
  welcomeOfferText,
  withMembershipText,
  yearOneText,
  yearTwoText,
} from '../../src/engine/next-card-text.ts'
import {
  compareOffers,
  historyOf,
  OFFERS_MAY_DIFFER,
  offerCheckedOn,
  offerOrder,
  offerShortTerms,
  offerTerms,
  type OfferSummary,
} from '../../src/engine/offers.ts'
import {
  addDays,
  currentPeriodEnd,
  inEffect,
  localToday,
} from '../../src/engine/periods.ts'
import { VALUATION_PROFILES } from '../../src/engine/profiles.ts'
import {
  alternativesText,
  COMPARE_CHEAPER,
  feeSavedText,
  hiddenRatesText,
  KEEP_OR_REPLACE,
  KEEP_OR_REPLACE_ASK,
  keepOrReplace as weighKeepOrReplace,
  keepOrReplaceAssumes,
  keepOrReplaceLead,
  keepOrReplaceMath,
  keepOrReplaceUnsaid,
  PERKS_NOT_COUNTED,
  replacementExtras,
  replacementKept,
  replacementShort,
  samePointsTag,
  samePointsText,
  transferText,
} from '../../src/engine/keep-or-replace.ts'
import {
  ABROAD,
  noCardText,
  noteOnly,
  recommend,
} from '../../src/engine/recommend.ts'
import { bookPurchase } from '../../src/engine/record.ts'
import { anniversaryOf } from '../../src/engine/renewal.ts'
import {
  bonusEligibility,
  countsForRepeat,
  repeatMonthFields,
  repeatRuleText,
  type MonthAsk,
} from '../../src/engine/repeat-bonus.ts'
import { optionName, pickName } from '../../src/engine/rule-text.ts'
import {
  byNet,
  countedLines,
  nothingCounted,
  simulateCatalog,
  typicalSpendLines,
  type PairSimulation,
  type Simulation,
} from '../../src/engine/simulate.ts'
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
  askedScope,
  categoryAs,
  categoryTitle,
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
  ifCreditsUsedText,
  inOrder,
  leftOutLines,
  minimumSpendText,
  money,
  MONTH_NAMES,
  NETWORK_NAMES,
  NEWER_DATA_NEEDS_APP,
  NONE_OF_YOURS,
  num,
  onlineAssumption,
  pairCreditsUsedText,
  paymentUnknownText,
  pct,
  perksNoun,
  placeKindAsk,
  shopperAssumptions,
  shortCardName,
  shortDate,
  SOMETHING_ELSE,
  twoYearText,
  unknownStoreExploreWarning,
  unknownStoreTapText,
  unknownStoreWarning,
  USE_CARD,
  verdictDetail,
  wholeDollars,
} from '../../src/engine/text.ts'
import type { MerchantResolution, RankedCard } from '../../src/engine/types.ts'
import { cardValuation, currencyValuation } from '../../src/engine/valuation.ts'
import { oneRate } from '../../src/engine/wallet-report.ts'
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
  recordedText,
  subscriptionCredit,
  subscriptionText,
} from '../../src/format/wallet.ts'
import {
  resolveMerchantById,
  resolvePlace,
  splitPurchaseText,
  withCallerCategory,
} from '../../src/merchants/resolve.ts'
import type { Card, PaymentMethod } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import {
  WalletSchema,
  type PastCard,
  type Wallet,
  type WalletCard,
} from '../../src/schema/wallet.ts'
import { installURL } from './url.ts'

installURL()

let catalog: Catalog | null = null
let dataVersion = ''
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
  working: { setups: string } // while the slow answers are worked out
  held: string // a card in My wallet, marked in lists of every card
}

// What the store tab shows before anything is typed: the everyday purchases
// as quick picks; and the first-launch welcome.
export function home(): Home {
  return {
    quick: EVERYDAY_PURCHASES.map(quickPickText),
    months: MONTH_NAMES,
    welcome: {
      title: 'earnrate',
      lead: 'Know which card to use at every store, and why.',
      privacy:
        "Your cards stay on this phone. You don't need an account, and earnrate never asks for a card number.",
      add: 'Add my cards',
      skip: 'Check a store',
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
      every: 'Answers cover every card earnrate knows until you add yours.',
    },
    working: { setups: BEST_SETUPS_WORKING },
    held: ANSWER_LABELS.held,
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
    // Why a welcome bonus puts this card over a better earner, shown with
    // the rate it explains rather than among the notes.
    because: string | null
    warnings: string[]
    art: CardArt
  } | null
  // "None of your cards work here.", in the pick's place.
  verdict: string | null
  callouts: string[]
  // The callouts on cards a store doesn't take ("Costco takes only Visa
  // in-store. Can't use: Amex Gold."), for Siri's shorter answer, and
  // their reasons alone ("Costco takes only Visa in-store.").
  accepts: string[]
  acceptsWhy: string[]
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
  // How the purchase is paid, one quiet menu: the site's This purchase.
  purchase: PurchaseOptions
  // "I used it" on the saved cards ranked here, with a saved wallet and a
  // store earnrate can tell the caps of.
  record: RecordAsk | null
  labels: {
    yours: string
    every: string
    why: string
    cardPage: string
    held: string
  }
}

const reasonsOf = (excluded: { reason: string }[]) => [
  ...new Set(excluded.map((e) => e.reason)),
]

export type PurchaseOptions = {
  title: string
  summary: string // what the menu shows: "This purchase", or what's set
  active: boolean
  payingTitle: string
  paying: { id: PaymentMethod | null; label: string }[]
  payment: PaymentMethod | null
  abroadLabel: string
  abroad: boolean
  // "With Apple Pay? Amex Gold earns 4x here.": one tap sets it.
  hints: { payment: PaymentMethod; text: string }[]
}

export type RecordAsk = {
  label: string
  cards: string[] // card ids it's offered on
  title: string
  lead: string
  amountLabel: string
  amount: number | null // from the search ("Whole Foods $80")
  button: string
  undo: string
  undone: string
  done: string
}

// The menu's own word for paying with the card itself. The site keeps
// "Card": its segmented control has no room for more at phone width.
const CARD_ITSELF = 'Card (tap or swipe)'

function purchaseOptions(
  payment: PaymentMethod | null,
  abroad: boolean,
  hints: { cardId: string; payment: PaymentMethod; earn: string }[],
): PurchaseOptions {
  const { shortName } = names()
  const set = [
    ...(payment === null
      ? []
      : PAYING_CHOICES.filter((p) => p.value === payment).map((p) => p.label)),
    ...(abroad ? [capitalize(ABROAD_WORDS)] : []),
  ]
  return {
    title: THIS_PURCHASE,
    summary: set.length === 0 ? THIS_PURCHASE : set.join(' · '),
    active: set.length > 0,
    payingTitle: PAYING_WITH,
    paying: PAYING_CHOICES.map((p) => ({
      id: p.value,
      label: p.value === 'card' ? CARD_ITSELF : p.label,
    })),
    payment,
    abroadLabel: ABROAD_LABEL,
    abroad,
    hints: hints.map((h) => ({
      payment: h.payment,
      text: payingHintText(h.payment, shortName(h.cardId), h.earn),
    })),
  }
}

function recordAsk(
  wallet: Wallet | null,
  m: MerchantResolution,
  amount: number | null,
  problems: string[],
): RecordAsk | null {
  if (!wallet || wallet.cards.length === 0 || problems.length > 0) return null
  if (m.source === 'none') return null
  return {
    label: 'I used it',
    cards: wallet.cards.map((h) => h.id),
    title: 'I used it',
    lead: "Adds it to what you've spent on this card, so earnrate can keep track of its bonus limits, welcome bonus and credits.",
    amountLabel: 'Amount',
    amount,
    button: 'Record it',
    undo: 'Undo',
    undone: 'Taken back out of My wallet.',
    done: 'Done',
  }
}

const TOP = 8

// The engine's way-of-paying note ends by asking Claude's user to say how
// they're paying; in the app it's a pick.
const PAYING_ASK = (() => {
  const line = paymentUnknownText('', 'card', '', '')
  return line.slice(line.lastIndexOf('. ') + 2)
})()
const PAYING_PICK = `Pick it under ${THIS_PURCHASE} to count it.`

// "as a streaming service, bought online", as the site's answer heading says.
function countsAs(c: Catalog, m: MerchantResolution): string {
  const as = categoryAs(c, m.category)
  return onlineAssumption(c, m, null) !== null && !as.includes('online')
    ? `${as}, bought online`
    : as
}

function titleOf(c: Catalog, m: MerchantResolution): string {
  if (m.source === 'category') return categoryTitle(c, m)
  return m.source === 'none' ? `“${m.input}”` : m.resolvedName
}

// The rule that earned the rate, in a few words: "4x Amex Membership Rewards
// at supermarkets", or "2% cash back on everything".
function shortReason(r: RankedCard, today: string): string {
  const c = loaded()
  const card = cardOf(r.cardId)
  const rule = card.rules.find((x) => x.id === r.matchedRule)
  if (rule !== undefined)
    return `${earnText(c, rule.rate, r.currency)} ${wherePhrase(c, card, [rule])}`
  const base = earnText(c, card.base_rate, r.currency)
  return oneRate(c, card, today)
    ? `${base} on everything`
    : `${base} on everything else`
}

function everyRow(
  e: ExploreEntry,
  rank: number,
  held: Set<string>,
  today: string,
): AnswerRow {
  const { requirementLines, issuerName, feeLabel } = names()
  return {
    rank,
    card: cardRow(e.cardId, held),
    rate: pct(e.effectiveReturnPct),
    reason: shortReason(e, today),
    lines: [
      ...requirementLines(e.cardId, e.requirements),
      `${issuerName(e.issuer)} · ${feeLabel(e.cardId, { membership: e.needsMembership !== null })}`,
    ],
    warnings: e.warnings,
    why: e.reasoning,
  }
}

function yourRow(
  r: RankedCard,
  rank: number,
  held: Set<string>,
  today: string,
): AnswerRow {
  return {
    rank,
    card: cardRow(r.cardId, held),
    rate: pct(r.effectiveReturnPct),
    reason: shortReason(r, today),
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
  payment?: PaymentMethod | null
  abroad?: boolean
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
  const payment = request.payment ?? null
  const abroad = request.abroad === true
  const purchase = {
    merchant: asked.merchant,
    amount: asked.amount,
    channel: null,
    date: today,
    // The engine tells the U.S. from everywhere else; ABROAD is never
    // shown. How it's paid shows on the menu that sets it.
    country: abroad ? ABROAD : 'US',
    payment,
  }
  const subtitleOf = (m: MerchantResolution) => {
    const scope = askedScope(c, m)
    const parts = [
      ...(m.source !== 'category' && m.source !== 'none'
        ? [capitalize(`counts ${countsAs(c, m)}`)]
        : []),
      ...(asked.amount === null ? [] : [money(asked.amount)]),
    ]
    if (scope !== null)
      return parts.length === 0 ? scope : `${parts.join(' · ')} · ${scope}`
    return parts.length === 0 ? null : parts.join(' · ')
  }
  const footerOf = (m: MerchantResolution, assumptions: string[]) => {
    const scope = askedScope(c, m)
    return shopperAssumptions(assumptions)
      .filter((a) => a !== scope)
      .map((a) =>
        a.endsWith(PAYING_ASK)
          ? `${a.slice(0, -PAYING_ASK.length)}${PAYING_PICK}`
          : a,
      )
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
    const rows = rec.ranked.map((r, i) => yourRow(r, i + 1, held, today))
    const because = rec.bonus ? (rec.notes[0] ?? null) : null
    const none = !only && !decided
    const cantUse = cantUseLines(rec.excluded, shortName)
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
              reason: shortReason(top, today),
              because,
              warnings: top.warnings,
              art: artOf(decided.cardId),
            }
          : null,
      verdict: none ? NONE_OF_YOURS : null,
      // The engine's own "None of your cards work at…" says the verdict
      // again, so it goes.
      callouts: [
        ...(rec.categoryNote ? [rec.categoryNote] : []),
        ...cantUse,
        ...tapInstead(rec.merchant, rec.warnings).filter(
          (w) => !none || w !== noCardText(rec.merchant.resolvedName),
        ),
        ...rec.notes.filter((n) => n !== because),
      ],
      accepts: cantUse,
      acceptsWhy: reasonsOf(rec.excluded),
      creditsTitle: CREDIT_GROUP,
      credits: [],
      rankingTitle: rows.length > 1 ? 'Your other cards' : null,
      rows: rows.filter((r) => r.card.id !== decided?.cardId),
      more: 0,
      moreLabel: null,
      footer: [
        ...(rec.sensitivity ? [rec.sensitivity] : []),
        ...footerOf(rec.merchant, rec.assumptions),
      ],
      kinds: only ? null : kindsFor(rec.merchant),
      kind: kindKey,
      purchase: purchaseOptions(payment, abroad, payingHints(rec)),
      record: only
        ? null
        : recordAsk(wallet, rec.merchant, asked.amount, problems),
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
  const leftOut = leftOutLines(r.excluded)
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
            reason: shortReason(first, today),
            because: null,
            warnings: first.warnings,
            art: artOf(first.cardId),
          },
    verdict: null,
    callouts: [
      ...problems.map(
        (p) => `The wallet saved on this phone has a problem: ${p}`,
      ),
      ...leftOut,
      ...(r.categoryNote ? [r.categoryNote] : []),
      ...tapInstead(r.merchant, r.warnings),
    ],
    accepts: leftOut,
    acceptsWhy: reasonsOf(r.excluded),
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
    rows: shown.ranked.slice(1).map((e, i) => everyRow(e, i + 2, held, today)),
    more,
    moreLabel: more > 0 ? `Show all ${String(r.ranked.length)} cards` : null,
    footer: [
      ...membersOnlyLines(c, shown.membersOnly, (e) => shortName(e.cardId)),
      ...footerOf(r.merchant, r.assumptions),
    ],
    kinds: only ? null : kindsFor(r.merchant),
    kind: kindKey,
    purchase: purchaseOptions(payment, abroad, payingHints(r)),
    record: only ? null : recordAsk(wallet, r.merchant, asked.amount, problems),
    labels: ANSWER_LABELS,
  }
}

// ---------------------------------------------------------------------------
// "I used it": one purchase recorded into the saved wallet through the
// engine's record rules (caps, welcome bonus, spend bonuses, credits), as
// Claude's record_purchase does, with the same sentences.

export type Recorded =
  | { ok: true; recorded: boolean; wallet: Wallet | null; message: string }
  | { ok: false; error: string }

export function recordPurchase(request: {
  wallet?: unknown
  cardId: string
  query: string // the store as asked, so it resolves as its answer did
  kind?: string | null
  amount: number
  today?: string
}): Recorded {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet)
  if (!wallet || !wallet.cards.some((h) => h.id === request.cardId))
    return { ok: false, error: 'That card is no longer in My wallet.' }
  if (!(request.amount > 0) || !Number.isFinite(request.amount))
    return { ok: false, error: 'Enter the amount you paid.' }
  const amount = Math.round(request.amount * 100) / 100
  const asked = splitPurchaseText(request.query)
  const kinds = placeKinds(c)
  const kindCategory =
    request.kind === undefined || request.kind === null
      ? null
      : ([...kinds.quick, ...kinds.more].find((k) => k.key === request.kind)
          ?.category ?? null)
  const merchant = withCallerCategory(
    resolvePlace(c, asked.merchant, null),
    kindCategory,
  )
  if (merchant.source === 'none')
    return { ok: false, error: placeKindAsk(merchant.resolvedName) }
  const purchase = {
    cardId: request.cardId,
    merchant: asked.merchant,
    amount,
    channel: null,
    date: today,
  }
  const booked = bookPurchase(c, wallet, purchase, merchant)
  const { paying, mark } = subscriptionCredit(
    c,
    wallet,
    request.cardId,
    merchant,
    today,
  )
  let next = booked.wallet
  let marked = false
  if (paying && mark) {
    const held = next.cards.find((h) => h.id === request.cardId)
    const change = updateInWallet(
      c,
      next,
      {
        id: request.cardId,
        enrolled: [...(held?.enrolled ?? []), paying.credit.id],
      },
      today,
    )
    if (change.ok) {
      next = change.wallet
      marked = true
    }
  }
  const { recorded, text } = recordedText(
    c,
    wallet,
    purchase,
    booked,
    subscriptionText(names().shortName(request.cardId), paying, marked),
    'Saved in My wallet.',
    "add the total so far in the card's settings",
  )
  return {
    ok: true,
    recorded: recorded || marked,
    wallet: recorded || marked ? next : wallet,
    message: text,
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
      // "Visa only in-store", when the store turns away a saved card.
      accepts: string | null
      art: CardArt | null
    }[]
    // The sheet as a picture to share: what the site's image says, and
    // nothing else about the person (no notes, amounts or stores asked).
    share: {
      label: string
      accessibility: string
      title: string
      subtitle: string
      footer: string[]
      site: string
      filename: string
    }
    // The site's cheat-sheet pass (walletPass says what's sent).
    pass: { label: string; note: string }
  } | null
  cardsTitle: string
  // Under the front card: what it's waiting for. `quiet` is a detail
  // that can wait (its renewal date), so it isn't the screen's main button.
  cards: {
    card: CardRow
    note: string | null
    ask: boolean
    quiet: boolean
    action: string
  }[]
  addCards: string
  // Hidden while there are no cards and no past cards: Bonus rules links
  // to the list for someone who wants to add those first.
  past: { title: string; count: string; shown: boolean }
  settings: string
  problems: string[]
  // Asked once, beside the to-do, when something in it has a deadline a
  // reminder could fall before.
  reminderOffer: { text: string; yes: string; no: string } | null
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

// An activation the issuer hasn't opened yet waits off the to-do until the
// day it opens; its reminder is set for that morning.
const notOpenYet = activationNotOpen

// Rows past these wait behind "N more"; the list is
// soonest first.
const TODO_SHOWN = 2

const cardCount = (n: number) => `${String(n)} card${n === 1 ? '' : 's'}`

// My wallet, top to bottom: the cheat sheet, the to-do, the cards and what
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
      shown: past.length > 0 || (wallet?.cards.length ?? 0) > 0,
    },
    settings: 'Settings',
    problems,
    reminderOffer: null,
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
  const items = checklistRows(c, wallet, today, undefined, shortName).filter(
    (i) => !notOpenYet(i, today),
  )
  const todo = items
    .filter((i) => i.row.note !== true)
    .map((i): TodoRow => ({
      id: `${i.kind}-${i.cardId}-${i.ref ?? i.text}`,
      cardId: i.cardId,
      art: artOf(i.cardId),
      title: i.row.title,
      // The amount and its words stay on one line with their dot: "$7 left".
      detail:
        i.row.amount === null
          ? i.row.card
          : `${i.row.card}\u00a0·\u00a0${i.row.amount.replace(/ /g, '\u00a0')}`,
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
  const onlyTakes = (merchantId: string): string | null => {
    const m = resolveMerchantById(c, merchantId, null)
    const takes = m?.accepts
    if (!m || !takes) return null
    const turnedAway = wallet.cards.some((h) => {
      const card = c.cards.find((k) => k.id === h.id)
      return card !== undefined && !card.only_at && !usableAt(card, m)
    })
    if (!turnedAway) return null
    const where =
      m.channel === 'in_store'
        ? ' in-store'
        : m.channel === 'online'
          ? ' online'
          : ''
    return `${takes.map((n) => NETWORK_NAMES[n] ?? n).join(' or ')} only${where}`
  }
  return {
    ...base,
    reminderOffer: items.some((i) => reminderLead(i) !== null)
      ? REMINDER_OFFER
      : null,
    todo,
    todoShown: TODO_SHOWN,
    todoMore:
      todo.length > TODO_SHOWN
        ? `${String(todo.length - TODO_SHOWN)} more`
        : null,
    notes,
    sheet: {
      title: 'Cheat sheet',
      subtitle: sheetPictureSubtitle(sheet.quarter),
      share: {
        label: 'Share',
        accessibility: 'Share as an image',
        title: SHEET_PICTURE_TITLE,
        subtitle: sheetPictureSubtitle(sheet.quarter),
        footer: sheetPictureFooter(sheet.date),
        site: SHEET_PICTURE_SITE,
        filename: sheetPictureFile(sheet.quarter),
      },
      pass: {
        label: 'Add to Apple Wallet',
        note: PASS_NOTE_IN_APP,
      },
      rows: sheet.rows.map((row, i) => {
        const item = EVERYDAY_PURCHASES[i]
        return {
          label: row.label,
          query: item ? quickPickText(item) : null,
          cardId: row.cardId,
          name: row.cardId === null ? NO_CARD_OF_YOURS : shortName(row.cardId),
          rate:
            row.effectiveReturnPct === null ? '' : pct(row.effectiveReturnPct),
          note: row.note,
          accepts: item && 'merchant' in item ? onlyTakes(item.merchant) : null,
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
        // Unset picks change answers; a renewal date only times a
        // reminder, so picks are asked first.
        const renewal = note === null && ask && !needsPick
        return {
          card: cardRow(h.id, held),
          note: note ?? (renewal ? RENEWAL_ASK : null),
          ask: note === null && (ask || needsPick),
          quiet: renewal,
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
  // `unsaved` is spending typed before there was a date to save the bonus
  // with: nothing is saved until the person gives the account's date.
  | { tracking: { on: boolean; opened: string | null; unsaved?: number } }
  | { opened: { date: string | null; tracking: boolean; unsaved?: number } }
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
    return trackingChange(
      h,
      edit.tracking.on,
      edit.tracking.opened ?? '',
      String(edit.tracking.unsaved ?? ''),
    )
  if ('opened' in edit)
    return openedChange(h, edit.opened.date ?? '', {
      tracking: edit.opened.tracking,
      introRates: cardInfo(c, card, null, today).introRates.length > 0,
      unsaved: String(edit.opened.unsaved ?? ''),
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
// Reminders, memberships and point values

export type WalletSettings = {
  membershipsTitle: string
  membershipsLead: string
  // The ones the saved cards use, or already on; the rest folded away.
  toggles: Toggle[]
  menus: Menu[]
  othersTitle: string
  otherToggles: Toggle[]
  otherMenus: Menu[]
  reminders: {
    title: string
    label: string
    footer: string
    denied: string // when the phone has notifications off for earnrate
    openSettings: string
  }
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
  const shown = {
    toggles: toggles.filter((t) => relevant(t.id)),
    menus: menus.filter(tiersUsed),
  }
  return {
    membershipsTitle: 'Memberships',
    membershipsLead: 'Some cards earn more with these.',
    ...shown,
    othersTitle:
      shown.toggles.length + shown.menus.length === 0
        ? 'Memberships'
        : 'Other memberships',
    otherToggles: toggles.filter((t) => !relevant(t.id)),
    otherMenus: menus.filter((m) => !tiersUsed(m)),
    reminders: REMINDER_SETTING,
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
  // The same lines with the points named once, in earningCurrency ("5x on
  // hotels through Amex Travel"), when every line names the same ones.
  earningCurrency: string | null
  earningShort: string[]
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
  // Left out with `feeWorth: false` for a card that may have one, which
  // the app then asks cardFeeWorth for.
  feeWorthLater: boolean
  changes: string[]
  checked: string
  sources: string[]
  // A saved fee card's Keep or replace, asked for before it's worked out
  // (keepOrReplace), as the site's card settings do.
  keep: { title: string; lead: string; button: string } | null
}

// "4x Amex Membership Rewards at restaurants" as "4x at restaurants", with
// the points said once over the lines; left as they are unless every line
// names the same points after its rate.
function earningShort(
  lines: string[],
  currency: string,
): { earningCurrency: string | null; earningShort: string[] } {
  const short = lines.map((line) => {
    const space = line.indexOf(' ')
    return space > 0 && line.startsWith(`${currency} `, space + 1)
      ? `${line.slice(0, space)} ${line.slice(space + currency.length + 2)}`
      : null
  })
  return lines.length > 0 && short.every((l) => l !== null)
    ? { earningCurrency: currency, earningShort: short }
    : { earningCurrency: null, earningShort: lines }
}

// What a rate is paid in, as the rates say it: "cash back", "Amex
// Membership Rewards".
const earnUnit = (c: Catalog, currency: string) =>
  earnText(c, 1, currency).replace(/^\S+ /, '')

// A card's page: what the site's card page and search_cards say about it.
// Whether its fee is worth it takes seconds without a JIT, so the app asks
// for the page without it and fills it in from cardFeeWorth.
export function cardPage(request: {
  id: string
  wallet?: unknown
  today?: string
  feeWorth?: boolean
}): CardPage {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet)
  const card = cardOf(request.id)
  const row = cardRow(card.id, heldIds(wallet))
  const info = cardInfo(c, card, wallet, today)
  const later = request.feeWorth === false
  const [details] =
    cardDetails(c, [card.id], wallet, today, { feeWorth: !later }) ?? []
  const earning = details?.earning ?? []
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
    earning,
    ...earningShort(earning, earnUnit(c, card.currency)),
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
    feeWorthLater:
      later &&
      (card.annual_fee ?? 0) > 0 &&
      card.applications_closed === undefined,
    changes: details?.changes ?? [],
    checked: `Checked against the issuer's terms ${shortDate(card.last_verified)}.`,
    sources: card.source_urls,
    keep:
      row.held &&
      (card.annual_fee ?? 0) > 0 &&
      wallet !== null &&
      walletProblems(wallet, c).length === 0
        ? {
            title: KEEP_OR_REPLACE,
            lead: KEEP_OR_REPLACE_ASK,
            button: COMPARE_CHEAPER,
          }
        : null,
  }
}

export type KeepAnswer = {
  lead: string // "The Sapphire Reserve adds about $120 a year after its fee"
  saved: string | null // what the best cheaper card keeps, after the lead
  unsaid: string | null // credits the person hasn't said they use
  unsaidButton: string
  replacements: {
    card: CardRow
    short: string // "Keeps 20%, $795 less in fees"
    samePoints: string | null
    net: string // "+$120"
    per: string
    detail: string
    extras: string[]
  }[]
  notes: string[]
  members: string[]
  math: string
  perks: string
  assumesTitle: string
  assumes: string[]
  cardPage: string
}

// Keep or replace a saved fee card, on the typical month (the app has no
// spending of its own to give) and saying so. A read of the wallet: nothing
// changes. Slow, like whether a fee is worth it.
export function keepOrReplace(request: {
  id: string
  wallet?: unknown
  today?: string
}): { answer: KeepAnswer | null } {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet)
  if (!wallet) return { answer: null }
  const k = weighKeepOrReplace(c, wallet, request.id, today)
  if (!k) return { answer: null }
  const { feeLabel } = names()
  const held = heldIds(wallet)
  const [best] = k.replacements
  const unsaid = keepOrReplaceUnsaid(k)
  return {
    answer: {
      lead: keepOrReplaceLead(c, k),
      saved: best ? feeSavedText(k, best) : null,
      unsaid: unsaid === '' ? null : unsaid,
      unsaidButton: 'Say which you use',
      replacements: k.replacements.map((r) => {
        const others = alternativesText(c, r)
        return {
          card: cardRow(r.cardId, held),
          short: replacementShort(k, r),
          samePoints: r.samePoints ? samePointsTag(c, k) : null,
          net: `+${wholeDollars(r.net)}`,
          per: '/yr',
          detail: `${capitalize(replacementKept(k, r))}. ${feeLabel(r.cardId)}.${others === '' ? '' : ` Or ${others}, the same.`}`,
          extras: replacementExtras(c, r),
        }
      }),
      notes: [
        samePointsText(c, k),
        transferText(c, k),
        hiddenRatesText(k),
      ].filter((t) => t !== ''),
      members: k.members,
      math: keepOrReplaceMath(k),
      perks: PERKS_NOT_COUNTED,
      assumesTitle: 'What this assumes',
      assumes: keepOrReplaceAssumes(c, k),
      cardPage: ANSWER_LABELS.cardPage,
    },
  }
}

// ---------------------------------------------------------------------------
// Next card: the welcome-offer ranking for the saved cards (or none), and
// Best setups.

export type FeeWorthParts = {
  text: string | null // the engine's sentences, as search_cards says them
  // The same, laid out as the site's card page does: what the amounts
  // are, the amounts it comes out ahead at, and the engine's sentences,
  // verdict first, one tap away.
  lead: string | null
  facts: { label: string; value: string }[]
  why: string | null
  more: string[]
  moreTitle: string
}

// Whether a card's annual fee is worth it, the slow part of its page. The
// math is cardDetails' (with the same transfer-value rerun), kept here so
// the parts the sentences are made of can be laid out.
export function cardFeeWorth(request: {
  id: string
  wallet?: unknown
  today?: string
}): FeeWorthParts {
  const c = loaded()
  const today = request.today ?? localToday()
  const card = cardOf(request.id)
  const saved = walletOf(request.wallet)
  const valuations = saved?.valuations ?? {}
  const heldCards = saved?.cards ?? []
  const w = feeWorthKit(c, today, valuations, heldCards).feeWorth(card)
  if (w === null)
    return {
      text: null,
      lead: null,
      facts: [],
      why: null,
      more: [],
      moreTitle: HOW_WORKED_OUT,
    }
  const cents = TRANSFER_VALUES[card.currency]
  const transfer =
    cents === undefined || valuations[card.currency] !== undefined
      ? null
      : {
          worth: feeWorthKit(
            c,
            today,
            { ...valuations, ...TRANSFER_VALUES },
            heldCards,
          ).feeWorth(card),
          cents,
        }
  const { text } = feeWorthAnswer(c, w, valuations, transfer)
  const why = highText(w)
  const credits = feeWorthCredits(c, w)
  const where = w.everywhere
    ? 'spending'
    : `spending on ${inOrder(w.lines.map(lineWords))}`
  return {
    text,
    // The site card page's line over the same amounts (scripts/pages/fee-worth.ts).
    lead: `It earns more than the best no-fee card, after its ${wholeDollars(card.annual_fee ?? 0)} fee, at this much a month of ${where}:`,
    facts: [
      { label: 'On earning alone', value: fromAmount(w.breakEven, w.stopsAt) },
      ...(transfer === null
        ? []
        : [
            {
              label: `If you transfer points (${num(transfer.cents)}¢)`,
              value: fromAmount(
                transfer.worth?.breakEven ?? null,
                transfer.worth?.stopsAt ?? null,
              ),
            },
          ]),
      ...(w.credits === null
        ? []
        : [
            {
              label: `If you use its ${perksNoun(w.credits, true, true)} (${wholeDollars(w.credits.yearly)} a year)`,
              value: withCreditsAmount(w.creditsBreakEven, w.creditsStopAt),
            },
          ]),
    ],
    why: why === '' ? null : why,
    // The engine's text without its why, a sentence group to a paragraph.
    more: [
      feeWorthVerdict(w, shortCardName(card.name), undefined, false),
      transfer === null ? '' : feeWorthTransfer(c, card, transfer),
      credits,
      EARNING_ONLY,
      text.slice(text.indexOf(ASSUMES)),
    ].filter((t) => t !== ''),
    moreTitle: HOW_WORKED_OUT,
  }
}

const HOW_WORKED_OUT = 'How this is worked out'
const ASSUMES = 'Assumes typical'

// ---------------------------------------------------------------------------
// About, and the card data the app runs on.

export type About = {
  title: string
  lead: string
  data: { label: string; detail: string; refused: string | null }
  app: string
  privacy: string
  links: { id: string; title: string; detail: string | null; url: string }[]
  notes: string[]
}

const SITE = 'https://earnrate.dev'

// The data version's day: "2026.11.17.2" is Nov 17, 2026.
const versionDay = (version: string) =>
  version.slice(0, 10).replaceAll('.', '-')

export function about(request: {
  appVersion: string
  downloaded: boolean
  refused?: string | null // a release this engine couldn't read
}): About {
  const refused = request.refused ?? null
  return {
    title: 'About earnrate',
    lead: "earnrate picks the card that earns the most at a store, from each issuer's own terms, and says why.",
    data: {
      label: `Card data ${dataVersion}`,
      detail: `${shortDate(versionDay(dataVersion))} · ${request.downloaded ? 'Updated from earnrate.dev' : 'Came with the app'}`,
      refused:
        refused !== null && compareDataVersions(refused, dataVersion) > 0
          ? NEWER_DATA_NEEDS_APP
          : null,
    },
    app: `Version ${request.appVersion}`,
    privacy:
      'Your cards and searches stay on this phone. The app downloads card data from earnrate.dev and sends nothing else, except what Add to Apple Wallet needs when you tap it.',
    links: [
      {
        id: 'wrong-rate',
        title: 'Wrong rate?',
        detail: "Tell us the card, the store and the issuer's page.",
        url: `${SITE}/support#wrong-rate`,
      },
      { id: 'support', title: 'Support', detail: null, url: `${SITE}/support` },
      { id: 'privacy', title: 'Privacy', detail: null, url: `${SITE}/privacy` },
      { id: 'terms', title: 'Terms', detail: null, url: `${SITE}/terms` },
      {
        id: 'source',
        title: 'Source code',
        detail: 'On GitHub. Code MIT; card data CC BY-NC 4.0.',
        url: 'https://github.com/cwasley/earnrate',
      },
    ],
    notes: ['No affiliate links, apply links or sponsored placements.'],
  }
}

export type NextFilters = {
  kind: CardFilters['kind']
  noAnnualFee: boolean
  business: boolean
}

const NO_FILTERS: NextFilters = {
  kind: 'any',
  noAnnualFee: false,
  business: false,
}

export type FilterMenu = {
  title: string
  kindLabel: string
  kinds: { id: CardFilters['kind']; label: string }[]
  kind: CardFilters['kind']
  noFee: Toggle
  business: Toggle
  active: number // how many are on, for the menu's badge
}

function filterMenu(f: NextFilters): FilterMenu {
  return {
    title: 'Filters',
    kindLabel: 'Rewards',
    kinds: REWARD_KINDS,
    kind: f.kind,
    noFee: { id: 'noAnnualFee', label: NO_FEE_FILTER, on: f.noAnnualFee },
    business: { id: 'business', label: BUSINESS_FILTER, on: f.business },
    active:
      Number(f.kind !== 'any') + Number(f.noAnnualFee) + Number(f.business),
  }
}

// The month a repeat-bonus note asks for, as the site's field beside it.
type Ask = { label: string; ask: MonthAsk } | null

const askOf = (ask: MonthAsk | null): Ask =>
  ask === null
    ? null
    : { label: monthAskLabel(names().shortName(ask.cardId), ask.field), ask }

export type OfferRow = {
  rank: number
  card: CardRow
  total: string // "+$1,050"
  per: string // "/2 yrs"
  totalLabel: string // the same, for VoiceOver
  years: string[] // "$850 year one", "$200 year two"
  offer: string // its terms, when it ends, and the day it was read
  offerShort: string // the terms in a row's one line
  fee: string // "$95/yr", "No annual fee"
  asOf: string // "Offer as of Nov 1, 2026"
  flag: string | null // why the bonus may not count, in two or three words
  history: string | null // the highest public offer earnrate has recorded
  minimum: { text: string; reachable: boolean } | null
  ineligible: string | null // likely not eligible, and until when
  eligibility: string | null // a month it needs, or an approximate date
  ask: Ask
}

export type NextCard = {
  lead: string
  basis: string
  rows: OfferRow[]
  shown: number // rows before "Show N more"
  moreLabel: string | null
  empty: string | null
  members: string[]
  howTitle: string
  how: string[]
  mayDiffer: string
  filters: FilterMenu
  best: { title: string; text: string }
  rules: { title: string; text: string }
}

const OFFERS_SHOWN = 10

const typicalLines = (c: Catalog) =>
  typicalSpendLines(c).filter((l) => l.merchant.source !== 'none')

const monthlyOf = (c: Catalog, lines: ReturnType<typeof typicalLines>) =>
  countedLines(c, lines).reduce((sum, l) => sum + l.monthly, 0)

// The saved wallet when it's sound, for answers that rank around it.
function usableWallet(raw: unknown): Wallet | null {
  const wallet = walletOf(raw)
  return wallet && walletProblems(wallet, loaded()).length === 0 ? wallet : null
}

function offerRow(o: OfferSummary, rank: number, held: Set<string>): OfferRow {
  const c = loaded()
  const plan = o.plan
  const twoYears = plan?.twoYears ?? o.firstYearValue
  return {
    rank,
    card: cardRow(o.cardId, held),
    total: signedDollars(twoYears),
    per: plan ? TWO_YEARS_PER : '',
    totalLabel: plan ? capitalize(twoYearText(plan)) : signedDollars(twoYears),
    years: plan ? [yearOneText(plan.yearOne), yearTwoText(plan.yearTwo)] : [],
    offer: `${offerTerms(o, currencyName(c, o.currency))}. ${offerAsOfText(o)}`,
    offerShort: offerShortTerms(o, currencyName(c, o.currency)),
    fee: shortFeeText(cardOf(o.cardId)),
    asOf: offerAsOfShortText(o),
    flag:
      o.ineligible !== null
        ? capitalize(BONUS_UNLIKELY)
        : plan?.minimumSpend && !plan.minimumSpend.reachable
          ? capitalize(BONUS_OUT_OF_REACH)
          : o.eligibilityNote !== null
            ? capitalize(BONUS_UNSURE)
            : null,
    history: o.offerHigh?.text ?? null,
    minimum: plan?.minimumSpend
      ? {
          text: minimumSpendText(o.spend, o.months, plan.minimumSpend, true),
          reachable: plan.minimumSpend.reachable,
        }
      : null,
    ineligible: o.ineligible,
    eligibility: o.eligibilityNote,
    ask: askOf(o.monthAsk),
  }
}

// Cards an issuer counts together for its repeat-bonus rule (Southwest's
// three) would each repeat the same note: the first says it once, naming
// every card, and asks for the month; the others point to it.
function sharedRules(
  c: Catalog,
  wallet: Wallet,
  offers: OfferSummary[],
  rows: OfferRow[],
  today: string,
): OfferRow[] {
  const shared = rows.map((row, i) => {
    const o = offers[i]
    const family = cardOf(row.card.id).welcome_offer?.repeat?.also ?? []
    const own = o && bonusEligibility(c, wallet, o.cardId, today)
    const note = row.ineligible ?? row.eligibility
    if (family.length === 0 || !own?.text || note !== own.text) return null
    const named = bonusEligibility(c, wallet, row.card.id, today, true)?.text
    return named
      ? { named, key: `${[row.card.id, ...family].sort().join()}|${named}` }
      : null
  })
  const lead = new Map<string, OfferRow>()
  return rows.map((row, i) => {
    const s = shared[i]
    if (!s || shared.filter((x) => x?.key === s.key).length < 2) return row
    const field = row.ineligible !== null ? 'ineligible' : 'eligibility'
    const first = lead.get(s.key)
    if (!first) {
      lead.set(s.key, row)
      return { ...row, [field]: s.named }
    }
    return { ...row, [field]: sameRuleText(first.card.shortName), ask: null }
  })
}

// Every card the saved wallet doesn't hold (or every card, with none), by
// what it adds over its first two years with its welcome offer, on typical
// spending. The same ranking as compare_welcome_offers and the site's "A new
// card" view.
export function nextCard(request: {
  wallet?: unknown
  filters?: NextFilters
  all?: boolean
  today?: string
}): NextCard {
  const c = loaded()
  const today = request.today ?? localToday()
  const filters = request.filters ?? NO_FILTERS
  const saved = usableWallet(request.wallet)
  const wallet = saved ?? EMPTY
  const held = heldIds(saved)
  const hasCards = held.size > 0
  const lines = typicalLines(c)
  const comparison = compareOffers(
    c,
    wallet,
    { ...filters, includeHeld: false },
    today,
    { lines, typical: true },
  )
  const ahead = comparison.offers.filter((o) => (o.plan?.twoYears ?? 0) > 0)
  const shown = request.all === true ? ahead : ahead.slice(0, OFFERS_SHOWN)
  const { shortName } = names()
  const members = placedAmong(
    comparison.membersOnly.filter(
      (o) => (o.plan?.twoYears ?? 0) > 0 && o.ineligible === null,
    ),
    ahead,
    shown.length,
    offerOrder,
  ).map((o) => `${shortName(o.cardId)} ${signedDollars(o.plan?.twoYears ?? 0)}`)
  const left = ahead.length - shown.length
  return {
    lead: hasCards ? NEXT_CARD_LEAD.yours : NEXT_CARD_LEAD.every,
    basis: `${spendingBasisText(true, monthlyOf(c, lines))} ${TWO_YEARS_LEAD}`,
    rows: sharedRules(
      c,
      wallet,
      shown,
      shown.map((o, i) => offerRow(o, i + 1, held)),
      today,
    ),
    shown: shown.length,
    moreLabel: left > 0 ? showMoreText(left) : null,
    empty: ahead.length === 0 ? NO_OFFER_AHEAD : null,
    members:
      members.length === 0
        ? []
        : [withMembershipText(members, 'over two years')],
    howTitle: HOW_RANKED,
    how: comparison.notes,
    mayDiffer: OFFERS_MAY_DIFFER,
    filters: filterMenu(filters),
    best: { title: BEST_SETUPS, text: BEST_SETUPS_LEAD },
    rules: { title: BONUS_RULES_SHORT, text: BONUS_RULES_TITLE },
  }
}

export type SetupRow = {
  rank: number
  key: string
  cards: CardRow[]
  name: string // "Amex Gold + Double Cash"
  fee: string
  net: string
  per: string
  first: string | null // "$1,200 first year", or why the bonus isn't in it
  split: string | null // the best pair: which card takes what
  lines: string[]
  warnings: string[]
  eligibility: string | null
  ask: Ask
}

export type BestSetups = {
  title: string
  basis: string
  singlesTitle: string
  singles: SetupRow[]
  pairsTitle: string
  pairsNote: string | null
  pairs: SetupRow[]
  members: string[]
  howTitle: string
  how: string[]
  filters: FilterMenu
  callout: string | null // nothing in the spending earns on these cards
  held: string // "Yours"
}

const SETUPS_SHOWN = 5

// Every card alone and in pairs on typical spending, as the site's Best
// setups works it out from scratch: the slowest answer the app asks for, so
// the app calls it off the main thread and shows progress.
export function bestSetups(request: {
  wallet?: unknown
  filters?: NextFilters
  today?: string
}): BestSetups {
  const c = loaded()
  const today = request.today ?? localToday()
  const f = request.filters ?? NO_FILTERS
  const saved = usableWallet(request.wallet)
  const held = heldIds(saved)
  const { shortName, feeLabel } = names()
  const lines = typicalLines(c)
  const memberships = effectiveMemberships(c, saved?.memberships ?? [], [
    ...held,
  ])
  const valuations = saved?.valuations ?? {}
  const base = {
    title: BEST_SETUPS,
    basis: spendingBasisText(true, monthlyOf(c, lines)),
    singlesTitle: SINGLE_CARD,
    pairsTitle: TWO_CARDS,
    howTitle: HOW_CALCULATED,
    filters: filterMenu(f),
    held: ANSWER_LABELS.held,
  }
  const nothing = nothingCounted(c, lines)
  if (nothing !== null)
    return {
      ...base,
      singles: [],
      pairs: [],
      pairsNote: null,
      members: [],
      how: HOW_SETUPS,
      callout: nothing,
    }
  const result = simulateCatalog(c, lines, {
    filters: { ...ALL_PERSONAL_CARDS, ...f, issuer: null },
    memberships,
    valuations,
    start: today,
  })
  const comparison = compareOffers(
    c,
    { ...EMPTY, valuations, memberships },
    { ...f, includeHeld: true },
    today,
    { lines, typical: true },
    historyOf(saved),
  )
  const offers = new Map(
    [...comparison.offers, ...comparison.membersOnly].map((o) => [o.cardId, o]),
  )
  const [single] = result.singles
  const [pair] = result.pairs
  const pairBetter =
    pair !== undefined && single !== undefined && pair.net - single.net >= 0.5
  const ties = single
    ? result.singles.filter(
        (s) => s !== single && Math.abs(s.net - single.net) < HALF_CENT,
      ).length
    : 0

  const singleRow = (s: Simulation, rank: number): SetupRow | null => {
    const card = s.cards[0]
    if (!card) return null
    const id = card.cardId
    const offer = offers.get(id)
    const minimum = offer?.plan?.minimumSpend
    const yearOne = offer?.plan?.yearOne
    const first =
      yearOne !== undefined &&
      offer?.ineligible == null &&
      Math.round(yearOne) !== Math.round(s.net)
        ? firstYearText(yearOne)
        : offer?.ineligible
          ? BONUS_UNLIKELY
          : minimum && !minimum.reachable
            ? BONUS_OUT_OF_REACH
            : null
    const picks = picksText(c, id, card.picks)
    return {
      rank,
      key: id,
      cards: [cardRow(id, held)],
      name: shortName(id),
      fee:
        rank === 1 && ties > 0
          ? `${feeLabel(id)} · ${tiesText(ties)}`
          : feeLabel(id),
      net: wholeDollars(s.net),
      per: PER_YEAR,
      first,
      split: null,
      lines: [
        backBeforeFeeText(s.rewards),
        ...(offer
          ? [
              `${welcomeOfferText(offerTerms(offer, currencyName(c, offer.currency)))}${minimum && minimum.reachable ? ` ${minimumSpendText(offer.spend, offer.months, minimum, true)}` : ''}`,
            ]
          : []),
        ...(picks ? [picks] : []),
        ...s.credits
          .filter((x) => !x.held)
          .map((x) => ifCreditsUsedText(x, s.netIfCreditsUsed)),
        ...(offer
          ? [`${offerAsOfText(offer)}${offer.note ? ` ${offer.note}` : ''}`]
          : []),
      ],
      warnings: [
        ...(offer && minimum && !minimum.reachable
          ? [minimumSpendText(offer.spend, offer.months, minimum, true)]
          : []),
        ...(offer?.ineligible ? [offer.ineligible] : []),
      ],
      eligibility: offer?.eligibilityNote ?? null,
      ask: saved ? askOf(offer?.monthAsk ?? null) : null,
    }
  }

  const pairRow = (p: PairSimulation, rank: number): SetupRow => {
    const parts = pairParts(c, p)
    return {
      rank,
      key: p.cards.map((x) => x.cardId).join('+'),
      cards: p.cards.map((x) => cardRow(x.cardId, held)),
      name: p.cards.map((x) => shortName(x.cardId)).join(' + '),
      fee: feesText(p.annualFees),
      net: wholeDollars(p.net),
      per: PER_YEAR,
      first: null,
      split:
        rank === 1 && parts.length === 2
          ? pairSplitText(parts, shortName)
          : null,
      lines: [
        backBeforeFeesText(p.rewards),
        ...(rank === 1 ? [] : [pairSplitText(splitParts(c, p), shortName)]),
        ...(p.otherCredits > 0
          ? [
              pairCreditsUsedText(
                p.credits
                  .filter((x) => !x.held)
                  .map((x) => shortName(x.cardId)),
                p.otherCredits,
                p.netIfCreditsUsed,
                p.credits.some((x) => !x.held && x.nights > 0),
              ),
            ]
          : []),
        ...(p.alternatives.length > 0
          ? [sameResultText(p.alternatives.map(shortName))]
          : []),
      ],
      warnings: [],
      eligibility: null,
      ask: null,
    }
  }

  const singles = result.singles
    .slice(0, SETUPS_SHOWN)
    .flatMap((s, i) => singleRow(s, i + 1) ?? [])
  const notes = [
    ...new Set([
      ...result.singles.slice(0, 3).flatMap((s) => s.notes),
      ...result.pairs.slice(0, 3).flatMap((s) => s.notes),
    ]),
  ]
  return {
    ...base,
    singles,
    pairsNote:
      !pairBetter && single
        ? noPairBeatsText(shortName(single.cards[0]?.cardId ?? ''))
        : null,
    pairs: pairBetter
      ? result.pairs.slice(0, SETUPS_SHOWN).map((p, i) => pairRow(p, i + 1))
      : [],
    members: ifMemberLines(
      c,
      placedAmong(
        result.membersOnly,
        result.singles,
        singles.length,
        byNet,
      ).map((s) => ({
        membership: s.membership,
        text: `${shortName(s.cards[0]?.cardId ?? '')}, ${wholeDollars(s.net)} a year`,
      })),
    ),
    how: [...HOW_SETUPS, ...notes],
    callout: null,
  }
}

// ---------------------------------------------------------------------------
// Cards: every card earnrate knows, and whether each bonus comes again.

export type CardIndex = {
  title: string
  searchPrompt: string
  lead: string
  art: string
  none: string
  rules: { title: string; text: string }
  groups: { id: string; title: string; index: string; cards: CardRow[] }[]
}

// The site's /cards/ list: every card by issuer, narrowed the way its box
// narrows it, every typed word in a card's names or its issuer's. Business
// cards follow in their own issuer groups, as in Add cards; with a search,
// the closest names come first.
export function cardIndex(request: {
  wallet?: unknown
  query?: string
}): CardIndex {
  const c = loaded()
  const held = heldIds(walletOf(request.wallet))
  const { shortName, issuerName } = names()
  const query = request.query?.trim() ?? ''
  type Ranked = { row: CardRow; closeness: number }
  const byIssuer = new Map<string, Ranked[]>()
  for (const card of c.cards) {
    if (!matchesTyped(cardSearchWords(c, card, shortName), query)) continue
    const row = {
      ...cardRow(card.id, held),
      shortName: cardIndexName(card, shortName),
    }
    const { spoken, abbreviated } = cardNames(card, shortName)
    const closeness =
      query === ''
        ? 0
        : typedCloseness([...spoken, ...abbreviated, row.shortName], query)
    const key = `${card.business ? 'business:' : ''}${card.issuer}`
    byIssuer.set(key, [...(byIssuer.get(key) ?? []), { row, closeness }])
  }
  const closest = (list: Ranked[]) => Math.min(...list.map((r) => r.closeness))
  const groups = [...byIssuer]
    .map(([id, list]) => ({
      id,
      business: id.startsWith('business:'),
      issuer: issuerName(id.replace(/^business:/, '')),
      list,
    }))
    .sort(
      (a, b) =>
        Number(a.business) - Number(b.business) ||
        closest(a.list) - closest(b.list) ||
        a.issuer.localeCompare(b.issuer),
    )
    .map((g) => ({
      id: g.id,
      title: g.business ? `${g.issuer} business` : g.issuer,
      index: g.business ? 'Biz' : g.issuer.slice(0, 1).toUpperCase(),
      cards: g.list
        .sort(
          (a, b) =>
            a.closeness - b.closeness ||
            a.row.shortName.localeCompare(b.row.shortName),
        )
        .map((r) => r.row),
    }))
  // One index letter per letter, on its first issuer; business cards share
  // one entry at the end.
  const seen = new Set<string>()
  for (const g of groups) {
    if (seen.has(g.index)) g.index = ''
    else seen.add(g.index)
  }
  return {
    title: 'Cards',
    searchPrompt: CARDS_INDEX.filterLabel,
    lead: `${cardsIndexLead(c.cards.length)}.`,
    art: CARDS_INDEX.art,
    none: CARDS_INDEX.none,
    rules: { title: BONUS_RULES_SHORT, text: BONUS_RULES_TITLE },
    groups,
  }
}

export type BonusRulesScreen = {
  title: string
  lead: string[]
  had: { link: string; rest: string }
  column: string
  searchPrompt: string
  none: string
  groups: {
    id: string
    title: string
    rows: {
      card: CardRow
      label: string
      detail: string
      quote: string | null
      yours: string | null // for a card held or had: when it can come again
      ask: Ask
    }[]
  }[]
}

// /bonus-rules: each card's rule for earning its welcome bonus again, quoted.
// For a card the person holds or has had, what the rule means for them.
export function bonusRulesScreen(request: {
  wallet?: unknown
  query?: string
  today?: string
}): BonusRulesScreen {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet)
  const held = heldIds(wallet)
  const { shortName, issuerName } = names()
  const query = request.query ?? ''
  const rules = bonusRules(c, issuerName, shortName)
  return {
    title: BONUS_RULES_SHORT,
    lead: [
      bonusRulesLead(rules.offered, rules.stated, rules.once),
      BONUS_RULES_UNPUBLISHED,
    ],
    had: BONUS_RULES_HAD,
    column: BONUS_RULES_COLUMN,
    searchPrompt: 'Find a card or bank',
    none: CARDS_INDEX.none,
    groups: rules.groups.flatMap(({ issuer, rules: list }) => {
      const rows = list
        .filter((r) =>
          matchesTyped(cardSearchWords(c, r.card, shortName), query),
        )
        .map((r) => {
          const yours = wallet
            ? bonusEligibility(c, wallet, r.card.id, today)
            : null
          return {
            card: cardRow(r.card.id, held),
            label: r.label,
            detail: r.detail,
            quote: r.quote,
            yours: yours?.text ?? null,
            ask: askOf(yours?.ask ?? null),
          }
        })
      return rows.length === 0
        ? []
        : [{ id: issuer, title: issuerName(issuer), rows }]
    }),
  }
}

// ---------------------------------------------------------------------------
// Outside the app's screens: widgets, Siri and Shortcuts, Spotlight and
// reminders. Each is worked out here, in the app, and handed over as words
// and dates; the widget only reads what the app last wrote.

export type WidgetRow = {
  label: string // "Groceries"
  query: string | null // the answer a tap opens; null for Abroad
  name: string // "Amex Gold"
  rate: string // "4%"
  line: string // "Groceries · Amex Gold 4%", for one line on the Lock Screen
  // The same with the name the cheat sheet widgets use (narrowName):
  // "Sapphire Preferred" for Chase Sapphire Preferred.
  short: string
  shortLine: string
  art: CardArt | null
}

export type WidgetSheet = {
  from: string // YYYY-MM-DD: shown from this day…
  until: string // …through this one, the quarter's last day
  title: string
  quarter: string // "Q4 2026"
  scope: string // whose cards: "Your cards" or "Every card"
  rows: WidgetRow[]
}

// A card's name in the cheat sheet widgets, one rule for every row: the
// short name without its issuer ("Sapphire Preferred", "Double Cash",
// "Venture X"), unless that leaves one word ("Amex Gold") or a lowercase
// one ("Discover it Cash Back").
function narrowName(c: Catalog, cardId: string): string {
  const card = cardOf(cardId)
  const name = card.short_name ?? names().shortName(cardId)
  const issuer = c.issuers.find((i) => i.id === card.issuer)
  const lower = name.toLowerCase()
  for (const word of [issuer?.name ?? '', ...(issuer?.search ?? [])]) {
    if (word === '' || !lower.startsWith(`${word.toLowerCase()} `)) continue
    const rest = name.slice(word.length + 1)
    const first = rest.split(' ')[0] ?? ''
    return rest.includes(' ') && first !== first.toLowerCase() ? rest : name
  }
  return name
}

// What the widgets say with no cards saved, in full and for the Lock Screen.
export type WidgetEmpty = { text: string; short: string }
const WIDGET_EMPTY: WidgetEmpty = {
  text: 'Add your cards in earnrate to see your cheat sheet here.',
  short: 'Add your cards in earnrate',
}

// The cheat sheet for this quarter and, ready for when it turns over, the
// next one, from the saved cards. With none saved there's no sheet, so the
// widgets don't pass every card off as the person's own; `purchases` still
// names the rows a Lock Screen widget can be set to.
export function widgets(request: { wallet?: unknown; today?: string }): {
  sheets: WidgetSheet[]
  empty: WidgetEmpty | null
  purchases: string[]
} {
  const c = loaded()
  const today = request.today ?? localToday()
  const raw = walletOf(request.wallet)
  if (raw === null || raw.cards.length === 0)
    return {
      sheets: [],
      empty: WIDGET_EMPTY,
      purchases: catalogCheatSheet(c, today, {
        filters: ALL_PERSONAL_CARDS,
        memberships: [],
        valuations: {},
      }).rows.map((r) => r.label),
    }
  const wallet = walletProblems(raw, c).length === 0 ? raw : null
  const { shortName } = names()
  const sheetFor = (from: string): WidgetSheet => {
    const sheet = wallet
      ? cheatSheet(c, wallet, from)
      : catalogCheatSheet(c, from, {
          filters: ALL_PERSONAL_CARDS,
          memberships: effectiveMemberships(c, raw.memberships, []),
          valuations: raw.valuations,
        })
    return {
      from,
      until: currentPeriodEnd('quarter', from, null) ?? from,
      title: 'Cheat sheet',
      quarter: sheet.quarter,
      scope: wallet ? ANSWER_LABELS.yours : ANSWER_LABELS.every,
      rows: sheet.rows.map((row, i) => {
        const item = EVERYDAY_PURCHASES[i]
        const name =
          row.cardId === null ? 'None of your cards' : shortName(row.cardId)
        const short = row.cardId === null ? name : narrowName(c, row.cardId)
        const rate =
          row.effectiveReturnPct === null ? '' : pct(row.effectiveReturnPct)
        return {
          label: row.label,
          query: item ? quickPickText(item) : null,
          name,
          rate,
          line: `${row.label} · ${rate === '' ? name : `${name} ${rate}`}`,
          short,
          shortLine: `${row.label} · ${rate === '' ? short : `${short} ${rate}`}`,
          art: row.cardId === null ? null : artOf(row.cardId),
        }
      }),
    }
  }
  const now = sheetFor(today)
  return {
    sheets: [now, sheetFor(addDays(now.until, 1))],
    empty: null,
    purchases: now.rows.map((r) => r.label),
  }
}

export type Brief = {
  query: string // what was asked, to open its answer in the app
  title: string // the store or kind of place
  subtitle: string | null
  label: string | null // "Use", "Best card"
  name: string | null
  detail: string | null // "4% back"
  reason: string | null
  art: CardArt | null
  // Why a better card isn't the pick: a store that takes only some networks.
  accepts: string | null
  note: string | null // whose cards, or what's missing
  spoken: string // the answer in a sentence or two, for Siri to say
}

// One store's answer, short enough for Siri to say and a snippet to show:
// the pick, its rate and the rule behind it.
export function brief(request: {
  query: string
  wallet?: unknown
  today?: string
}): Brief {
  const c = loaded()
  const a = answer({ ...request, all: false })
  const m = resolvePlace(c, splitPurchaseText(request.query).merchant, null)
  const place =
    m.source === 'category'
      ? `for ${a.title.charAt(0).toLowerCase()}${a.title.slice(1)}`
      : `at ${a.title}`
  const pick = a.pick
  const spoken = (): string => {
    if (pick === null)
      return [a.verdict ?? NONE_OF_YOURS, ...a.callouts.slice(0, 1)].join(' ')
    if (m.source === 'none')
      return `earnrate doesn't know “${m.input}” yet, so only base rates apply. ${pick.name} earns the most on those, ${pick.detail}.`
    const earns = [
      `It earns ${pick.detail}, ${pick.reason}.`,
      ...a.accepts,
    ].join(' ')
    if (a.scope === 'every')
      return `The best card ${place} is ${pick.name}. ${earns}`
    return pick.label === USE_CARD
      ? `Use ${pick.name} ${place}. ${earns}`
      : `Use ${pick.name} ${place} ${FOR_WELCOME_BONUS}. ${earns}`
  }
  return {
    query: request.query.trim(),
    title: a.title,
    subtitle: a.subtitle,
    label: pick?.label ?? null,
    name: pick?.name ?? null,
    detail: pick?.detail ?? null,
    reason: pick?.reason ?? null,
    art: pick?.art ?? null,
    accepts:
      pick === null || a.acceptsWhy.length === 0
        ? null
        : a.acceptsWhy.join(' '),
    note:
      m.source === 'none'
        ? unknownStoreTapText(m.input)
        : a.scope === 'every'
          ? a.canChooseScope
            ? EVERY_CARD_TOO
            : EVERY_CARD_NOTE
          : null,
    spoken: spoken(),
  }
}

export type Place = {
  text: string // what a search for it says: "Whole Foods Market", "Groceries"
  kind: 'store' | 'place'
  detail: string | null // "Counts as a supermarket"
  keywords: string[]
}

// Every store and kind of place earnrate knows, the everyday ones first,
// for Spotlight and Siri.
export function places(): { places: Place[] } {
  const c = loaded()
  const seen = new Set<string>()
  const out: Place[] = []
  const add = (p: Place) => {
    const key = p.text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(p)
  }
  for (const item of EVERYDAY_PURCHASES)
    if (!('category' in item && item.category === 'other'))
      add({
        text: quickPickText(item),
        kind: 'merchant' in item ? 'store' : 'place',
        detail: null,
        keywords: [],
      })
  for (const cat of c.categories)
    if (cat.id !== 'other')
      add({
        text: cat.name,
        kind: 'place',
        detail: null,
        keywords: cat.aliases,
      })
  for (const merchant of [...c.merchants.overrides, ...c.merchants.seed]) {
    const m = resolveMerchantById(c, merchant.id, null)
    add({
      text: merchant.name,
      kind: 'store',
      detail: m === null ? null : capitalize(`counts ${countsAs(c, m)}`),
      keywords: merchant.aliases,
    })
  }
  return { places: out }
}

export type Reminder = {
  id: string // the same item keeps its id, so a reschedule replaces it
  cardId: string
  focus: TodoRow['focus']
  title: string // "Use Resy credit"
  card: string // "Amex Platinum"
  body: string // the to-do's own sentence
  due: string // YYYY-MM-DD
  remindOn: string // YYYY-MM-DD: the morning to remind
}

const REMINDER_SETTING = {
  title: 'Reminders',
  label: 'Remind me before deadlines',
  footer:
    "earnrate reminds you a few days before an activation deadline or a credit you use runs out, and two weeks before a welcome bonus's spending deadline. Reminders are set on this phone, and nothing is sent anywhere.",
  denied: 'Notifications for earnrate are off in the Settings app.',
  openSettings: 'Open Settings',
}

const REMINDER_OFFER = {
  text: 'Get a reminder a few days before deadlines like these.',
  yes: 'Remind me',
  no: 'No thanks',
}

// How many days ahead of its date each kind of item is reminded, or null
// for kinds with no deadline to miss. An activation that hasn't opened yet
// is reminded the day it opens.
function reminderLead(item: ChecklistRowItem): number | null {
  if (item.due === null) return null
  switch (item.kind) {
    case 'activate':
      return item.row.when?.startsWith('from ') === true ? 0 : 3
    case 'credit':
      return 3
    case 'bonus':
      return 14
    default:
      return null
  }
}

// How many months ahead reminders are worked out, and the most kept: iOS
// keeps 64 pending notifications an app, and the app works these out again
// whenever the wallet changes or it's opened on a new day.
const REMINDER_MONTHS = 2
const REMINDERS_KEPT = 24

// The dated to-do items worth a reminder: this month's, and those the next
// months bring (next month's credits, next quarter's activation), soonest
// reminder first.
export function reminders(request: { wallet?: unknown; today?: string }): {
  reminders: Reminder[]
} {
  const c = loaded()
  const today = request.today ?? localToday()
  const wallet = walletOf(request.wallet)
  if (
    !wallet ||
    wallet.cards.length === 0 ||
    walletProblems(wallet, c).length > 0
  )
    return { reminders: [] }
  const { shortName } = names()
  const [year = 0, month = 1] = today.split('-').map(Number)
  const days = [
    today,
    ...Array.from({ length: REMINDER_MONTHS }, (_, i) =>
      new Date(Date.UTC(year, month + i, 1)).toISOString().slice(0, 10),
    ),
  ]
  const found = new Map<string, Reminder>()
  for (const day of days)
    for (const item of checklistRows(c, wallet, day, undefined, shortName)) {
      const lead = reminderLead(item)
      if (lead === null || item.due === null || item.due < today) continue
      const id = `${item.kind}-${item.cardId}-${item.ref ?? item.row.title}-${item.due}`
      if (found.has(id)) continue
      const on = addDays(item.due, -lead)
      found.set(id, {
        id,
        cardId: item.cardId,
        focus: focusOf(item.kind),
        title: item.row.title,
        card: item.row.card,
        body: item.text,
        due: item.due,
        remindOn: on < today ? today : on,
      })
    }
  return {
    reminders: [...found.values()]
      .sort(
        (a, b) =>
          a.remindOn.localeCompare(b.remindOn) || a.id.localeCompare(b.id),
      )
      .slice(0, REMINDERS_KEPT),
  }
}

// ---------------------------------------------------------------------------
// Add to Apple Wallet: exactly the form the site's button posts to
// pass.earnrate.dev (site/app/pass-request.ts), made only when tapped. The
// app sends these two fields and nothing else; the signer keeps nothing.

export type WalletPass = {
  url: string
  fields: { name: string; value: string }[] // in order, form-encoded
  failed: string // the alert's title when no pass comes back
  offline: string
}

export function walletPass(request: {
  wallet?: unknown
  today?: string
}): WalletPass | null {
  const wallet = walletOf(request.wallet)
  if (!wallet || wallet.cards.length === 0) return null
  const form = passForm(wallet, request.today ?? localToday())
  return {
    url: PASS_URL,
    fields: [
      { name: 'wallet', value: form.wallet },
      { name: 'date', value: form.date },
    ],
    failed: "Couldn't make the pass",
    offline:
      "earnrate's server didn't answer. Check the connection and try again.",
  }
}

// Tests hand the catalog over directly; the app parses it from the bundle.
export function useCatalog(next: Catalog, version = ''): number {
  catalog = next
  dataVersion = version
  text = null
  return next.cards.length
}

// The app's stored card data: the catalog as parsed, with its version.
export type StoredCatalog = { version: string; catalog: Catalog }

export function catalogInfo(): { version: string; format: number } {
  return { version: dataVersion, format: CATALOG_FILE_FORMAT }
}

// A catalog file downloaded from earnrate.dev, checked by this engine's own
// schemas and integrity rules. One it can't read, or no newer than the data
// it runs on, throws; one it can is used from then on, and comes back in
// the form the app stores.
export function checkCatalog(json: string): string {
  const { version, catalog: next } = parseCatalogFile(JSON.parse(json))
  if (dataVersion !== '' && compareDataVersions(version, dataVersion) <= 0) {
    throw new Error(`Card data ${version} is not newer than ${dataVersion}.`)
  }
  useCatalog(next, version)
  return JSON.stringify({ version, catalog: next } satisfies StoredCatalog)
}

// Each call takes one JSON request and answers with JSON.
const call =
  (f: (request: never) => unknown) =>
  (request: string): string =>
    JSON.stringify(f(JSON.parse(request) as never))

const engine = {
  load: (json: string): number => {
    const stored = JSON.parse(json) as StoredCatalog
    return useCatalog(stored.catalog, stored.version)
  },
  checkCatalog,
  catalogInfo: () => JSON.stringify(catalogInfo()),
  about: call(about),
  cardFeeWorth: call(cardFeeWorth),
  home: call(home),
  suggest: call(suggest),
  answer: call(answer),
  recordPurchase: call(recordPurchase),
  keepOrReplace: call(keepOrReplace),
  walletPass: call(walletPass),
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
  nextCard: call(nextCard),
  bestSetups: call(bestSetups),
  cardIndex: call(cardIndex),
  bonusRules: call(bonusRulesScreen),
  widgets: call(widgets),
  brief: call(brief),
  places: () => JSON.stringify(places()),
  reminders: call(reminders),
}

;(globalThis as { earnrate?: typeof engine }).earnrate = engine
