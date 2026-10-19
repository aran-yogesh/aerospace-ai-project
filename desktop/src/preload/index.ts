import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, isThemeMode, type ResolvedTheme, type ThemeMode, type ThemeState } from '../shared/theme'
import type { LemmaApi } from './api'

const api: LemmaApi = {
  theme: {
    get: () => ipcRenderer.invoke(IPC.themeGet) as Promise<ThemeState>,
    set: (mode: ThemeMode) => {
      if (!isThemeMode(mode)) return Promise.reject(new TypeError('Invalid theme mode'))
      return ipcRenderer.invoke(IPC.themeSet, mode) as Promise<ThemeState>
    },
    onSystemChange: (cb: (theme: ResolvedTheme) => void) => {
      const listener = (_event: IpcRendererEvent, theme: unknown): void => {
        if (theme === 'light' || theme === 'dark') cb(theme)
      }
      ipcRenderer.on(IPC.themeSystemChanged, listener)
      return () => {
        ipcRenderer.removeListener(IPC.themeSystemChanged, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('lemma', api)
