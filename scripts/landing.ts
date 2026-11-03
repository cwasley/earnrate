// Facts on earnrate.dev's home page, rendered at build time from the card
// data, so no count, rate or quote on the page is typed by hand.
import { cheatSheet } from '../src/engine/cheat-sheet.ts'
import { recommend } from '../src/engine/recommend.ts'
import { cardText } from '../src/format/card-text.ts'
import type { Catalog } from '../src/schema/catalog.ts'
import type { Wallet } from '../src/schema/wallet.ts'

const esc = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`)

const pct = (n: number) => `${String(Math.round(n * 10) / 10)}%`

export type LandingFacts = {
  cards: number
  stores: number
  issuers: { name: string; count: number }[]
  cheat: { label: string; card: string; pct: string }[]
  receipt: {
    store: string
    card: string
    pct: string
    next: string | null
    quote: string
    source: string
    url: string
  }
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
  return {
    cards: catalog.cards.length,
    stores,
    issuers,
    cheat,
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
  }
}

// Each placeholder is an HTML comment in site/index.html.
export function renderLanding(html: string, f: LandingFacts): string {
  const parts: Record<string, string> = {
    cards: String(f.cards),
    stores: String(f.stores),
    issuer_count: String(f.issuers.length),
    issuers: f.issuers
      .map(
        (i) => `<li><span>${esc(i.name)}</span><b>${String(i.count)}</b></li>`,
      )
      .join(''),
    cheat: f.cheat
      .map(
        (r) =>
          `<tr><td>${esc(r.label)}</td><td>${esc(r.card)}</td><td>${esc(r.pct)}</td></tr>`,
      )
      .join(''),
    receipt_store: esc(f.receipt.store),
    receipt_card: esc(f.receipt.card),
    receipt_pct: esc(f.receipt.pct),
    receipt_next: esc(f.receipt.next ?? ''),
    receipt_quote: esc(f.receipt.quote),
    receipt_source: esc(f.receipt.source),
    receipt_url: esc(f.receipt.url),
  }
  return html.replace(/<!--earnrate:(\w+)-->/g, (whole, key: string) => {
    const value = parts[key]
    if (value === undefined) throw new Error(`landing: unknown ${whole}`)
    return value
  })
}
