import './jitless.ts'
import { render } from 'preact'
import '../app/app.css'
import './statement.css'
import { StatementCheck } from './Statement.tsx'

const root = document.getElementById('check')
if (root) {
  root.textContent = ''
  render(<StatementCheck />, root)
}
