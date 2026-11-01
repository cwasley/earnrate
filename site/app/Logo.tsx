// The stacked-cards mark from the top of earnrate.dev. sheet-image.ts draws
// the same shapes.
export function Logo({ class: cls }: { class?: string }) {
  return (
    <svg
      class={cls}
      viewBox="0 0 120 80"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
    >
      <rect x="22" y="6" width="92" height="58" rx="9" opacity="0.25" />
      <rect x="14" y="12" width="92" height="58" rx="9" opacity="0.45" />
      <rect
        x="6"
        y="18"
        width="92"
        height="58"
        rx="9"
        stroke-width="2"
        stroke-dasharray="6 5"
      />
      <rect x="18" y="34" width="16" height="12" rx="2" stroke-width="2" />
    </svg>
  )
}
