import { useMemo, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import {
  alternativesText,
  feeSavedText,
  hiddenRatesText,
  keepOrReplace,
  keepOrReplaceAssumes,
  keepOrReplaceLead,
  keepOrReplaceMath,
  keepOrReplaceUnsaid,
  PERKS_NOT_COUNTED,
  replacementExtras,
  replacementKept,
  replacementShort,
  samePointsTag,
  samePointsText,
  transferText,
} from '../../src/engine/keep-or-replace.ts'
import { localToday } from '../../src/engine/periods.ts'
import type { Spending } from '../../src/engine/renewal.ts'
import { capitalize } from '../../src/engine/text.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { CardArt } from './CardArt.tsx'
import { feeLabel, shortName, wholeDollars } from './format.ts'

// Where the spending amounts are entered, for "add them as their own lines".
const SPENDING_TAB = ' in Get a card'

// A read of the wallet: nothing here changes it or leaves the browser.
export function KeepOrReplace({
  wallet,
  cardId,
  spending,
}: {
  wallet: Wallet
  cardId: string
  spending: () => Spending
}) {
  const [open, setOpen] = useState<string | null>(null)
  const k = useMemo(
    () => keepOrReplace(catalog, wallet, cardId, localToday(), spending()),
    [wallet, cardId],
  )
  if (!k) return null
  const unsaid = keepOrReplaceUnsaid(k)
  const [best] = k.replacements
  const notes = [
    samePointsText(catalog, k),
    transferText(catalog, k),
    hiddenRatesText(k, SPENDING_TAB),
  ].filter((t) => t !== '')
  return (
    <div class="keep-answer" aria-live="polite">
      <p>
        <strong>{keepOrReplaceLead(catalog, k)}</strong>
        {best ? ` ${feeSavedText(k, best)}` : ''}
      </p>
      {unsaid === '' ? null : (
        <p class="keep-unsaid">{unsaid} Say which you use above.</p>
      )}
      {k.replacements.length > 0 ? (
        <ol class="result-list keep-list">
          {k.replacements.map((r) => {
            const others = alternativesText(catalog, r)
            const shown = open === r.cardId
            return (
              <li class="result" key={r.cardId}>
                <button
                  type="button"
                  class="result-top result-toggle"
                  aria-expanded={shown}
                  onClick={() => setOpen(shown ? null : r.cardId)}
                >
                  <CardArt id={r.cardId} width={32} />
                  <span class="result-name">
                    <strong>{shortName(r.cardId)}</strong>
                    <span class="muted">{replacementShort(k, r)}</span>
                    {r.samePoints ? (
                      <span class="muted">{samePointsTag(catalog, k)}</span>
                    ) : null}
                  </span>
                  <span class="rate">
                    +{wholeDollars(r.net)}
                    <small>/yr</small>
                  </span>
                </button>
                {shown ? (
                  <>
                    <p class="muted">
                      {capitalize(replacementKept(k, r))}. {feeLabel(r.cardId)}.
                      {others === '' ? '' : ` Or ${others}, the same.`}
                    </p>
                    {replacementExtras(catalog, r).map((line) => (
                      <p class="muted" key={line}>
                        {line}
                      </p>
                    ))}
                    <p>
                      <a href={`/cards/${r.cardId}`}>See card details</a>
                    </p>
                  </>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : null}
      {notes.map((t) => (
        <p key={t}>{t}</p>
      ))}
      {k.members.map((m) => (
        <p class="muted small" key={m}>
          {m}
        </p>
      ))}
      <p class="muted small">{keepOrReplaceMath(k)}</p>
      <p class="small">{PERKS_NOT_COUNTED}</p>
      <details class="filters keep-assumes">
        <summary>What this assumes</summary>
        {keepOrReplaceAssumes(catalog, k, SPENDING_TAB).map((line) => (
          <p class="muted small" key={line}>
            {line}
          </p>
        ))}
      </details>
    </div>
  )
}
