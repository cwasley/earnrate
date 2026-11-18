import { catalog } from 'virtual:catalog'
import { localToday } from '../../src/engine/periods.ts'
import {
  repeatMonthFields,
  type MonthAsk,
} from '../../src/engine/repeat-bonus.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { shortName } from './format.ts'
import { MonthPick } from './MonthPick.tsx'
import { monthAskOp, type LocalOp } from './sync.ts'

export const MONTH_LABELS: Record<MonthAsk['field'], string> = {
  bonus_received: 'Bonus posted',
  opened: 'Opened',
  closed: 'Closed',
}

const FIELDS = new Map(
  catalog.cards.map((c) => [c.id, repeatMonthFields(catalog, c.id)]),
)

export const monthFieldsFor = (cardId: string): MonthAsk['field'][] =>
  FIELDS.get(cardId) ?? []

// A small, optional month field beside a note that asks for it.
export function MonthAskField({
  wallet,
  ask,
  onChange,
}: {
  wallet: Wallet
  ask: MonthAsk
  onChange: (op: LocalOp) => unknown
}) {
  const label = `${shortName(ask.cardId)}: ${MONTH_LABELS[ask.field].toLowerCase()}`
  return (
    <span class="month-ask">
      {label}{' '}
      <MonthPick
        label={label}
        value=""
        today={localToday()}
        onChange={(month) => {
          const op = month === '' ? null : monthAskOp(wallet, ask, month)
          if (op) void onChange(op)
        }}
      />
    </span>
  )
}
