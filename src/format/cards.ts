import { foreignFeeText, money, NETWORK_NAMES } from '../engine/text.ts'
import type { CardInfo, SetupNote } from '../engine/setup.ts'

export function formatCardInfo(card: CardInfo): string {
  const fee =
    card.annualFee === null
      ? ''
      : card.annualFee === 0
        ? ', no annual fee'
        : `, ${money(card.annualFee)} a year`
  const needs = [
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
      ? [`rates that need a membership: ${card.memberships.join(', ')}`]
      : []),
    ...(card.activation.length > 0
      ? [`activate with the issuer: ${card.activation.join(', ')}`]
      : []),
    ...(card.needsAnniversary ? ['cap resets on the card anniversary'] : []),
    ...card.milestones.map((m) => `spend bonus: ${m.text} (${m.id})`),
    ...card.introRates.map(
      (i) => `new accounts: ${i.text}; needs the opening date`,
    ),
    ...(card.onlyAt ? [`works only at ${card.onlyAt.join(', ')}`] : []),
    foreignFeeText(card.foreignTransactionFee).toLowerCase(),
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
