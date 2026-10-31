import { render } from 'preact'
import { App } from './App.tsx'
import './app.css'

const root = document.getElementById('app')
if (root) {
  root.textContent = ''
  render(<App />, root)
}
