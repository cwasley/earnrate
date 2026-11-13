import { render } from 'preact'
import { Sheet } from './Sheet.tsx'
import '../app/app.css'
import './sheet.css'

const root = document.getElementById('sheet')
if (root) {
  root.textContent = ''
  render(<Sheet />, root)
  // The outline sheet.html showed until now (sheet.css).
  delete root.closest('main')?.dataset.loading
}
