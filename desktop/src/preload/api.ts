import type { ResolvedTheme, ThemeMode, ThemeState } from '../shared/theme'

export interface LemmaThemeApi {
  get(): Promise<ThemeState>
  set(mode: ThemeMode): Promise<ThemeState>
  /** Subscribe to OS appearance changes. Returns an unsubscribe function. */
  onSystemChange(cb: (theme: ResolvedTheme) => void): () => void
}

export interface LemmaApi {
  theme: LemmaThemeApi
}
