import { render } from 'preact'
import { App } from './App.tsx'
import './app.css'

const root = document.getElementById('app')
if (root) {
  root.textContent = ''
  render(<App />, root)
}

// Offline support for the installed app; only the built site has sw.js.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    // Without it the site still works, just not offline.
  })
}
