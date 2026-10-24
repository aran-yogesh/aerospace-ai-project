// Aliased: lint:colors reads a bare `Color(` call as the CSS color() function.
import { Color as ThreeColor } from 'three'

export type ViewerTheme = 'light' | 'dark'

/** Viewer colors, resolved from theme/tokens.css at runtime. */
export interface ViewerPalette {
  model: ThreeColor
  edge: ThreeColor
  edgeOpacity: number
  /** Hover moves the fill this far toward white. */
  hoverLift: number
  selected: ThreeColor
  selectedEdge: ThreeColor
  selectedEdgeOpacity: number
  /** Token name ("--pressure-3") -> fill, for colorBy. */
  pressure: Record<string, ThreeColor>
}

export const WHITE = new ThreeColor(1, 1, 1)

function num(raw: string, fallback: number): number {
  const v = Number.parseFloat(raw)
  return Number.isFinite(v) ? v : fallback
}

function parse(raw: string): ThreeColor {
  const c = new ThreeColor()
  if (raw) c.setStyle(raw)
  return c
}

/**
 * Reads the --viewer-* tokens for `mode`. A probe element carrying data-theme=mode is
 * used (tokens are scoped to [data-theme]), so the answer does not depend on when the
 * ThemeProvider updates <html>.
 */
export function readPalette(host: HTMLElement, mode: ViewerTheme): ViewerPalette {
  const probe = document.createElement('span')
  probe.dataset['theme'] = mode
  probe.hidden = true
  host.append(probe)
  const cs = getComputedStyle(probe)
  const v = (name: string): string => cs.getPropertyValue(name).trim()

  const model = parse(v('--viewer-model'))
  const accent = parse(v('--accent'))
  const hoverLift = num(v('--viewer-hover-lift'), 0.15)
  const palette: ViewerPalette = {
    model,
    hoverLift,
    edge: parse(v('--viewer-edge')),
    edgeOpacity: num(v('--viewer-edge-opacity'), 0.6),
    selected: model.clone().lerp(accent, num(v('--viewer-selected-mix'), 0.85)),
    selectedEdge: parse(v('--viewer-selected-edge') || v('--accent')),
    selectedEdgeOpacity: num(v('--viewer-selected-edge-opacity'), 1),
    pressure: Object.fromEntries(
      [1, 2, 3, 4, 5].map((i) => [`--pressure-${i}`, parse(v(`--pressure-${i}`))])
    )
  }
  probe.remove()
  return palette
}
