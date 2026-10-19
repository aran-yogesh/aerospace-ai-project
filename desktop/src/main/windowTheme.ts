import type { ResolvedTheme } from '../shared/theme'
// tokens.css is the single source of color truth; read --bg from it at build time.
import tokensCss from '../renderer/src/theme/tokens.css?raw'

function readBg(selector: string): string {
  const start = tokensCss.indexOf(selector)
  if (start === -1) throw new Error(`tokens.css: ${selector} block missing`)
  const block = tokensCss.slice(start, tokensCss.indexOf('}', start))
  const match = /--bg:\s*([^;]+);/.exec(block)
  if (!match?.[1]) throw new Error(`tokens.css: --bg missing in ${selector}`)
  return match[1].trim()
}

const WINDOW_BG: Record<ResolvedTheme, string> = {
  dark: readBg("[data-theme='dark']"),
  light: readBg("[data-theme='light']")
}

export function windowBackground(theme: ResolvedTheme): string {
  return WINDOW_BG[theme]
}
