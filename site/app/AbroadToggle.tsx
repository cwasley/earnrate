import { ABROAD_LABEL } from './purchase-options.ts'

export { ABROAD_NOTE } from './purchase-options.ts'

export function AbroadToggle({
  abroad,
  onChange,
}: {
  abroad: boolean
  onChange: (abroad: boolean) => void
}) {
  return (
    <label class="check abroad">
      <input
        type="checkbox"
        checked={abroad}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {ABROAD_LABEL}
    </label>
  )
}
