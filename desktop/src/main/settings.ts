import Store from 'electron-store'
import { isThemeMode, type ThemeMode } from '../shared/theme'

interface Settings {
  themeMode: ThemeMode
}

// Lives in the main process only: sandboxed preloads cannot use Node APIs.
const store = new Store<Settings>({
  name: 'settings',
  defaults: { themeMode: 'system' },
  schema: {
    themeMode: { type: 'string', enum: ['light', 'dark', 'system'] }
  }
})

export function getThemeMode(): ThemeMode {
  const value: unknown = store.get('themeMode')
  return isThemeMode(value) ? value : 'system'
}

export function setThemeMode(mode: ThemeMode): void {
  store.set('themeMode', mode)
}
