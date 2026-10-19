import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setNonce } from 'get-nonce'
import './theme/fonts'
import './theme/globals.css'
import { App } from './App'

// First guess before the main process answers; in Electron this follows nativeTheme.
document.documentElement.dataset['theme'] = window.matchMedia('(prefers-color-scheme: dark)')
  .matches
  ? 'dark'
  : 'light'

// Lets Radix's scroll-lock <style> pass the production CSP (see src/main/index.ts).
if (window.lemma?.styleNonce) setNonce(window.lemma.styleNonce)

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
