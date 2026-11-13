import { render } from 'preact'
import { WalletBoundary } from '../app/WalletBoundary.tsx'
import { reportPart } from './link.ts'
import { Rate } from './Rate.tsx'
import { storedId } from './store.ts'
import '../app/app.css'
import './rate.css'

const root = document.getElementById('rate')
if (root) {
  root.textContent = ''
  render(
    <WalletBoundary
      ownWallet={() =>
        storedId(location.pathname) === null &&
        reportPart(location.hash) === null
      }
    >
      <Rate />
    </WalletBoundary>,
    root,
  )
  // The outline rate.html showed until now (rate.css).
  const main = root.closest('main')
  if (main) {
    delete main.dataset.loading
    delete main.dataset.rate
  }
}
