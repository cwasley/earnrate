import { useState } from 'preact/hooks'
import { catalog } from 'virtual:catalog'
import type { CheatSheet } from '../../src/engine/cheat-sheet.ts'
import { localToday } from '../../src/engine/periods.ts'
import type { Wallet } from '../../src/schema/wallet.ts'
import { encodeSheet, sendable } from '../sheet/link.ts'
import { pct, shortName } from './format.ts'
import { download, prefersDark } from './picture.ts'
import { cheatSheetImage } from './sheet-image.ts'
import { track } from './track.ts'

const PASS_URL = 'https://pass.earnrate.dev/'

// The one thing earnrate.dev sends anywhere: what the pass needs (card ids,
// picks, activations, checkout labels, memberships), never amounts or
// searches. The signer keeps nothing.
export function WalletPass({ wallet }: { wallet: Wallet }) {
  const sent = JSON.stringify({
    memberships: wallet.memberships,
    cards: wallet.cards.map((c) => ({
      id: c.id,
      checkout_label: c.checkout_label,
      chosen: c.chosen,
      activated: c.activated,
    })),
  })
  return (
    <form
      class="wallet-pass"
      method="post"
      action={PASS_URL}
      onSubmit={() => {
        track('apple-wallet')
      }}
    >
      <input type="hidden" name="wallet" value={sent} />
      <input type="hidden" name="date" value={localToday()} />
      <button type="submit" aria-label="Add to Apple Wallet">
        <img src="/add-to-apple-wallet.svg" alt="" width="126" height="40" />
      </button>
      <p class="muted">
        For iPhone: this cheat sheet in Apple Wallet, good until the quarter
        ends. This sends the card names and picks (no amounts) to earnrate's
        server, which makes the pass and keeps nothing.
      </p>
    </form>
  )
}

async function saveSheet(sheet: CheatSheet) {
  const blob = await cheatSheetImage(sheet, shortName, pct, prefersDark())
  if (!blob) return
  download(
    blob,
    `earnrate-cheat-sheet-${sheet.quarter.toLowerCase().replace(/\s+/g, '-')}.png`,
  )
}

const ICON = {
  viewBox: '0 0 24 24',
  'aria-hidden': 'true',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const

export function SheetDownload({ sheet }: { sheet: CheatSheet }) {
  return (
    <button
      type="button"
      class="sheet-icon"
      aria-label="Download as an image"
      title="Download as an image"
      onClick={() => {
        track('cheat-sheet-image')
        void saveSheet(sheet)
      }}
    >
      <svg {...ICON}>
        <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
      </svg>
    </button>
  )
}

// Sends a link that opens this sheet on another phone (/sheet), through the
// share sheet where there is one, or copied. The link is made from the
// wallet only when pressed, and holds what site/sheet/link.ts says.
export function useSheetSend(wallet: Wallet) {
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  const send = () => {
    const url = `${location.origin}/sheet#${encodeSheet(catalog, wallet, localToday())}`
    setShown(null)
    if (typeof navigator.share === 'function') {
      navigator.share({ url }).then(
        () => track('cheat-sheet-link'),
        () => undefined,
      )
      return
    }
    const clipboard = navigator.clipboard as Clipboard | undefined
    if (!clipboard) {
      setShown(url)
      return
    }
    clipboard.writeText(url).then(
      () => {
        track('cheat-sheet-link')
        setCopied(true)
        setTimeout(() => setCopied(false), 4000)
      },
      () => setShown(url),
    )
  }
  const button = sendable(catalog, wallet) ? (
    <button
      type="button"
      class="sheet-icon"
      aria-label="Send this cheat sheet"
      title="Send this cheat sheet"
      onClick={send}
    >
      <svg {...ICON}>
        {copied ? (
          <path d="M5 12.5 9.5 17 19 7" />
        ) : (
          <path d="M12 14V3.5M8 7.5l4-4 4 4M8.5 10.5H6v10h12v-10h-2.5" />
        )}
      </svg>
    </button>
  ) : null
  const status =
    copied || shown !== null ? (
      <div class="sheet-sent" role="status">
        <p>
          {copied
            ? 'Link copied. It opens this sheet on another phone.'
            : 'Copy this link. It opens this sheet on another phone:'}
        </p>
        {shown === null ? null : (
          <input
            type="text"
            readOnly
            aria-label="The link"
            value={shown}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </div>
    ) : null
  return { button, status }
}
