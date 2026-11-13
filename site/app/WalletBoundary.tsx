import { Component, type ComponentChildren } from 'preact'
import { savedWalletText } from './saved-wallet.ts'

function download(text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = 'earnrate-wallet.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function startOver() {
  try {
    localStorage.removeItem('earnrate:wallet')
  } catch {
    // Without storage there's nothing saved to clear.
  }
  location.reload()
}

const syncedNow = () => {
  try {
    return (
      (
        JSON.parse(localStorage.getItem('earnrate:sync') ?? 'null') as {
          on?: unknown
        } | null
      )?.on === true
    )
  } catch {
    return false
  }
}

// What shows instead of a page that broke. `ownWallet` is false on a shared
// report, which must not read this browser's storage.
export class WalletBoundary extends Component<
  { children: ComponentChildren; ownWallet: () => boolean },
  { broken: boolean }
> {
  override state = { broken: false }

  static override getDerivedStateFromError() {
    return { broken: true }
  }

  render() {
    if (!this.state.broken) return this.props.children
    if (!this.props.ownWallet())
      return (
        <p class="callout">
          Something went wrong showing this report. Reload the page to try
          again.
        </p>
      )
    const text = savedWalletText()
    return (
      <div class="callout">
        <p>
          Something went wrong showing this page. It may be the wallet saved in
          this browser.
        </p>
        <p>
          Start over clears that wallet and reloads the page.
          {text === null ? '' : ' Download it first to keep a copy.'}
          {syncedNow() ? ' Your Claude wallet stays as it is.' : ''}
        </p>
        <div class="row-buttons">
          {text === null ? null : (
            <button type="button" onClick={() => download(text)}>
              Download your saved wallet
            </button>
          )}
          <button type="button" onClick={startOver}>
            Start over
          </button>
        </div>
      </div>
    )
  }
}
