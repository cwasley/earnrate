import { num } from '../../src/engine/text.ts'

// A bar from zero to value / max, on its list's one scale: the data end
// rounded, the baseline square. Its amount is always beside it in text, so
// screen readers skip it. Below zero there's no bar, only the amount.
export function Bar({
  value,
  max,
  quiet = false,
}: {
  value: number
  max: number
  quiet?: boolean
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <svg
      class={quiet ? 'rate-bar quiet' : 'rate-bar'}
      width="100%"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      {pct > 0 ? (
        <>
          <rect width={`${num(pct)}%`} height="12" rx="4" />
          <rect width={`${num(pct / 2)}%`} height="12" />
        </>
      ) : null}
    </svg>
  )
}
