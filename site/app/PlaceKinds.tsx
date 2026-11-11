import { catalog } from 'virtual:catalog'
import type { MerchantResolution } from '../../src/engine/types.ts'
import { placeKinds } from './place-kinds.ts'
import { track } from './track.ts'

const KINDS = placeKinds(catalog)

// Asked under the notice for a store earnrate doesn't know, and kept once
// a kind is picked so it can be changed. The pick lives only in the page:
// it isn't saved or put in the address.
export function PlaceKinds({
  merchant,
  kind,
  onKind,
}: {
  merchant: MerchantResolution
  kind: string | null
  onKind: (kind: string | null) => void
}) {
  if (merchant.source !== 'none' && merchant.source !== 'caller') return null
  const pick = (next: string | null) => {
    if (next !== null) track('place-kind')
    onKind(next)
  }
  const inMore = KINDS.more.some((k) => k.category === kind)
  return (
    <div class="place-kinds" role="group" aria-labelledby="place-kinds-ask">
      <p id="place-kinds-ask">
        What kind of place is “{merchant.resolvedName}”?
      </p>
      <div class="chips">
        {KINDS.quick.map((k) => (
          <button
            type="button"
            class={kind === k.category ? 'chip on' : 'chip'}
            aria-pressed={kind === k.category}
            key={k.category}
            onClick={() => pick(kind === k.category ? null : k.category)}
          >
            {k.label}
          </button>
        ))}
        <select
          class={inMore ? 'chip on' : 'chip'}
          aria-label="Something else"
          value={inMore ? (kind ?? '') : ''}
          onChange={(e) => pick(e.currentTarget.value || null)}
        >
          <option value="">Something else</option>
          {KINDS.more.map((k) => (
            <option value={k.category} key={k.category}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
