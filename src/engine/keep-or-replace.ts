// "Keep or replace?" for a fee card the person holds: what it adds to their
// wallet after its fee, and which cards with a lower fee would keep the most
// of that in its place. Node-free: earnrate.dev runs it in the browser.
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import type { Wallet, WalletCard } from '../schema/wallet.ts'
import { bonusDollars } from './bonus.ts'
import { HALF_CENT } from './compare.ts'
import { unsaidCreditsYear, type CreditsYear } from './credits.ts'
import { evaluateCard, purchaseContext } from './evaluate.ts'
import { ALL_PERSONAL_CARDS, idealHolding } from './explore.ts'
import { TRANSFER_VALUES, transferIfText } from './fee-worth.ts'
import { ifMemberLines, placedAmong } from './memberships.ts'
import { ineligibleText, OFFERS_MAY_DIFFER, offerTerms } from './offers.ts'
import { inEffect } from './periods.ts'
import { merchantName } from './rule-text.ts'
import { findMerchant } from '../merchants/resolve.ts'
import {
  renewalCheck,
  renewalDue,
  type Renewal,
  type Spending,
} from './renewal.ts'
import {
  gainOrder,
  simulateAdditions,
  typicalSpendLines,
  type Addition,
  type ResolvedLine,
} from './simulate.ts'
import {
  capitalize,
  categoryPhrase,
  creditsOnlyIf,
  creditsYearText,
  CREDITS_APART,
  currencyName,
  feeCardEarnsText,
  feeCardExtrasText,
  FREE_NIGHT_NAME,
  ifCreditsUsedText,
  listed,
  money,
  num,
  perksNoun,
  possessive,
  roundCents,
  shortCardName,
  shortDate,
  wholeDollars,
} from './text.ts'
import { cardValuation } from './valuation.ts'

// How many cheaper cards the answer names.
export const REPLACEMENTS = 3

// Rates the spending lines hide: the most named on one line, and the most
// lines given a sentence of their own.
export const HIDDEN_NAMED = 3
export const HIDDEN_LINES = 2

export const OTHER_PERKS =
  'earnrate has nothing on lounge access, travel insurance, elite status or other perks, so weigh those yourself'

export const PERKS_NOT_COUNTED = `This counts only earning, statement credits, free nights and fees: ${OTHER_PERKS}.`

export type ReplacementOffer = {
  terms: string // "60,000 Chase Ultimate Rewards after $4,000 in purchases within 3 months"
  value: number | null // dollars at the wallet's point values; null for cash
  ineligible: string | null
  validTo: string | null
}

export type Replacement = {
  cardId: string
  // Cards with the same fee that would add the same.
  alternatives: string[]
  annualFee: number
  // What it adds to the wallet in the held card's place, a year after its fee.
  net: number
  // `net` as a percent of what the held card adds, rounded; null when the
  // held card adds nothing after its fee.
  share: number | null
  feeSaved: number
  // Its statement credits and free nights: not in `net`, since the person
  // hasn't said they'd use them.
  credits: CreditsYear | null
  netIfCreditsUsed: number
  offer: ReplacementOffer | null // a one-time bonus: never in `net` or `share`
  samePoints: boolean // earns the held card's own points currency
}

export type KeepOrReplaceOutcome =
  | 'not-needed' // the other cards already do as well without it
  | 'ahead' // a cheaper card adds as much or more in its place
  | 'keeps' // a cheaper card keeps part of what it adds
  | 'none-close' // no cheaper card adds anything after its fee

export type KeepOrReplace = {
  cardId: string
  name: string
  fee: number
  start: string // the year counted starts here: the renewal, or today
  due: string | null // the renewal date, when it's near
  alone: boolean // no other card in the wallet: compared with having none
  renewal: Renewal
  // What the card adds to the wallet a year, after its fee: its rewards
  // beyond the other cards', plus the credits and free nights the person
  // uses. Held alone, all it earns.
  added: number
  outcome: KeepOrReplaceOutcome
  replacements: Replacement[] // the best few, most added first
  // Cards that need a membership the wallet doesn't have, where they'd
  // have placed: "If you have a Costco membership: …".
  members: string[]
  // Its credits and free nights the person hasn't said they use or don't.
  unsaid: CreditsYear
  typical: boolean
  points: { currency: string; cents: number; saved: boolean } | null
  // The best cheaper card earning the held card's own points currency, by
  // what it adds, whether or not it's among `replacements`.
  samePoints: Replacement | null
  // The same answer with the held card's points at transfer value, when
  // they transfer and the wallet sets no value of its own.
  transfer: { cents: number; result: KeepOrReplace } | null
  // Spending lines that cover a category only as a whole, where the card
  // earns more on parts of it: "Travel" and its flights and hotels.
  // `one` when the parts are a single store, said in the singular.
  // `kind` names more of them: "and 15 more streaming services".
  hidden: { line: string; parts: string[]; one: boolean; kind: string | null }[]
}

const whole = (n: number) => Math.round(n)

export function keepOrReplace(
  catalog: Catalog,
  wallet: Wallet,
  cardId: string,
  today: string,
  spending: Spending = { lines: typicalSpendLines(catalog), typical: true },
): KeepOrReplace | null {
  const k = weigh(catalog, wallet, cardId, today, spending)
  const card = catalog.cards.find((c) => c.id === cardId)
  const cents = card ? TRANSFER_VALUES[card.currency] : undefined
  if (!k || !card || cents === undefined) return k
  if (wallet.valuations[card.currency] !== undefined) return k
  const result = weigh(
    catalog,
    { ...wallet, valuations: { ...wallet.valuations, ...TRANSFER_VALUES } },
    cardId,
    today,
    spending,
  )
  return result === null ? k : { ...k, transfer: { cents, result } }
}

function weigh(
  catalog: Catalog,
  wallet: Wallet,
  cardId: string,
  today: string,
  spending: Spending,
): KeepOrReplace | null {
  const card = catalog.cards.find((c) => c.id === cardId)
  const held = wallet.cards.find((c) => c.id === cardId)
  const fee = card?.annual_fee ?? 0
  if (!card || !held || fee <= 0) return null
  // Near the renewal, the year after it: the same figures as the to-do.
  const due = renewalDue(held, today)
  const start = due ?? today
  const renewal = renewalCheck(catalog, wallet, card, start, spending)
  const alone = !wallet.cards.some(
    (c) => c.id !== cardId && catalog.cards.some((x) => x.id === c.id),
  )
  const added = alone
    ? roundCents(renewal.walletRewards + renewal.credits - fee)
    : renewal.net
  const without: Wallet = {
    ...wallet,
    cards: wallet.cards.filter((c) => c.id !== cardId),
  }
  const cheaper = (c: Card) =>
    c.network !== 'store' && c.annual_fee !== undefined && c.annual_fee < fee
  const { additions, membersOnly } = simulateAdditions(
    catalog,
    without,
    spending.lines,
    {
      filters: { ...ALL_PERSONAL_CARDS, business: card.business },
      memberships: wallet.memberships,
      valuations: wallet.valuations,
      start,
    },
    cheaper,
  )
  const sharesPoints = (c: Card) =>
    card.currency !== 'cash' && c.currency === card.currency
  const share = (net: number) =>
    whole(added) > 0 ? Math.round((net / added) * 100) : null
  const replacement = (a: Addition, alternatives: string[]): Replacement => {
    const c = catalog.cards.find((x) => x.id === a.cardId)
    const credits =
      a.simulation.credits.find((x) => x.cardId === a.cardId && !x.held) ?? null
    return {
      cardId: a.cardId,
      alternatives,
      annualFee: a.annualFee,
      net: a.gain,
      share: share(a.gain),
      feeSaved: roundCents(fee - a.annualFee),
      credits,
      netIfCreditsUsed: roundCents(a.gain + (credits?.yearly ?? 0)),
      offer: c ? offerOf(catalog, wallet, without, c, today) : null,
      samePoints: c !== undefined && sharesPoints(c),
    }
  }
  const shown = foldTies(additions.filter((a) => whole(a.gain) > 0)).slice(
    0,
    REPLACEMENTS,
  )
  const [best] = shown
  const outcome: KeepOrReplaceOutcome =
    !alone && whole(added) <= 0
      ? 'not-needed'
      : best === undefined
        ? 'none-close'
        : whole(best.addition.gain) >= whole(added)
          ? 'ahead'
          : 'keeps'
  const replacements =
    outcome === 'not-needed' || outcome === 'none-close'
      ? []
      : shown.map((s) => replacement(s.addition, s.alternatives))
  const members =
    replacements.length === 0
      ? []
      : ifMemberLines(
          catalog,
          placedAmong(
            membersOnly.filter((a) => whole(a.gain) > 0),
            shown.map((s) => s.addition),
            REPLACEMENTS,
            gainOrder,
          ).map((a) => ({
            membership: a.membership,
            text: `${nameOf(catalog, a.cardId)}, about ${wholeDollars(a.gain)} a year after its fee`,
          })),
        )
  const valuation = cardValuation(catalog, wallet, card)
  const sameBest = additions.find((a) =>
    sharesPoints(catalog.cards.find((c) => c.id === a.cardId) ?? card),
  )
  const samePoints =
    sameBest === undefined
      ? null
      : (replacements.find((r) => r.cardId === sameBest.cardId) ??
        replacement(sameBest, []))
  return {
    cardId,
    name: held.checkout_label ?? shortCardName(card.name),
    fee,
    start,
    due,
    alone,
    renewal,
    added,
    outcome,
    replacements,
    members,
    unsaid: unsaidCreditsYear(catalog, card, held, start, wallet.valuations),
    typical: spending.typical,
    points:
      valuation.currency === 'cash'
        ? null
        : {
            currency: valuation.currency,
            cents: valuation.centsPerUnit,
            saved: wallet.valuations[valuation.currency] !== undefined,
          },
    samePoints,
    transfer: null,
    hidden: hiddenRates(catalog, wallet, card, held, spending.lines, start),
  }
}

// Several bookings through one travel site ("flights through Amex Travel",
// "cruises through Amex Travel") read as "bookings through Amex Travel".
function bookingsTogether(parts: string[]): string[] {
  const via = (p: string) => / through (.+)$/.exec(p)?.[1] ?? null
  const count = (site: string) => parts.filter((p) => via(p) === site).length
  const out: string[] = []
  for (const p of parts) {
    const site = via(p)
    const named =
      site === null || count(site) < 2 ? p : `bookings through ${site}`
    if (!out.includes(named)) out.push(named)
  }
  return out
}

// Spending lines for a whole category ("Travel") where the card has higher
// rates on parts of it (flights, Chase Travel) that no line names: a
// purchase in the whole category earns only what the card gives the whole.
function hiddenRates(
  catalog: Catalog,
  wallet: Wallet,
  card: Card,
  held: WalletCard,
  lines: ResolvedLine[],
  date: string,
): KeepOrReplace['hidden'] {
  const holding = idealHolding(card, date, held.chosen?.picks ?? {})
  const own: Wallet = { ...wallet, cards: [holding] }
  const named = (category: string | null, merchant: string | null) =>
    lines.some(
      (l) =>
        (category !== null && l.merchant.category === category) ||
        (merchant !== null && l.merchant.merchantId === merchant),
    )
  const under = (parent: string, id: string | undefined) =>
    id !== undefined && id.startsWith(`${parent}.`)
  return lines.flatMap((line) => {
    if (line.merchant.source !== 'category') return []
    const parent = line.merchant.category
    const ctx = purchaseContext(catalog, own, line.merchant, parent, {
      amount: null,
      date,
      country: 'US',
    })
    const wholeRate = evaluateCard(card, holding, ctx).best.rate
    // Kinds of purchase and travel sites first, then single stores, each in
    // the card's own order.
    const parts = card.rules.flatMap((rule) => {
      if (!inEffect(rule, date) || rule.rate <= wholeRate) return []
      const categories = (rule.match.categories ?? [])
        .filter((c) => under(parent, c) && !named(c, null))
        .map((c) => ({ text: categoryPhrase(catalog, c), store: false }))
      const merchants = (rule.match.merchants ?? [])
        .filter((m) => {
          const category = findMerchant(catalog, m)?.category
          return (
            (category === parent || under(parent, category)) && !named(null, m)
          )
        })
        .map((m) => {
          const kind = findMerchant(catalog, m)?.kind
          return {
            text: merchantName(catalog, m),
            store: kind !== 'portal' && kind !== 'booking',
          }
        })
      return [...merchants, ...categories]
    })
    const ordered = [
      ...parts.filter((p) => !p.store),
      ...parts.filter((p) => p.store),
    ].map((p) => p.text)
    const unique = bookingsTogether([...new Set(ordered)])
    const [first] = unique
    if (first === undefined) return []
    const store = (m: string) =>
      merchantName(catalog, m) === first &&
      findMerchant(catalog, m)?.kind !== 'booking'
    const one =
      unique.length === 1 &&
      card.rules.some((r) => (r.match.merchants ?? []).some(store))
    const name = categoryPhrase(catalog, parent)
    const kind = /[^s]s$/.test(name.split(' and ')[0] ?? name) ? name : null
    return [{ line: line.label, parts: unique, one, kind }]
  })
}

const nameOf = (catalog: Catalog, id: string) =>
  shortCardName(catalog.cards.find((c) => c.id === id)?.name ?? id)

// Cards with the same fee that add the same (several flat 2% cards) are one
// entry: the first, with the others as alternatives.
function foldTies(list: Addition[]) {
  const folded: { addition: Addition; alternatives: string[] }[] = []
  for (const a of list) {
    const twin = folded.find(
      (f) =>
        f.addition.annualFee === a.annualFee &&
        Math.abs(f.addition.gain - a.gain) < HALF_CENT,
    )
    if (twin) twin.alternatives.push(a.cardId)
    else folded.push({ addition: a, alternatives: [] })
  }
  return folded
}

function offerOf(
  catalog: Catalog,
  wallet: Wallet,
  without: Wallet,
  card: Card,
  today: string,
): ReplacementOffer | null {
  const offer = card.welcome_offer
  if (!offer || !inEffect(offer, today)) return null
  const holding: WalletCard = { id: card.id, cap_usage: {}, activated: [] }
  const valuation = cardValuation(
    catalog,
    { ...without, cards: [...without.cards, holding] },
    card,
  )
  return {
    terms: offerTerms(
      {
        points: offer.points,
        dollars: offer.dollars,
        spend: offer.spend,
        months: offer.months,
        varies: offer.varies,
      },
      currencyName(catalog, valuation.currency),
    ),
    value:
      offer.points === undefined
        ? null
        : roundCents(
            bonusDollars(
              card,
              valuation.centsPerUnit,
              offer.points,
              offer.dollars,
            ) ?? 0,
          ),
    ineligible: ineligibleText(catalog, wallet, offer.not_with ?? []),
    validTo: offer.valid_to ?? null,
  }
}

// A card that adds no more than its fee, by the two figures a person can
// check: "adds about $18 a year, less than its $95 fee", "adds nothing
// beyond your other cards, against its $95 fee". `net` is after the fee.
function belowFee(
  verb: string,
  net: number,
  fee: number,
  beyond = ' beyond your other cards',
  // Said after the amount too: "adds about $30 a year beyond them".
  amountBeyond = '',
): string {
  const gross = net + fee
  if (whole(gross) <= 0)
    return `${verb} nothing${beyond}, against its ${money(fee)} fee`
  const adds = `${verb} about ${wholeDollars(gross)} a year${amountBeyond}`
  return whole(net) === 0
    ? `${adds}, about what its ${money(fee)} fee costs`
    : `${adds}, less than its ${money(fee)} fee`
}

// "the Chase Sapphire Reserve adds about $35 a year", or what it adds
// against its fee when that's no more.
function heldAdds(k: KeepOrReplace): string {
  return whole(k.added) > 0
    ? `the ${k.name} adds about ${wholeDollars(k.added)} a year`
    : `the ${k.name} ${belowFee('adds', k.added, k.fee, k.alone ? '' : undefined)}`
}

export function feeSavedText(k: KeepOrReplace, r: Replacement): string {
  const fee =
    r.annualFee === 0
      ? 'It has no annual fee'
      : `Its annual fee is ${money(r.annualFee)}`
  return `${fee}, ${money(r.feeSaved)} a year less than ${possessive(`the ${k.name}`)}.`
}

// The answer first: what a card in its place would do, or why none needs to.
// `paysForItself`: said beside a tag that says so, so a card that would add
// more in its place doesn't read as a contradiction.
export function keepOrReplaceVerdict(
  catalog: Catalog,
  k: KeepOrReplace,
  paysForItself = false,
): string {
  const [best] = k.replacements
  const lead = keepOrReplaceLead(catalog, k, paysForItself)
  return best === undefined ? lead : `${lead} ${feeSavedText(k, best)}`
}

// The verdict's first sentence; the fee saved by the best card follows it.
export function keepOrReplaceLead(
  catalog: Catalog,
  k: KeepOrReplace,
  paysForItself = false,
): string {
  const [best] = k.replacements
  if (k.outcome === 'not-needed') {
    const adds = belowFee(
      'it adds',
      k.added,
      k.fee,
      ' beyond them',
      ' beyond them',
    )
    return `Your other cards already cover what the ${k.name} earns: ${adds}, so no card needs to take its place.`
  }
  if (best === undefined)
    return `Nothing with a lower fee comes close: in its place, no such card would add anything to your wallet after its fee, while ${heldAdds(k)}.`
  const name = nameOf(catalog, best.cardId)
  const net = wholeDollars(best.net)
  if (k.outcome === 'keeps')
    return `In its place, the ${name} would keep the most of what the ${k.name} adds to your wallet: about ${net} of ${wholeDollars(k.added)} a year after fees (${String(best.share)}%).`
  const inPlace = paysForItself
    ? `It pays for itself, and in its place the ${name}`
    : `In its place, the ${name}`
  return whole(k.added) <= 0
    ? `${inPlace} would add about ${net} a year to your wallet after its fee, while ${heldAdds(k)}.`
    : whole(best.net) === whole(k.added)
      ? `${inPlace} would add about as much to your wallet as the ${k.name}: about ${net} a year after its fee.`
      : `${inPlace} would add more to your wallet than the ${k.name}: about ${net} a year after its fee, against ${wholeDollars(k.added)}.`
}

// How the held card's figure is made up.
export function keepOrReplaceMath(k: KeepOrReplace): string {
  const when =
    k.due === null
      ? 'Over the next 12 months'
      : `For the year after it renews around ${shortDate(k.due)}`
  const basis = k.typical ? 'at typical U.S. spending' : 'on your spending'
  const earns = k.alone
    ? feeCardEarnsText(k.renewal.walletRewards, null, `the ${k.name}`)
    : feeCardEarnsText(
        k.renewal.rewardsAdded,
        'your other cards would',
        `the ${k.name}`,
      )
  return `${when} ${basis}, ${earns}${feeCardExtrasText(k.renewal)}, against its ${money(k.fee)} fee.`
}

// Its credits and free nights the person hasn't said they use, with what
// the card would add if they used them all; empty when there are none.
export function keepOrReplaceUnsaid(k: KeepOrReplace): string {
  const parts: string[] = []
  const u = k.unsaid
  if (u.yearly > 0) {
    const one = u.names.length === 1
    const withAll = roundCents(k.added + u.yearly)
    const upTo = u.nights > 0 ? 'up to ' : ''
    parts.push(
      `${capitalize(possessive(`the ${k.name}`))} ${perksNoun(u, false, true)} you haven't marked as used (${creditsYearText(u)}) ${one ? "isn't" : "aren't"} counted; with ${one ? 'it' : 'them all'}, it would ${whole(withAll) > 0 ? `add ${upTo}about ${wholeDollars(withAll)} a year` : belowFee('add', withAll, k.fee).replace(/^add about/, `add ${upTo}about`)}.`,
    )
  }
  if (k.renewal.nightsUnvalued > 0 && u.unvaluedNightIds.length > 0)
    parts.push(
      `Its ${FREE_NIGHT_NAME} isn't counted until you say what it's worth to you.`,
    )
  return parts.join(' ')
}

// "the Citi Strata", "the Fidelity Rewards Visa Signature, the SoFi
// Unlimited 2% or 2 more": cards that would do the same; empty for none.
export function alternativesText(catalog: Catalog, r: Replacement): string {
  const [first, second, ...rest] = r.alternatives.map(
    (id) => `the ${nameOf(catalog, id)}`,
  )
  if (first === undefined) return ''
  if (second === undefined) return first
  return rest.length === 0
    ? listed([first, second], 'or')
    : `${first}, ${second} or ${String(rest.length)} more`
}

// One cheaper card: what it adds in the held card's place and the fee saved.
export function replacementLine(
  catalog: Catalog,
  k: KeepOrReplace,
  r: Replacement,
): string {
  const others = alternativesText(catalog, r)
  const same = r.samePoints ? `, which earns ${pointsName(catalog, k)} too` : ''
  return `${nameOf(catalog, r.cardId)}${same}${others === '' ? '' : ` (or ${others}, the same)`}: about ${wholeDollars(r.net)} a year after its fee, ${replacementKept(k, r)}.`
}

const pointsName = (catalog: Catalog, k: KeepOrReplace) =>
  currencyName(
    catalog,
    catalog.cards.find((c) => c.id === k.cardId)?.currency ?? '',
  )

// "Earns Chase Ultimate Rewards too", beside a listed card on the same points.
export const samePointsTag = (catalog: Catalog, k: KeepOrReplace) =>
  `Earns ${pointsName(catalog, k)} too`

// The cheaper card on the same points, when it isn't among the best few:
// "The Chase Sapphire Preferred earns Chase Ultimate Rewards too: in its
// place, it would keep about $25 of the $35 …". Empty otherwise.
export function samePointsText(catalog: Catalog, k: KeepOrReplace): string {
  const r = k.samePoints
  if (r === null || k.replacements.some((x) => x.cardId === r.cardId)) return ''
  const net = wholeDollars(r.net)
  const lead = `The ${nameOf(catalog, r.cardId)} earns ${pointsName(catalog, k)} too: in its place, it would`
  if (whole(r.net) <= 0)
    return `${lead} ${belowFee('add', r.net, r.annualFee)}, which is ${money(r.feeSaved)} less than ${possessive(`the ${k.name}`)}.`
  const would =
    r.share === null
      ? `add about ${net} a year after its fee`
      : whole(r.net) >= whole(k.added)
        ? `add about ${net} a year after its fee, ${whole(r.net) === whole(k.added) ? 'about as much as' : 'more than'} the ${k.name} adds`
        : `keep about ${net} of the ${wholeDollars(k.added)} the ${k.name} adds a year after fees (${String(r.share)}%)`
  return `${lead} ${would}, with ${money(r.feeSaved)} less in fees.`
}

// The answer again with points at transfer value; empty without one.
export function transferText(catalog: Catalog, k: KeepOrReplace): string {
  if (k.transfer === null) return ''
  const t = k.transfer.result
  const held =
    whole(t.added) > 0
      ? `the ${t.name} adds about ${wholeDollars(t.added)} a year after its fee`
      : heldAdds(t)
  const [best] = t.replacements
  const rest =
    t.outcome === 'not-needed'
      ? ''
      : best === undefined
        ? ', and nothing with a lower fee would add anything in its place'
        : t.outcome === 'keeps'
          ? `, and the ${nameOf(catalog, best.cardId)} would keep about ${wholeDollars(best.net)} of it (${String(best.share)}%)`
          : `, and the ${nameOf(catalog, best.cardId)} would add ${whole(best.net) === whole(t.added) ? 'about as much' : 'more'} in its place: about ${wholeDollars(best.net)}`
  return `${transferIfText(pointsName(catalog, k), k.transfer.cents)}, ${held}${rest}.`
}

// "Chase Travel, flights and hotels earn more on the Chase Sapphire Reserve
// than the Travel line counts; add them as their own lines for a closer
// answer." `where` names the place to add them, like " in Find a card".
export function hiddenRatesText(k: KeepOrReplace, where = ''): string {
  const sentences = k.hidden
    .slice(0, HIDDEN_LINES)
    .map(({ line, parts, one, kind }) => {
      const more = parts.length - HIDDEN_NAMED
      const what =
        more > 0
          ? `${parts.slice(0, HIDDEN_NAMED).join(', ')} and ${String(more)} more${kind === null ? '' : ` ${kind}`}`
          : listed(parts)
      return `${capitalize(what)} ${one ? 'earns' : 'earn'} more on the ${k.name} than the ${line} line counts; add ${one ? 'it as its own line' : 'them as their own lines'}${where} for a closer answer.`
    })
  const rest = k.hidden.length - HIDDEN_LINES
  if (rest > 0)
    sentences.push(
      `The same goes for ${rest === 1 ? 'one other spending line' : `${String(rest)} other spending lines`}.`,
    )
  return sentences.join(' ')
}

// For a short row under the card's name: "Keeps 20%, $795 less in fees",
// "Adds more, $700 less in fees".
export function replacementShort(k: KeepOrReplace, r: Replacement): string {
  const kept =
    r.share === null
      ? ''
      : whole(r.net) > whole(k.added)
        ? 'Adds more, '
        : whole(r.net) === whole(k.added)
          ? 'Adds about as much, '
          : `Keeps ${String(r.share)}%, `
  return `${kept}${money(r.feeSaved)} less in fees`
}

// "20% of what the Sapphire Reserve adds, with $795 less in fees"
export function replacementKept(k: KeepOrReplace, r: Replacement): string {
  const kept =
    r.share === null
      ? ''
      : whole(r.net) > whole(k.added)
        ? `more than the ${k.name} adds, `
        : whole(r.net) === whole(k.added)
          ? `about as much as the ${k.name} adds, `
          : `${String(r.share)}% of what the ${k.name} adds, `
  return `${kept}with ${money(r.feeSaved)} less in fees`
}

// Apart from the figures: its credits if used, and its welcome offer.
export function replacementExtras(catalog: Catalog, r: Replacement): string[] {
  const lines: string[] = []
  if (r.credits !== null && r.credits.yearly > 0)
    lines.push(
      `${ifCreditsUsedText(r.credits, r.netIfCreditsUsed, 'adds')} ${creditsOnlyIf(r.credits)}`.trim(),
    )
  if (r.offer !== null) {
    const value =
      r.offer.value === null
        ? ''
        : `, about ${wholeDollars(r.offer.value)} at your point values`
    const ends =
      r.offer.validTo === null ? '' : ` It ends ${shortDate(r.offer.validTo)}.`
    const terms = r.offer.terms.replace(/^Up to /, 'up to ')
    lines.push(
      `Welcome offer, once and not in the figures: ${terms}${value}.${ends}${r.offer.ineligible === null ? '' : ` ${r.offer.ineligible}`}`,
    )
  }
  return lines
}

// What the figures assume.
export function keepOrReplaceAssumes(
  catalog: Catalog,
  k: KeepOrReplace,
  where = '',
): string[] {
  return [
    k.typical
      ? `Uses rough typical U.S. monthly spending; your own amounts${where} give a closer answer.`
      : 'Uses the monthly amounts you entered.',
    ...(k.points === null
      ? []
      : [
          `Counts ${currencyName(catalog, k.points.currency)} at ${num(k.points.cents)}¢ each (${k.points.saved ? 'your value' : "earnrate's default"}).`,
        ]),
    ...(k.replacements.length > 0
      ? [
          `Each cheaper card is counted at its regular annual fee, beside your other cards, taking the purchases where it earns the most. ${CREDITS_APART}`,
        ]
      : []),
    ...(k.replacements.some((r) => r.offer !== null)
      ? [OFFERS_MAY_DIFFER]
      : []),
  ]
}

// The whole answer as plain text, for answers outside the site.
export function keepOrReplaceText(catalog: Catalog, k: KeepOrReplace): string {
  return [
    keepOrReplaceVerdict(catalog, k),
    keepOrReplaceUnsaid(k),
    samePointsText(catalog, k),
    transferText(catalog, k),
    hiddenRatesText(k),
    ...(k.replacements.length > 1
      ? k.replacements.map((r) => replacementLine(catalog, k, r))
      : []),
    ...k.replacements.flatMap((r) =>
      replacementExtras(catalog, r).map(
        (line) => `${nameOf(catalog, r.cardId)}: ${line}`,
      ),
    ),
    ...k.members,
    keepOrReplaceMath(k),
    PERKS_NOT_COUNTED,
    ...keepOrReplaceAssumes(catalog, k),
  ]
    .filter((s) => s !== '')
    .join(' ')
}
