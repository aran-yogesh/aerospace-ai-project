import Store from 'electron-store'
import { isThemeMode, THEME_MODES, type ThemeMode } from '../shared/theme'

interface Settings {
  themeMode: ThemeMode
}

// Lives in the main process only: sandboxed preloads cannot use Node APIs.
const store = new Store<Settings>({
  name: 'settings',
  defaults: { themeMode: 'auto' },
  // An unknown stored value (e.g. 'system' from an earlier build) resets to the default.
  clearInvalidConfig: true,
  schema: {
    themeMode: { type: 'string', enum: [...THEME_MODES] }
  }
})

export function getThemeMode(): ThemeMode {
  const value: unknown = store.get('themeMode')
  return isThemeMode(value) ? value : 'auto'
}

export function setThemeMode(mode: ThemeMode): void {
  store.set('themeMode', mode)
}
