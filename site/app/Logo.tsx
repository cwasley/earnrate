// The stacked-cards mark from the top of earnrate.dev; picture.ts draws
// the same shapes. The chip is cut out in the color behind the mark.
export function Logo({ class: cls, chip }: { class?: string; chip: string }) {
  return (
    <svg
      class={cls}
      viewBox="0 0 120 80"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <rect x="22" y="6" width="92" height="58" rx="9" opacity="0.3" />
      <rect x="14" y="12" width="92" height="58" rx="9" opacity="0.55" />
      <rect
        x="6"
        y="18"
        width="92"
        height="58"
        rx="9"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="18"
        y="34"
        width="16"
        height="12"
        rx="2"
        fill={chip}
        stroke="none"
      />
    </svg>
  )
}
