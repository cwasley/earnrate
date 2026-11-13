// Facts on earnrate.dev's home page, rendered at build time from the card
// data, so no count, rate or quote on the page is typed by hand.
import { cheatSheet } from '../src/engine/cheat-sheet.ts'
import { ALL_PERSONAL_CARDS } from '../src/engine/explore.ts'
import { recommend } from '../src/engine/recommend.ts'
import {
  simulateCatalog,
  type Simulation,
  typicalSpendLines,
} from '../src/engine/simulate.ts'
import { creditLabel, creditName } from '../src/engine/rule-text.ts'
import {
  creditBack,
  enrollCreditText,
  listed,
  pct,
  possessive,
  wholeDollars,
} from '../src/engine/text.ts'
import { cardText } from '../src/format/card-text.ts'
import { siteFooter } from './pages/site.ts'
import type { Card } from '../src/schema/card.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import type { Wallet } from '../src/schema/wallet.ts'
import { comparePairs, compareSlug } from './compare.ts'

const esc = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`)

export type LandingFacts = {
  cards: number
  stores: number
  issuers: { name: string; count: number }[]
  cheat: { label: string; card: string; pct: string }[]
  // The best two cards and best one card at typical spending, net of fees.
  pair: { cards: string; net: string }
  single: { cards: string; net: string }
  receipt: {
    store: string
    card: string
    pct: string
    next: string | null
    quote: string
    source: string
    url: string
  }
  credits: {
    names: string // "Dunkin', Uber"
    viz: { name: string; back: string; todo: string }
  }
  decide: {
    fee: { href: string; label: string }
    compare: { href: string; label: string }
  }
}

// The cards the home page uses as examples. Their facts come from the data;
// the build fails if one of them stops saying what the page needs.
const EXAMPLES = {
  credits: [
    { card: 'amex-gold', credit: 'dunkin' },
    { card: 'amex-gold', credit: 'uber-cash' },
  ],
  creditViz: { card: 'amex-platinum', credit: 'lululemon' },
  fee: 'amex-gold',
  compare: ['amex-gold', 'chase-sapphire-preferred'],
} as const

function cardById(catalog: Catalog, id: string): Card {
  const card = catalog.cards.find((c) => c.id === id)
  if (!card) throw new Error(`landing: no card ${id}`)
  return card
}

function creditOf(catalog: Catalog, cardId: string, creditId: string) {
  const credit = cardById(catalog, cardId).credits.find(
    (c) => c.id === creditId,
  )
  if (!credit) throw new Error(`landing: no ${creditId} credit on ${cardId}`)
  return credit
}

export function landingFacts(
  catalog: Catalog,
  sample: Wallet,
  today: string,
): LandingFacts {
  const name = cardText(catalog).shortName
  const counts = new Map<string, number>()
  for (const card of catalog.cards)
    counts.set(card.issuer, (counts.get(card.issuer) ?? 0) + 1)
  const issuers = [...counts]
    .map(([id, count]) => ({
      name: catalog.issuers.find((i) => i.id === id)?.name ?? id,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const merchants = [...catalog.merchants.seed, ...catalog.merchants.overrides]
  const stores = new Set(
    merchants
      .filter((m) => m.kind !== 'booking' && m.kind !== 'portal')
      .map((m) => m.id),
  ).size

  const sheet = cheatSheet(catalog, sample, today)
  const cheat = sheet.rows
    .filter((r) => r.cardId !== null && r.effectiveReturnPct !== null)
    .slice(0, 4)
    .map((r) => ({
      label: r.label,
      card: name(r.cardId ?? ''),
      pct: pct(r.effectiveReturnPct ?? 0),
    }))

  const sim = simulateCatalog(catalog, typicalSpendLines(catalog), {
    filters: ALL_PERSONAL_CARDS,
    memberships: [],
    valuations: {},
    start: today,
  })
  const [pair] = sim.pairs
  const [single] = sim.singles
  if (!pair || !single) throw new Error('landing: no simulated wallet')
  const wallet = (s: Simulation) => ({
    cards: s.cards.map((c) => name(c.cardId)).join(' + '),
    net: wholeDollars(s.net),
  })

  const store = 'Whole Foods'
  const rec = recommend(catalog, sample, {
    merchant: store,
    amount: null,
    channel: 'in_store',
    date: today,
    country: 'US',
  })
  const top = rec.ranked[0]
  const card = top ? catalog.cards.find((c) => c.id === top.cardId) : undefined
  const evidence = card?.evidence.filter((e) => e.rule === top?.matchedRule)
  const quote = evidence?.find((e) => /\d%|\dx/i.test(e.quote)) ?? evidence?.[0]
  if (!top || !card || !quote)
    throw new Error(`landing: no quoted answer for ${store}`)
  const second = rec.ranked[1]

  const shown = creditOf(
    catalog,
    EXAMPLES.creditViz.card,
    EXAMPLES.creditViz.credit,
  )
  if (shown.enroll !== true)
    throw new Error('landing: the credit shown needs no enrolling')
  const shownName = creditName(catalog, shown)

  const feeCard = cardById(catalog, EXAMPLES.fee)
  if (!feeCard.annual_fee) throw new Error(`landing: ${feeCard.id} has no fee`)
  const [x, y] = [...EXAMPLES.compare].sort()
  const slug = compareSlug(x ?? '', y ?? '')
  if (!comparePairs(catalog, today).some((p) => p.slug === slug))
    throw new Error(`landing: no comparison page ${slug}`)

  return {
    cards: catalog.cards.length,
    stores,
    issuers,
    cheat,
    pair: wallet(pair),
    single: wallet(single),
    receipt: {
      store,
      card: name(card.id),
      pct: pct(top.effectiveReturnPct),
      next: second
        ? `${name(second.cardId)} is next at ${pct(second.effectiveReturnPct)}.`
        : null,
      quote: quote.quote,
      source: catalog.issuers.find((i) => i.id === card.issuer)?.name ?? '',
      url: quote.url,
    },
    credits: {
      names: EXAMPLES.credits
        .map((c) => creditLabel(catalog, creditOf(catalog, c.card, c.credit)))
        .join(', '),
      viz: {
        name: `${shownName} credit`,
        back: creditBack(shown),
        todo: enrollCreditText(name(EXAMPLES.creditViz.card), [shownName]),
      },
    },
    decide: {
      fee: {
        href: `/cards/${feeCard.id}#annual-fee`,
        label: `Is ${possessive(name(feeCard.id))} annual fee worth it?`,
      },
      compare: {
        href: `/compare/${slug}`,
        label: EXAMPLES.compare.map(name).join(' vs. '),
      },
    },
  }
}

function issuerLine(issuers: LandingFacts['issuers']): string {
  const named = issuers.slice(0, 4).map((i) => i.name)
  const more = issuers.length - named.length
  return more > 0
    ? `${named.join(', ')} and ${String(more)} more`
    : listed(named)
}

// Each placeholder is an HTML comment in site/index.html.
// `extra` fills placeholders only one page has (the companies page's), and
// `data_version` puts the card data's version in the home page's footer.
export function renderLanding(
  html: string,
  f: LandingFacts,
  extra: Record<string, string> = {},
): string {
  const parts: Record<string, string> = {
    ...extra,
    cards: String(f.cards),
    stores: String(f.stores),
    issuer_count: String(f.issuers.length),
    issuer_line: esc(issuerLine(f.issuers)),
    cheat: f.cheat
      .map(
        (r) =>
          `<tr><td>${esc(r.label)}</td><td>${esc(r.card)}</td><td>${esc(r.pct)}</td></tr>`,
      )
      .join(''),
    pair_cards: esc(f.pair.cards),
    pair_net: esc(f.pair.net),
    single_cards: esc(f.single.cards),
    single_net: esc(f.single.net),
    receipt_store: esc(f.receipt.store),
    receipt_card: esc(f.receipt.card),
    receipt_pct: esc(f.receipt.pct),
    receipt_next: esc(f.receipt.next ?? ''),
    receipt_quote: esc(f.receipt.quote),
    receipt_source: esc(possessive(f.receipt.source)),
    receipt_url: esc(f.receipt.url),
    credit_names: esc(f.credits.names),
    credit_viz_name: esc(f.credits.viz.name),
    credit_viz_back: esc(f.credits.viz.back),
    credit_viz_todo: esc(f.credits.viz.todo),
    decide_fee_href: esc(f.decide.fee.href),
    decide_fee: esc(f.decide.fee.label),
    decide_compare_href: esc(f.decide.compare.href),
    decide_compare: esc(f.decide.compare.label),
    footer: siteFooter(),
    home_footer: siteFooter(
      extra.data_version
        ? `<p class="footer-intro">Card data ${esc(extra.data_version)}, from each issuer's own terms.</p>`
        : '',
    ),
  }
  return html.replace(/<!--earnrate:(\w+)-->/g, (whole, key: string) => {
    const value = parts[key]
    if (value === undefined) throw new Error(`landing: unknown ${whole}`)
    return value
  })
}
