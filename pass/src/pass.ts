// The Apple Wallet pass: a cheat sheet for the cards a person sent, good for
// the quarter it was made in. Pure: the Worker signs and zips what this
// returns. Rates come only from the engine, never from the request.
import { z } from 'zod'
import { cheatSheet } from '../../src/engine/cheat-sheet.ts'
import { currentPeriodEnd } from '../../src/engine/periods.ts'
import {
  activationNotOpen,
  checklistRows,
  type ChecklistRowItem,
} from '../../src/engine/checklist.ts'
import {
  longDate,
  pct,
  possessive,
  quarterName,
  shortDate,
} from '../../src/engine/text.ts'
import { cardText } from '../../src/format/card-text.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import {
  WalletCardSchema,
  WalletSchema,
  type Wallet,
} from '../../src/schema/wallet.ts'
import type { StripRow } from './strip.ts'

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

// Who asked for the pass: earnrate.dev's form or the iPhone app.
export type PassMaker = 'site' | 'app'

// The rows drawn on the strip; the back has them all.
const FRONT = [
  'Groceries',
  'Dining',
  'Gas',
  'Amazon',
  'Costco',
  'Everything else',
]

const REFRESH_URL = 'https://earnrate.dev/#wallet'
// What fits the strip's card column at full size (see strip.ts).
export const PASS_NAME_MAX = 24

// A pass is signed as earnrate's, so a label it shows must read as a card's
// name: short, with no web address, email or phone number in it.
export const plainLabel = (label: string) =>
  label.length <= PASS_NAME_MAX &&
  !/:\/\/|www\.|@|\.[a-z]{2,}\b|\d{5}/i.test(label)

type Field = {
  key: string
  label: string
  value: string
  textAlignment?: string
}

export type PassContents = {
  pass: Record<string, unknown> // pass.json
  strip: StripRow[] // drawn into strip.png
}

export function unknownCards(catalog: Catalog, input: PassWallet): string[] {
  const known = new Set(catalog.cards.map((c) => c.id))
  return input.cards.map((c) => c.id).filter((id) => !known.has(id))
}

export function passContents(
  catalog: Catalog,
  input: PassWallet,
  date: string,
  identity: PassIdentity,
  serialNumber: string,
  maker: PassMaker = 'site',
): PassContents {
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
  // The pass's own name for each card: its checkout label when that fits,
  // else the card's short name. Every one fits the strip at full size.
  const passName = (cardId: string) => {
    const label = labels.get(cardId)
    if (label !== undefined && plainLabel(label)) return label
    const card = catalog.cards.find((c) => c.id === cardId)
    return card?.short_name ?? text.shortName(cardId)
  }
  const key = (label: string) =>
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

  const strip: StripRow[] = FRONT.flatMap((label) => {
    const row = sheet.rows.find((r) => r.label === label)
    if (!row) return []
    return row.cardId === null || row.effectiveReturnPct === null
      ? [{ label, card: 'None of these', rate: '' }]
      : [
          {
            label,
            card: passName(row.cardId),
            rate: pct(row.effectiveReturnPct),
          },
        ]
  })

  // One line on the front; the back has every item in full.
  // The pass knows only picks and activations, so its to-dos are those (and
  // rotating categories not out yet); credits and caps need the wallet.
  // An activation that hasn't opened yet stays on, with the day it opens:
  // the pass lasts the quarter, so it's still there once activation opens.
  const todo = checklistRows(catalog, wallet, date).filter(
    (i) => i.kind === 'activate' || i.kind === 'pick' || i.kind === 'rotation',
  )
  const monthDay = (day: string) => shortDate(day).replace(/, \d{4}$/, '')
  const first = todo[0]
  const todoText = (item: ChecklistRowItem) => {
    const card = passName(item.cardId)
    const day = item.due === null ? null : monthDay(item.due)
    const by = day === null ? '' : ` by ${day}`
    switch (item.kind) {
      case 'activate':
        if (activationNotOpen(item, date)) {
          const quarter = /^Activate (Q[1-4] \d{4}) bonus/.exec(
            item.row.title,
          )?.[1]
          return `Activate ${possessive(card)}${quarter === undefined ? '' : ` ${quarter}`} bonus on or after ${day ?? ''}`
        }
        // Without the issuer's deadline, `due` is only when the quarter
        // starts or ends, so it isn't said as one.
        if (item.row.when === null) {
          const quarter =
            item.due === null
              ? null
              : quarterName(
                  item.due,
                  currentPeriodEnd('quarter', item.due, null) ?? item.due,
                )
          return `Activate ${possessive(card)}${quarter === null ? '' : ` ${quarter}`} bonus`
        }
        return `Activate ${card}${by}`
      case 'pick':
        return `Pick ${card} categories${by}`
      case 'rotation':
        return `${card}: next quarter not posted yet`
      default:
        return `${card}: see pass details`
    }
  }

  const end = currentPeriodEnd('quarter', date, null) ?? date
  const back: Field[] = [
    ...sheet.rows.map((row) => ({
      key: `all-${key(row.label)}`,
      label: row.label,
      value: [
        row.cardId === null || row.effectiveReturnPct === null
          ? 'None of these cards'
          : `${text.shortName(row.cardId)} ${pct(row.effectiveReturnPct)}`,
        row.note,
      ]
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
      value:
        maker === 'app'
          ? `This pass expires when ${sheet.quarter} ends. Open earnrate to make the next one from your cheat sheet.`
          : `This pass expires when ${sheet.quarter} ends. Get the next one from your wallet at ${REFRESH_URL}`,
    },
    {
      key: 'privacy',
      label: 'Privacy',
      value: `earnrate made this pass from the card names and picks ${maker === 'app' ? 'the app' : 'your browser'} sent, and kept nothing.`,
    },
  ]

  const pass = {
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
    storeCard: {
      headerFields: [
        { key: 'quarter', label: 'Cheat sheet', value: sheet.quarter },
      ],
      secondaryFields: first
        ? [
            {
              key: 'to-do-first',
              label:
                todo.length > 1 ? `To do · ${String(todo.length)}` : 'To do',
              value: todoText(first),
            },
          ]
        : [],
      auxiliaryFields: [
        { key: 'through', label: 'Good through', value: shortDate(end) },
        {
          key: 'more',
          label: 'Every category',
          value: 'In pass details',
          textAlignment: 'PKTextAlignmentRight',
        },
      ],
      backFields: back,
    },
  }
  return { pass, strip }
}
