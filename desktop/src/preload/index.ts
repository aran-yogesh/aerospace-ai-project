import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, isThemeMode, isThemeState, type ThemeMode, type ThemeState } from '../shared/theme'
import type { LemmaApi } from './api'

// Surface CSP violations loudly (as console errors) so they cannot go unnoticed in dev,
// in production, or in scripts/screenshots.ts. Registered before any page script runs.
window.addEventListener('securitypolicyviolation', (event) => {
  console.error(
    `[CSP] blocked ${event.blockedURI || 'inline'} (${event.effectiveDirective}) at ${event.sourceFile}:${event.lineNumber}`
  )
})

const NONCE_ARG = '--lemma-style-nonce='
const styleNonce = process.argv.find((a) => a.startsWith(NONCE_ARG))?.slice(NONCE_ARG.length)

const api: LemmaApi = {
  theme: {
    get: () => ipcRenderer.invoke(IPC.themeGet) as Promise<ThemeState>,
    set: (mode: ThemeMode) => {
      if (!isThemeMode(mode)) return Promise.reject(new TypeError('Invalid theme mode'))
      return ipcRenderer.invoke(IPC.themeSet, mode) as Promise<ThemeState>
    },
    onChange: (cb: (state: ThemeState) => void) => {
      const listener = (_event: IpcRendererEvent, state: unknown): void => {
        if (isThemeState(state)) cb(state)
      }
      ipcRenderer.on(IPC.themeChanged, listener)
      return () => {
        ipcRenderer.removeListener(IPC.themeChanged, listener)
      }
    }
  },
  platform: process.platform,
  styleNonce
}

contextBridge.exposeInMainWorld('lemma', api)
