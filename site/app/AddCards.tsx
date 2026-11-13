import { useMemo, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import { localToday } from '../../src/engine/periods.ts'
import { searchCards } from '../../src/engine/setup.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { CardArt } from './CardArt.tsx'
import { issuerName, shortName } from './format.ts'
import { QuickCards } from './QuickCards.tsx'
import { SearchInput } from './SearchInput.tsx'
import { load, save } from './settings.ts'
import { track } from './track.ts'

// Every card added from the grid or the search counts the same way.
export function countAdded() {
  track('wallet-card-added')
  if (!load<boolean>('counted-first-card', false)) {
    track('wallet-first-card')
    save('counted-first-card', true)
  }
}

function AddCard({
  wallet,
  onAdd,
}: {
  wallet: Wallet | null
  onAdd: (cardId: string) => Promise<boolean>
}) {
  const [query, setQuery] = useState('')
  const found = useMemo(
    () =>
      query.trim().length < 2
        ? []
        : searchCards(catalog, query, wallet, localToday()).cards.slice(0, 6),
    [query, wallet],
  )
  return (
    <div>
      <label class="visually-hidden" for="card-search">
        Add a card
      </label>
      <SearchInput
        id="card-search"
        class="search"
        type="search"
        placeholder="Add a card, like Sapphire"
        autocomplete="off"
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onClear={() => setQuery('')}
      />
      <ul class="found">
        {found.map((c) => (
          <li key={c.id}>
            <span class="found-name">
              <CardArt id={c.id} width={32} />
              <span>
                {shortName(c.id)}
                <span class="muted"> · {issuerName(c.issuer)}</span>
              </span>
            </span>
            {c.held ? (
              <span class="muted">Added</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void onAdd(c.id).then((ok) => {
                    if (ok) countAdded()
                  })
                  setQuery('')
                }}
              >
                Add
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// The common cards to tap and the search for the rest: My wallet's Add a
// card, and At a store's Your cards before any are saved.
export function CardPicker({
  wallet,
  added,
  locked,
  onAdd,
  onRemove,
}: {
  wallet: Wallet | null
  added: string[]
  locked: boolean
  onAdd: (cardId: string) => Promise<boolean>
  onRemove: (cardId: string) => void
}) {
  return (
    <fieldset class="lock" disabled={locked}>
      <QuickCards
        wallet={wallet}
        added={added}
        onAdd={(cardId) => {
          void onAdd(cardId).then((ok) => {
            if (!ok) return
            countAdded()
            track('wallet-quick-add')
          })
        }}
        onRemove={onRemove}
      />
      <p class="quick-search-lead">
        Not here? Find any of the {catalog.cards.length} cards earnrate knows.
      </p>
      <AddCard wallet={wallet} onAdd={onAdd} />
    </fieldset>
  )
}
