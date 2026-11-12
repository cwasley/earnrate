import { useEffect, useMemo, useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import { cheatSheet } from '../../src/engine/cheat-sheet.ts'
import { localToday } from '../../src/engine/periods.ts'
import { shortDate } from '../../src/engine/text.ts'
import { CardArt } from '../app/CardArt.tsx'
import { SheetDownload, WalletPass } from '../app/CheatSheetParts.tsx'
import { pct, shortName } from '../app/format.ts'
import { Logo } from '../app/Logo.tsx'
import { track } from '../app/track.ts'
import { ranOut, sentSheet, sheetPart, type SheetLink } from './link.ts'

// A cheat sheet someone sent, read from the address alone: nothing saved in
// this browser is read or written here.
export function Sheet() {
  const [fragment, setFragment] = useState(location.hash)
  useEffect(() => {
    const opened = () => {
      if (sheetPart(location.hash) !== null) track('cheat-sheet-opened')
    }
    opened()
    const onChange = () => {
      setFragment(location.hash)
      opened()
    }
    addEventListener('hashchange', onChange)
    return () => {
      removeEventListener('hashchange', onChange)
    }
  }, [])
  const source = useMemo(() => sentSheet(catalog, fragment), [fragment])
  if (source.kind === 'sent') return <Sent link={source.link} />
  return (
    <>
      <h1>Card cheat sheet</h1>
      {source.kind === 'bad' ? (
        <p class="callout">{source.message}</p>
      ) : (
        <p>This page shows a cheat sheet someone sent you. Open their link.</p>
      )}
      <p>
        To make your own, add your cards in <a href="/#wallet">My wallet</a>.
      </p>
    </>
  )
}

function Sent({ link }: { link: SheetLink }) {
  const today = localToday()
  const sheet = useMemo(
    () => cheatSheet(catalog, link.wallet, today),
    [link, today],
  )
  const old = ranOut(catalog, link, today)
  const add = link.wallet.cards.map((c) => `add=${c.id}`).join('&')
  return (
    <>
      <section class="panel sheet sent-sheet" aria-labelledby="sheet-title">
        <div class="sheet-head">
          <div>
            <span class="sheet-brand">earnrate</span>
            <h1 id="sheet-title">Card cheat sheet</h1>
            <p>{sheet.quarter} · the card to use for each purchase</p>
          </div>
          <div class="sheet-tools">
            <SheetDownload sheet={sheet} />
            <Logo class="sheet-logo" chip="var(--accent)" />
          </div>
        </div>
        {old ? (
          <p class="sheet-old">
            Some picks or activations in this link have run out since it was
            sent, so those cards show their usual rates. Ask for a new link.
          </p>
        ) : null}
        <ol class="sheet-rows">
          {sheet.rows.map((row) => (
            <li key={row.label}>
              <span class="sheet-label">{row.label}</span>
              <span class="sheet-card">
                {row.cardId === null ? null : (
                  <CardArt id={row.cardId} width={36} />
                )}
                <span class="sheet-card-name">
                  {row.cardId === null
                    ? 'None of these cards'
                    : shortName(row.cardId)}
                  {row.note ? <span class="row-note">{row.note}</span> : null}
                </span>
              </span>
              <span class="sheet-rate">
                {row.effectiveReturnPct === null
                  ? ''
                  : pct(row.effectiveReturnPct)}
              </span>
            </li>
          ))}
        </ol>
        <WalletPass wallet={link.wallet} />
      </section>
      <div class="sent-after">
        {/* No referrer, so My wallet asks before adding them. */}
        <a class="button" href={`/#wallet&${add}`} rel="noreferrer">
          Add these cards to My wallet
        </a>
        <p class="small muted">
          Sent {shortDate(link.made)}. Nothing on this page is saved in your
          browser.
        </p>
      </div>
    </>
  )
}
