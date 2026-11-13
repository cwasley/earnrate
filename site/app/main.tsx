import { render } from 'preact'
import { App } from './App.tsx'
import { startMyLink } from './my-link.ts'
import { loadWallet } from './saved-wallet.ts'
import { copyButtons, trackClicks } from './track.ts'
import './app.css'

trackClicks()
copyButtons()
startMyLink()

const root = document.getElementById('app')
if (root) {
  // Someone with saved cards skips the headline (app.css).
  if ((loadWallet()?.cards.length ?? 0) > 0)
    root.closest('main')?.setAttribute('data-returning', '')
  root.textContent = ''
  render(<App />, root)
}

// Offline support for the installed app; only the built site has sw.js.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    // Without it the site still works, just not offline.
  })
}
