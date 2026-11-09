import type { CardDetails } from '../engine/card-details.ts'
import { membershipName } from '../engine/memberships.ts'
import { foreignFeeText, money, NETWORK_NAMES } from '../engine/text.ts'
import type { CardInfo, SetupNote } from '../engine/setup.ts'
import type { Catalog } from '../schema/catalog.ts'

export function formatCardInfo(
  catalog: Catalog,
  card: CardInfo,
  details: CardDetails | null = null,
): string {
  const fee =
    card.annualFee === null
      ? ''
      : card.annualFee === 0
        ? ', no annual fee'
        : `, ${money(card.annualFee)} a year${card.firstYearFee === null ? '' : `, ${card.firstYearFee === 0 ? 'waived' : money(card.firstYearFee)} the first year`}`
  const needs = [
    ...(details && details.earning.length > 0
      ? [`earns: ${details.earning.join('; ')}`]
      : []),
    ...card.choices.map(
      (c) =>
        `${c.id}: pick ${String(c.pick)} of ${c.options.join(', ')}${c.default ? ` (default ${c.default.join(', ')})` : ''}`,
    ),
    ...(card.requiresMembership
      ? [
          `needs ${card.requiresMembership.name} (${money(card.requiresMembership.annualFee)} a year; membership id ${card.requiresMembership.id})`,
        ]
      : []),
    ...(card.memberships.length > 0
      ? [
          `rates that need a membership: ${card.memberships.map((id) => `${membershipName(catalog, id)} (membership id ${id})`).join(', ')}`,
        ]
      : []),
    ...(card.activation.length > 0
      ? [`activate with the issuer: ${card.activation.join(', ')}`]
      : []),
    ...(card.needsAnniversary ? ['cap resets on the card anniversary'] : []),
    ...card.milestones.map((m) => `spend bonus: ${m.text} (${m.id})`),
    ...card.introRates.map(
      (i) => `new accounts: ${i.text}; needs the opening date`,
    ),
    ...card.credits.map((c) => `statement credit ${c.id}: ${c.text}`),
    ...card.freeNights.map((n) => `free night ${n.id}: ${n.text}`),
    ...(card.onlyAt ? [`works only at ${card.onlyAt.join(', ')}`] : []),
    foreignFeeText(card.foreignTransactionFee).toLowerCase(),
    ...(details?.feeWorth
      ? [`is the fee worth it? ${details.feeWorth.text}`]
      : []),
  ]
  return [
    `${card.id}: ${card.name} (${NETWORK_NAMES[card.network] ?? card.network}${fee})${card.held ? ' [in wallet]' : ''}`,
    ...needs.map((n) => `    ${n}`),
  ].join('\n')
}

export function formatNotes(notes: SetupNote[]): string {
  return notes.length === 0
    ? 'Nothing else to set up for it.'
    : `Still to set:\n${notes.map((n) => `- ${n.text}`).join('\n')}`
}
