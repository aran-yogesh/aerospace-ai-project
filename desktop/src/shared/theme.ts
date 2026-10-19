/** Shared between main, preload and renderer. No runtime deps. */
export const THEME_MODES = ['light', 'dark', 'system'] as const
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
  themeSystemChanged: 'lemma:theme:system-changed'
} as const

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value)
}
