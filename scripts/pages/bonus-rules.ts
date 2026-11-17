// /bonus-rules: whether each card's sign-up bonus can be earned again, from
// the repeat rule its issuer publishes (`welcome_offer.repeat`), quoted.
import { repeatRuleParts } from '../../src/engine/repeat-bonus.ts'
import type { Card } from '../../src/schema/card.ts'
import type { GeneratedPage, PageContext } from './context.ts'
import { esc, fitDescription, fitTitle, SITE } from './site.ts'

// Shortest wait first; once per card last, then cards with no stated rule.
function waitOrder(card: Card): number {
  const r = card.welcome_offer?.repeat
  if (!r) return Infinity
  return r.after_months ?? 1000
}

export function bonusRulesPage(
  ctx: PageContext,
  lastmod: string,
): GeneratedPage {
  const offered = ctx.catalog.cards.filter(
    (c) => c.welcome_offer !== undefined && c.applications_closed === undefined,
  )
  const byIssuer = new Map<string, Card[]>()
  for (const card of offered)
    byIssuer.set(card.issuer, [...(byIssuer.get(card.issuer) ?? []), card])
  const issuers = [...byIssuer.keys()].sort((a, b) =>
    ctx.issuerName(a).localeCompare(ctx.issuerName(b)),
  )
  const once = offered.filter(
    (c) =>
      c.welcome_offer?.repeat &&
      c.welcome_offer.repeat.after_months === undefined,
  ).length
  const stated = offered.filter((c) => c.welcome_offer?.repeat).length

  const row = (card: Card) => {
    const quote = card.evidence.find((e) => e.rule === 'repeat')
    const { label, detail } = repeatRuleParts(ctx.catalog, card)
    return `<tr data-anchor="${esc(card.id)}">
      <th scope="row"><a href="/cards/${esc(card.id)}">${esc(ctx.shortName(card.id))}</a></th>
      <td><b>${esc(label ?? 'Not stated')}</b>. ${esc(detail)}${quote ? `<br><span class="muted">"${esc(quote.quote)}"</span>` : ''}</td>
    </tr>`
  }
  const title = fitTitle([
    "Can you get a credit card's sign-up bonus again?",
    'Can you get a sign-up bonus again?',
  ])
  const description = fitDescription([
    `Each card's rule for earning its welcome bonus a second time, quoted from the issuer: once per card, or not within 24, 48 or more months.`,
    `Each card's rule for earning its welcome bonus again, from the issuer's terms.`,
  ])
  const path = '/bonus-rules'
  const body = `
      <h1>Can you get a card's sign-up bonus again?</h1>
      <p class="updated">Updated ${esc(ctx.dayWords(lastmod))}</p>
      <p>Each issuer's terms say who can earn a card's welcome bonus. Of the ${String(offered.length)} cards here with a public offer, ${String(stated)} have a stated rule, and ${String(once)} of those pay it once per card. Each rule below is quoted from the issuer's own page.</p>
      <p>Issuers can also turn down a bonus for reasons they don't spell out, like how many cards you've opened lately. Rules they don't publish aren't here.</p>
      <p><a href="/#wallet">Add cards you've had</a> under My wallet, and next-card answers say when you can earn each bonus again.</p>
      ${issuers
        .map((id) => {
          const list = (byIssuer.get(id) ?? []).toSorted(
            (a, b) =>
              waitOrder(a) - waitOrder(b) ||
              ctx.shortName(a.id).localeCompare(ctx.shortName(b.id)),
          )
          return `<section class="issuer"><h2>${esc(ctx.issuerName(id))}</h2>
        <div class="table-box"><table class="compare">
          <thead><tr><th scope="col">Card</th><th scope="col">Can you get it again?</th></tr></thead>
          <tbody>${list.map(row).join('')}</tbody>
        </table></div></section>`
        })
        .join('')}`
  return {
    file: 'bonus-rules.html',
    path,
    lastmod,
    html: ctx.layout({
      title,
      description,
      path,
      body,
      crumbs: [{ name: 'Bonus rules', path }],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
        url: `${SITE}${path}`,
        dateModified: lastmod,
      },
    }),
  }
}
