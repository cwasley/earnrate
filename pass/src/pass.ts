// The Apple Wallet pass: a cheat sheet for the cards a person sent, good for
// the quarter it was made in. Pure: the Worker signs and zips what this
// returns. Rates come only from the engine, never from the request.
import { z } from 'zod'
import { cheatSheet, type CheatSheetRow } from '../../src/engine/cheat-sheet.ts'
import { currentPeriodEnd } from '../../src/engine/periods.ts'
import { longDate, pct } from '../../src/engine/text.ts'
import { cardText } from '../../src/format/card-text.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import {
  WalletCardSchema,
  WalletSchema,
  type Wallet,
} from '../../src/schema/wallet.ts'

// Only what the cheat sheet needs: no spending, caps, bonuses or anniversaries.
export const PassWalletSchema = z.strictObject({
  memberships: WalletSchema.shape.memberships,
  cards: z
    .array(
      WalletCardSchema.pick({
        id: true,
        checkout_label: true,
        chosen: true,
        activated: true,
      }),
    )
    .min(1)
    .max(30),
})
export type PassWallet = z.input<typeof PassWalletSchema>

export type PassIdentity = {
  passTypeIdentifier: string
  teamIdentifier: string
}

// The rows on the pass's face, with shorter labels where a field is narrow;
// the back has them all.
const FRONT: [string, string][] = [
  ['Groceries', 'Groceries'],
  ['Dining', 'Dining'],
  ['Gas', 'Gas'],
  ['Amazon', 'Amazon'],
  ['Costco', 'Costco'],
  ['Everything else', 'Other'],
]

const REFRESH_URL = 'https://earnrate.dev/#wallet'

type Field = { key: string; label: string; value: string }

export function unknownCards(catalog: Catalog, input: PassWallet): string[] {
  const known = new Set(catalog.cards.map((c) => c.id))
  return input.cards.map((c) => c.id).filter((id) => !known.has(id))
}

export function passJson(
  catalog: Catalog,
  input: PassWallet,
  date: string,
  identity: PassIdentity,
  serialNumber: string,
): Record<string, unknown> {
  const parsed = PassWalletSchema.parse(input)
  const wallet: Wallet = WalletSchema.parse({
    memberships: parsed.memberships,
    cards: parsed.cards,
  })
  const sheet = cheatSheet(catalog, wallet, date)
  const text = cardText(catalog)
  const labels = new Map(
    parsed.cards.flatMap((c) =>
      c.checkout_label ? [[c.id, c.checkout_label] as const] : [],
    ),
  )
  const issuerPrefixes = ['Amex ', ...catalog.issuers.map((i) => `${i.name} `)]
  // Short enough for a pass field: the checkout label, or the card's name
  // without its issuer ("Sapphire Preferred").
  const compact = (cardId: string) => {
    const label = labels.get(cardId)
    if (label) return label
    const name = text.shortName(cardId)
    const prefix = issuerPrefixes.find(
      (p) => name.startsWith(p) && name.length > p.length,
    )
    return prefix ? name.slice(prefix.length) : name
  }
  const value = (row: CheatSheetRow, name: (id: string) => string) =>
    row.cardId === null || row.effectiveReturnPct === null
      ? 'None of these cards'
      : `${name(row.cardId)} ${pct(row.effectiveReturnPct)}`
  const key = (label: string) =>
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

  // Three to a row, so a long card name gets cut short: the rate goes in
  // the label, where it always fits.
  const front: Field[] = FRONT.flatMap(([rowLabel, label]) => {
    const row = sheet.rows.find((r) => r.label === rowLabel)
    if (!row) return []
    return row.cardId === null || row.effectiveReturnPct === null
      ? [{ key: key(label), label, value: 'None of these' }]
      : [
          {
            key: key(label),
            label: `${label} · ${pct(row.effectiveReturnPct)}`,
            value: compact(row.cardId),
          },
        ]
  })
  const back: Field[] = [
    ...sheet.rows.map((row) => ({
      key: `all-${key(row.label)}`,
      label: row.label,
      value: [value(row, text.shortName), row.note]
        .filter((t) => t !== null && t !== '')
        .join('\n'),
    })),
    ...(sheet.notes.length > 0
      ? [{ key: 'to-do', label: 'To do', value: sheet.notes.join('\n') }]
      : []),
    {
      key: 'updated',
      label: 'Made',
      value: `${longDate(date)}, for ${sheet.quarter}. Rates come from each issuer's terms; check them before a large purchase.`,
    },
    {
      key: 'refresh',
      label: 'New quarter',
      value: `This pass expires when ${sheet.quarter} ends. Get the next one from your wallet at ${REFRESH_URL}`,
    },
    {
      key: 'privacy',
      label: 'Privacy',
      value:
        'earnrate made this pass from the card names and picks your browser sent, and kept nothing.',
    },
  ]

  const end = currentPeriodEnd('quarter', date, null) ?? date
  return {
    formatVersion: 1,
    passTypeIdentifier: identity.passTypeIdentifier,
    teamIdentifier: identity.teamIdentifier,
    serialNumber,
    organizationName: 'earnrate',
    description: `earnrate cheat sheet for ${sheet.quarter}`,
    logoText: 'earnrate',
    backgroundColor: 'rgb(28, 26, 24)',
    foregroundColor: 'rgb(245, 241, 236)',
    labelColor: 'rgb(232, 168, 119)',
    // The end of the quarter's last day anywhere in the U.S.
    expirationDate: `${end}T23:59:59-10:00`,
    sharingProhibited: true,
    generic: {
      headerFields: [
        { key: 'quarter', label: 'Cheat sheet', value: sheet.quarter },
      ],
      secondaryFields: front.slice(0, 3),
      auxiliaryFields: front.slice(3, 6),
      backFields: back,
    },
  }
}
