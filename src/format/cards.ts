import type { CardInfo, SetupNote } from '../engine/setup.ts'

const NETWORKS: Record<CardInfo['network'], string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
  store: 'store card',
}

export function formatCardInfo(card: CardInfo): string {
  const fee =
    card.annualFee === null
      ? ''
      : card.annualFee === 0
        ? ', no annual fee'
        : `, $${String(card.annualFee)} a year`
  const needs = [
    ...card.choices.map(
      (c) =>
        `${c.id}: pick ${String(c.pick)} of ${c.options.join(', ')}${c.default ? ` (default ${c.default.join(', ')})` : ''}`,
    ),
    ...(card.memberships.length > 0
      ? [`rates that need a membership: ${card.memberships.join(', ')}`]
      : []),
    ...(card.activation.length > 0
      ? [`activate with the issuer: ${card.activation.join(', ')}`]
      : []),
    ...(card.needsAnniversary ? ['cap resets on the card anniversary'] : []),
    ...(card.onlyAt ? [`works only at ${card.onlyAt.join(', ')}`] : []),
  ]
  return [
    `${card.id}: ${card.name} (${NETWORKS[card.network]}${fee})${card.held ? ' [in wallet]' : ''}`,
    ...needs.map((n) => `    ${n}`),
  ].join('\n')
}

export function formatNotes(notes: SetupNote[]): string {
  return notes.length === 0
    ? 'Nothing else to set up for it.'
    : `Still to set:\n${notes.map((n) => `- ${n.text}`).join('\n')}`
}
