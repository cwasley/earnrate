import type { OfferComparison, OfferSummary } from '../engine/offers.ts'
import { feeText, money, shortDate } from '../engine/text.ts'

const TOP = 10

function reward(o: OfferSummary, currencyName: string): string {
  const amount =
    o.dollars !== null
      ? money(o.dollars)
      : `${(o.points ?? 0).toLocaleString('en-US')} ${currencyName}`
  return o.varies ? `Up to ${amount}` : amount
}

export function formatOffers(
  c: OfferComparison,
  currencyName: (id: string) => string,
  all: boolean,
): string {
  if (c.offers.length === 0) {
    return `No published welcome offers match.${c.withoutOffer.length > 0 ? ` ${String(c.withoutOffer.length)} matching card(s) have none on file.` : ''}\n`
  }
  const shown = all ? c.offers : c.offers.slice(0, TOP)
  const width = Math.max(...shown.map((o) => o.cardName.length))
  const lines: string[] = []
  shown.forEach((o, i) => {
    const weeks = (o.months * 52) / 12
    const pace =
      o.spend > 0 ? ` (about ${money(Math.round(o.spend / weeks))} a week)` : ''
    const spend =
      o.spend > 0
        ? `after ${money(o.spend)} in ${String(o.months)} month${o.months === 1 ? '' : 's'}${pace}`
        : 'with no spending required'
    lines.push(
      `${String(i + 1).padStart(2)}. ${o.cardName.padEnd(width)}  about ${money(Math.round(o.firstYearValue))} the first year`,
      `    ${reward(o, currencyName(o.currency))} ${spend}. ${feeText(o)[0]?.toUpperCase() ?? ''}${feeText(o).slice(1)}.${o.membershipFee > 0 ? ` Needs a ${money(o.membershipFee)} membership, counted in the first year.` : ''}${o.held ? ' In your wallet.' : ''}`,
    )
    lines.push(
      `    ${o.validTo ? `Offer ends ${o.validTo}. ` : ''}Public offer as of ${shortDate(o.lastVerified)}; yours may differ.`,
    )
    if (o.note) lines.push(`    ${o.note}`)
  })
  if (c.offers.length > shown.length)
    lines.push(
      `  + ${String(c.offers.length - shown.length)} more (--all lists them)`,
    )
  if (c.withoutOffer.length > 0)
    lines.push(
      '',
      `${String(c.withoutOffer.length)} matching card(s) have no published offer on file.`,
    )
  lines.push('', ...c.notes)
  return `${lines.join('\n')}\n`
}
