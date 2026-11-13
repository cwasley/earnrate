import { render } from 'preact'
import { App } from './App.tsx'
import { startMyLink } from './my-link.ts'
import { copyButtons, trackClicks } from './track.ts'
import { WalletBoundary } from './WalletBoundary.tsx'
import './app.css'

trackClicks()
copyButtons()
startMyLink()

const root = document.getElementById('app')
if (root) {
  root.textContent = ''
  render(
    <WalletBoundary ownWallet={() => true}>
      <App />
    </WalletBoundary>,
    root,
  )
  // The outline index.html showed until now (app.css).
  const main = root.closest('main')
  if (main) {
    delete main.dataset.loading
    delete main.dataset.saved
  }
}

// Offline support for the installed app; only the built site has sw.js.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    // Without it the site still works, just not offline.
  })
}
