import type { ThemeMode, ThemeState } from '../shared/theme'

export interface LemmaThemeApi {
  get(): Promise<ThemeState>
  set(mode: ThemeMode): Promise<ThemeState>
  /**
   * Subscribe to theme changes: a new mode (from any window or caller) or a new OS
   * appearance. Returns an unsubscribe function.
   */
  onChange(cb: (state: ThemeState) => void): () => void
}

export interface LemmaApi {
  theme: LemmaThemeApi
  /** process.platform, used to inset the top bar for macOS traffic lights. */
  platform: string
  /** Production only: CSP nonce for the one runtime <style> element (Radix scroll lock). */
  styleNonce: string | undefined
}
