// The engine tells only the U.S. from everywhere else, so the page asks just
// that and never names a country.
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
      Paying outside the U.S.
    </label>
  )
}

export const ABROAD_NOTE = ' · outside the U.S.'
