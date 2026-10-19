import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ResolvedTheme, ThemeMode, ThemeState } from '../../../shared/theme'

export interface ThemeContextValue {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

function prefersDark(): ResolvedTheme {
  // In Electron this follows nativeTheme.themeSource, so it is a good first guess.
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<ThemeState>(() => ({ mode: 'system', system: prefersDark() }))
  const api = window.lemma?.theme

  useEffect(() => {
    if (!api) return
    let cancelled = false
    api
      .get()
      .then((next) => {
        if (!cancelled) setState(next)
      })
      .catch((err: unknown) => console.error('theme.get failed', err))
    const unsubscribe = api.onSystemChange((system) => {
      setState((prev) => ({ ...prev, system }))
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [api])

  const setMode = useCallback(
    (mode: ThemeMode) => {
      setState((prev) => ({ ...prev, mode }))
      if (!api) return
      api
        .set(mode)
        .then(setState)
        .catch((err: unknown) => console.error('theme.set failed', err))
    },
    [api]
  )

  const resolved: ResolvedTheme = state.mode === 'system' ? state.system : state.mode

  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved
  }, [resolved])

  const value = useMemo(() => ({ mode: state.mode, resolved, setMode }), [state.mode, resolved, setMode])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
