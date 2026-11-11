import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import { num } from '../../src/engine/text.ts'

// A bar from zero to value / max of its chart's one scale, the data end
// rounded and the baseline square. An SVG with its length as an attribute:
// the page's policy allows no style attribute. Always beside its amount in
// text, so it's hidden from screen readers.
export function Bar({
  value,
  max,
  tone = 'accent',
}: {
  value: number
  max: number
  tone?: 'accent' | 'quiet'
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <svg
      class={`bar bar-${tone}`}
      width="100%"
      height="10"
      aria-hidden="true"
      focusable="false"
    >
      {pct > 0 ? (
        <>
          <rect width={`${num(pct)}%`} height="10" rx="4" />
          <rect width={`${num(pct / 2)}%`} height="10" />
        </>
      ) : null}
    </svg>
  )
}

// Rows past the first few wait behind a button, so a long table doesn't
// push the rest of the answer out of sight.
export function useMore<T>(rows: T[], first: number) {
  const [all, setAll] = useState(false)
  const shown = all || rows.length <= first ? rows : rows.slice(0, first)
  const more =
    rows.length > first ? (
      <button type="button" class="link more" onClick={() => setAll(!all)}>
        {all ? 'Show fewer' : `Show all ${String(rows.length)}`}
      </button>
    ) : null
  return { shown, more }
}

export type Column<T> = {
  head: string
  cell: (row: T) => ComponentChildren
  num?: boolean
}

// A table that, on a phone, becomes one block per row: the first column as
// its title and each other cell under it with its column's name.
export function DataTable<T>({
  label,
  columns,
  rows,
  keyOf,
  first = 5,
}: {
  label: string
  columns: Column<T>[]
  rows: T[]
  keyOf: (row: T) => string
  first?: number
}) {
  const { shown, more } = useMore(rows, first)
  return (
    <>
      <table class="data" role="table" aria-label={label}>
        <thead>
          <tr role="row">
            {columns.map((c) => (
              <th
                scope="col"
                role="columnheader"
                key={c.head}
                class={c.num ? 'num' : undefined}
              >
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr role="row" key={keyOf(row)}>
              {columns.map((c, i) =>
                i === 0 ? (
                  <th scope="row" role="rowheader" key={c.head}>
                    {c.cell(row)}
                  </th>
                ) : (
                  <td
                    role="cell"
                    key={c.head}
                    data-label={c.head}
                    class={c.num ? 'num' : undefined}
                  >
                    {c.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </>
  )
}
