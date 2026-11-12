import { render } from 'preact'
import { Rate } from './Rate.tsx'
import '../app/app.css'
import './rate.css'

const root = document.getElementById('rate')
if (root) {
  root.textContent = ''
  render(<Rate />, root)
}
