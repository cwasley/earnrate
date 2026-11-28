// /bonus-rules: whether each card's sign-up bonus can be earned again, from
// the repeat rule its issuer publishes (`welcome_offer.repeat`), quoted. The
// rules and their words are the engine's (src/engine/bonus-rules.ts), which
// the iPhone app shows too.
import {
  BONUS_RULES_COLUMN,
  BONUS_RULES_HAD,
  BONUS_RULES_SHORT,
  BONUS_RULES_TITLE,
  BONUS_RULES_UNPUBLISHED,
  bonusRules,
  bonusRulesLead,
  type BonusRule,
} from '../../src/engine/bonus-rules.ts'
import type { GeneratedPage, PageContext } from './context.ts'
import { cardSearchText, filterBox, filterScript } from './filter.ts'
import { esc, fitDescription, fitTitle, SITE } from './site.ts'

export function bonusRulesPage(
  ctx: PageContext,
  lastmod: string,
): GeneratedPage {
  const { offered, stated, once, groups } = bonusRules(
    ctx.catalog,
    ctx.issuerName,
    ctx.shortName,
  )

  const row = ({ card, label, detail, quote }: BonusRule) =>
    `<tr data-anchor="${esc(card.id)}" data-q="${cardSearchText(ctx.catalog, card, ctx.shortName)}">
      <th scope="row"><a href="/cards/${esc(card.id)}">${esc(ctx.shortName(card.id))}</a></th>
      <td><b>${esc(label)}</b>. ${esc(detail)}${quote === null ? '' : `<br><span class="muted">"${esc(quote)}"</span>`}</td>
    </tr>`
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
      <h1>${esc(BONUS_RULES_TITLE)}</h1>
      <p class="updated">Updated ${esc(ctx.dayWords(lastmod))}</p>
      <p>${esc(bonusRulesLead(offered, stated, once))}</p>
      <p>${esc(BONUS_RULES_UNPUBLISHED)}</p>
      <p><a href="/#wallet&amp;had">${esc(BONUS_RULES_HAD.link)}</a>${esc(BONUS_RULES_HAD.rest)}</p>
      <p>The offers themselves, ranked by what each is worth: <a href="/welcome-offers">best welcome offers</a>.</p>
      ${filterBox('Find a card or bank', 'Sapphire, Amex Platinum, Southwest…')}
      <p id="no-match" hidden>No cards match.</p>
      <div data-filtered>${groups
        .map(
          ({ issuer, rules }) =>
            `<section class="issuer" data-section><h2>${esc(ctx.issuerName(issuer))}</h2>
        <div class="table-box"><table class="compare">
          <thead><tr><th scope="col">Card</th><th scope="col">${esc(BONUS_RULES_COLUMN)}</th></tr></thead>
          <tbody>${rules.map(row).join('')}</tbody>
        </table></div></section>`,
        )
        .join('')}</div>
      ${filterScript()}`
  return {
    file: 'bonus-rules.html',
    path,
    lastmod,
    html: ctx.layout({
      title,
      description,
      path,
      body,
      crumbs: [{ name: BONUS_RULES_SHORT, path }],
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
