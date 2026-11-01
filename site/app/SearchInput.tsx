import type { InputHTMLAttributes } from 'preact'
import { useRef } from 'preact/hooks'

type Props = InputHTMLAttributes & {
  value: string
  onClear: () => void
}

// A search field with one "Clear" button in place of the browser's own
// clear and suggestion controls, which app.css hides.
export function SearchInput({ onClear, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <span class="search-box">
      <input ref={input} {...props} />
      {props.value === '' ? null : (
        <button
          type="button"
          class="clear"
          onClick={() => {
            onClear()
            input.current?.focus()
          }}
        >
          Clear
        </button>
      )}
    </span>
  )
}
