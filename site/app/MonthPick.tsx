import { useState } from 'preact/hooks'
import { draftShown, type Draft } from './draft.ts'
import {
  futureMonth,
  MONTH_NAMES,
  monthOf,
  partsOf,
  yearsFor,
  type MonthParts,
} from './month-pick.ts'

// A month as two menus. `onChange` gets YYYY-MM once both are picked, and
// '' when one is set back to blank; a half-picked month saves nothing.
export function MonthPick({
  label,
  value,
  today,
  disabled = false,
  onChange,
}: {
  label: string
  value: string // YYYY-MM, or '' for none
  today: string
  disabled?: boolean
  onChange: (month: string) => void
}) {
  const [draft, setDraft] = useState<Draft<MonthParts>>(null)
  const { month, year } = draftShown(draft, partsOf(value), value)
  // The draft stands over the value it saves, so a half-picked month stays
  // shown once the month it replaced is cleared.
  const set = (next: MonthParts) => {
    const picked = monthOf(next, today)
    setDraft({ value: next, over: picked })
    if (picked !== value) onChange(picked)
  }
  return (
    <span class="month-pick" role="group" aria-label={label}>
      <select
        aria-label="Month"
        value={String(month)}
        disabled={disabled}
        onChange={(e) => set({ month: Number(e.currentTarget.value), year })}
      >
        <option value="0">Month</option>
        {MONTH_NAMES.map((name, i) => (
          <option
            key={name}
            value={String(i + 1)}
            disabled={futureMonth(i + 1, year, today)}
          >
            {name}
          </option>
        ))}
      </select>
      <select
        aria-label="Year"
        value={String(year)}
        disabled={disabled}
        onChange={(e) => set({ month, year: Number(e.currentTarget.value) })}
      >
        <option value="0">Year</option>
        {yearsFor(value, today).map((y) => (
          <option
            key={y}
            value={String(y)}
            disabled={futureMonth(month, y, today)}
          >
            {y}
          </option>
        ))}
      </select>
    </span>
  )
}
