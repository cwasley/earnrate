import { offerTerms, type OfferComparison } from '../engine/offers.ts'
import { feeText, money, shortDate, wholeDollars } from '../engine/text.ts'

const TOP = 10

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
      o.spend > 0 ? ` (about ${wholeDollars(o.spend / weeks)} a week)` : ''
    lines.push(
      `${String(i + 1).padStart(2)}. ${o.cardName.padEnd(width)}  about ${wholeDollars(o.firstYearValue)} the first year`,
      `    ${offerTerms(o, currencyName(o.currency))}${pace}. ${feeText(o)[0]?.toUpperCase() ?? ''}${feeText(o).slice(1)}.${o.membershipFee > 0 ? ` Needs a ${money(o.membershipFee)} membership, counted in the first year.` : ''}${o.held ? ' In your wallet.' : ''}`,
    )
    lines.push(
      `    ${o.validTo ? `Offer ends ${shortDate(o.validTo)}. ` : ''}Public offer as of ${shortDate(o.lastVerified)}; yours may differ.`,
    )
    if (o.ineligible) lines.push(`    ${o.ineligible}`)
    if (o.note) lines.push(`    ${o.note}`)
  })
  const ruledOut = c.offers.filter(
    (o) => o.ineligible !== null && !shown.includes(o),
  )
  if (ruledOut.length > 0)
    lines.push(
      `  ${String(ruledOut.length)} more left out as likely not eligible with a card you hold: ${ruledOut.map((o) => o.cardName).join(', ')}.`,
    )
  if (c.offers.length > shown.length + ruledOut.length)
    lines.push(
      `  + ${String(c.offers.length - shown.length - ruledOut.length)} more (--all lists them)`,
    )
  if (c.withoutOffer.length > 0)
    lines.push(
      '',
      `${String(c.withoutOffer.length)} matching card(s) have no published offer on file.`,
    )
  lines.push('', ...c.notes)
  return `${lines.join('\n')}\n`
}
