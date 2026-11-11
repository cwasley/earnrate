import type { Wallet } from '../../src/schema/wallet.ts'
import { CardArt } from './CardArt.tsx'
import { cards, shortName } from './format.ts'
import { QUICK_CARDS } from './quick-cards.ts'

const Check = () => (
  <span class="quick-check" aria-hidden="true">
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  </span>
)

// Common cards to tap in or out of the wallet. Only a card added since the
// grid opened (`added`, in order, kept after it's tapped out) can be tapped
// out: one held before may carry picks, totals or bonus progress, so it's
// removed under Your cards, where there's Undo. Cards added by search join
// the grid.
export function QuickCards({
  wallet,
  added,
  onAdd,
  onRemove,
}: {
  wallet: Wallet | null
  added: string[]
  onAdd: (cardId: string) => void
  onRemove: (cardId: string) => void
}) {
  const held = new Set(wallet?.cards.map((c) => c.id) ?? [])
  const shown = [
    ...QUICK_CARDS.filter((id) => cards.has(id)),
    ...added.filter((id) => !QUICK_CARDS.includes(id)),
  ]
  return (
    <ul class="quick-cards" aria-label="Common cards">
      {shown.map((id) => {
        const on = held.has(id)
        return (
          <li key={id}>
            {on && !added.includes(id) ? (
              <div class="quick-card kept">
                <CardArt id={id} width={64} />
                <span class="quick-name">{shortName(id)}</span>
                <span class="quick-held">In your wallet</span>
                <Check />
              </div>
            ) : (
              <button
                type="button"
                class="quick-card"
                aria-pressed={on}
                onClick={() => {
                  if (on) onRemove(id)
                  else onAdd(id)
                }}
              >
                <CardArt id={id} width={64} />
                <span class="quick-name">{shortName(id)}</span>
                {on ? <Check /> : null}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
