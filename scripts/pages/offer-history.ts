// A card page's "Offer history", under its public welcome offer: the
// engine's history of the card's public offers (src/engine/offer-history.ts).
import {
  OFFER_HISTORY_CAVEAT,
  offerHistoryText,
} from '../../src/engine/offer-history.ts'
import { inEffect } from '../../src/engine/periods.ts'
import { capitalize, dateRange } from '../../src/engine/text.ts'
import type { Card } from '../../src/schema/card.ts'
import type { PageContext } from './context.ts'
import { esc } from './site.ts'

export function offerHistorySection(ctx: PageContext, card: Card): string {
  const history = offerHistoryText(ctx.catalog, card, ctx.today)
  if (history === null) return ''
  const earlier =
    history.earlier.length === 0
      ? ''
      : `<p>Earlier public offers:</p><ul class="change-notes">${history.earlier
          .map(
            (e) =>
              `<li><time datetime="${e.from}">${esc(dateRange(e.from, e.to))}</time>: ${esc(capitalize(e.text))}</li>`,
          )
          .join('')}</ul>`
  // Under the offer's own heading, or in its place when there's none now.
  const offer = card.welcome_offer
  const heading =
    offer !== undefined && inEffect(offer, ctx.today)
      ? '<h3>Offer history</h3>'
      : '<h2>Welcome offer history</h2>'
  return `${heading}<p>${esc(history.lead)}</p>${earlier}<p class="muted">${esc(OFFER_HISTORY_CAVEAT)}</p>`
}
