import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/fonts'
import './theme/tokens.css'
import './theme/global.css'
import { App } from './App'

document.documentElement.dataset['theme'] = window.matchMedia('(prefers-color-scheme: dark)')
  .matches
  ? 'dark'
  : 'light'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
