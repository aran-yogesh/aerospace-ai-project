/** Shared between main, preload and renderer. No runtime deps. */
export const THEME_MODES = ['light', 'dark', 'auto'] as const
export type ThemeMode = (typeof THEME_MODES)[number]
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeState {
  mode: ThemeMode
  /** The OS appearance as reported by nativeTheme. */
  system: ResolvedTheme
}

export const IPC = {
  themeGet: 'lemma:theme:get',
  themeSet: 'lemma:theme:set',
  themeChanged: 'lemma:theme:changed'
} as const

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value)
}

export function isThemeState(value: unknown): value is ThemeState {
  if (typeof value !== 'object' || value === null) return false
  const { mode, system } = value as Record<string, unknown>
  return isThemeMode(mode) && (system === 'light' || system === 'dark')
}

export function resolveTheme(state: ThemeState): ResolvedTheme {
  return state.mode === 'auto' ? state.system : state.mode
}
