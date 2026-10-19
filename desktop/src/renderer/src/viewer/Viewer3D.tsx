import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Maximize, PanelTop, Scissors, Square } from 'lucide-react'
import { Callout } from '@/components/ui/callout'
import { cn } from '@/lib/utils'
import { CadViewer, type CadViewerApi, type ScreenAnchor } from './CadViewer'
import type { MeshShapes } from './shapes'
import type { ViewerTheme } from './theme'

export interface Viewer3DProps {
  shapes: MeshShapes
  theme: ViewerTheme
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  /** Text of the on-canvas callout for the selected component. */
  calloutText: (id: string) => string | null
  /** Receives the viewer API once the model is loaded (null on unmount). */
  onReady?: (api: CadViewerApi | null) => void
  onError?: (err: Error) => void
  className?: string
}

const TOOLBAR_SAFE_TOP = 48 // keep the callout clear of the toolbar row
const EDGE_GAP = 12
const OFFSET_X = 24
const OFFSET_Y = 28
const SHOULDER = 16
const MARKER = 7 // the Callout's 6px accent square + 1px border sits left of its box

function ToolButton({
  label,
  onClick,
  pressed,
  children
}: {
  label: string
  onClick: () => void
  pressed?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      data-testid={`viewer-tool-${label.toLowerCase()}`}
      className={cn(
        // Callout box, without the accent marker (orange is reserved for selection).
        'inline-flex h-6 items-center gap-1.5 border bg-bg px-2 mono-label text-text-muted',
        'transition-colors duration-120 ease-out hover:text-text',
        '[&_svg]:size-3.5 [&_svg]:shrink-0',
        pressed ? 'border-text text-text' : 'border-border hover:border-text-muted'
      )}
    >
      {children}
      {label}
    </button>
  )
}

/**
 * Hosts the CadViewer: canvas, our toolbar (FIT, ISO, TOP, FRONT, SECTION) and the
 * selection callout with its 1px accent leader, repositioned on every rendered frame.
 */
export function Viewer3D({
  shapes,
  theme,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  calloutText,
  onReady,
  onError,
  className
}: Viewer3DProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<CadViewer | null>(null)
  const calloutRef = useRef<HTMLSpanElement>(null)
  const lineRef = useRef<SVGPolylineElement>(null)
  const dotRef = useRef<SVGRectElement>(null)
  const overlayRef = useRef<SVGSVGElement>(null)
  const [section, setSection] = useState(false)

  // Latest callbacks without re-creating the viewer.
  const cb = useRef({ onSelect, onHover, onReady, onError, theme })
  useLayoutEffect(() => {
    cb.current = { onSelect, onHover, onReady, onError, theme }
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const viewer = new CadViewer(host, cb.current.theme)
    viewerRef.current = viewer
    const offSelect = viewer.onSelect((id) => cb.current.onSelect(id))
    const offHover = viewer.onHover((id) => cb.current.onHover(id))
    try {
      viewer.load(shapes)
      cb.current.onReady?.(viewer)
    } catch (err) {
      cb.current.onError?.(err instanceof Error ? err : new Error(String(err)))
    }
    return () => {
      offSelect()
      offHover()
      cb.current.onReady?.(null)
      viewer.dispose()
      viewerRef.current = null
    }
  }, [shapes])

  useEffect(() => viewerRef.current?.setTheme(theme), [theme])
  useEffect(() => viewerRef.current?.select(selectedId), [selectedId, shapes])
  useEffect(() => viewerRef.current?.highlight(hoveredId), [hoveredId, shapes])
  useEffect(() => viewerRef.current?.setSection(section), [section, shapes])

  const text = selectedId ? calloutText(selectedId) : null

  // Position the callout + leader on every frame (direct DOM writes, no React renders).
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const place = (a: ScreenAnchor | null): void => {
      const box = calloutRef.current
      const line = lineRef.current
      const dot = dotRef.current
      const svg = overlayRef.current
      if (!box || !line || !dot || !svg) return
      const visible =
        a !== null && a.x >= 0 && a.y >= 0 && a.x <= a.width && a.y <= a.height && text !== null
      svg.style.visibility = visible ? 'visible' : 'hidden'
      box.style.visibility = visible ? 'visible' : 'hidden'
      if (!a || !visible) return

      svg.setAttribute('viewBox', `0 0 ${a.width} ${a.height}`)
      const w = box.offsetWidth
      const h = box.offsetHeight
      // Prefer up-right of the component's screen box; flip left if it would clip.
      let right = true
      let left = Math.max(a.rect.right, a.x) + OFFSET_X
      if (left + w > a.width - EDGE_GAP) {
        right = false
        left = Math.min(a.rect.left, a.x) - OFFSET_X - w
      }
      left = Math.min(Math.max(left, EDGE_GAP + MARKER), a.width - EDGE_GAP - w)
      let cy = Math.min(a.rect.top, a.y) - OFFSET_Y
      // Above the toolbar band or the viewport: go below the component instead.
      if (cy - h / 2 < TOOLBAR_SAFE_TOP) cy = Math.max(a.rect.bottom, a.y) + OFFSET_Y
      cy = Math.min(Math.max(cy, TOOLBAR_SAFE_TOP + h / 2), a.height - EDGE_GAP - h / 2)

      box.style.transform = `translate(${Math.round(left)}px, ${Math.round(cy - h / 2)}px)`
      const startX = right ? left - MARKER : left + w
      const shoulderX = right ? startX - SHOULDER : startX + SHOULDER
      const sy = Math.round(cy) + 0.5
      line.setAttribute(
        'points',
        `${startX},${sy} ${shoulderX},${sy} ${Math.round(a.x) + 0.5},${Math.round(a.y) + 0.5}`
      )
      dot.setAttribute('x', String(Math.round(a.x) - 1.5))
      dot.setAttribute('y', String(Math.round(a.y) - 1.5))
    }
    return viewer.onFrame(place)
  }, [shapes, text, selectedId])

  return (
    <div className={cn('relative size-full overflow-hidden', className)} data-testid="viewer-3d">
      <div ref={hostRef} className="absolute inset-0 animate-fade-in" />
      <svg
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full text-accent"
        style={{ visibility: 'hidden' }}
      >
        <polyline
          ref={lineRef}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          shapeRendering="geometricPrecision"
        />
        <rect ref={dotRef} width={4} height={4} fill="currentColor" />
      </svg>
      <Callout
        ref={calloutRef}
        variant="filled"
        data-testid="viewer-callout"
        className="pointer-events-none absolute top-0 left-0 tabular-nums"
        style={{ visibility: 'hidden' }}
      >
        {text ?? ''}
      </Callout>
      <div
        role="toolbar"
        aria-label="View"
        className="absolute top-3 left-3 flex items-center gap-1"
      >
        <ToolButton label="Fit" onClick={() => viewerRef.current?.fitTo()}>
          <Maximize strokeWidth={1.5} />
        </ToolButton>
        <ToolButton label="Iso" onClick={() => viewerRef.current?.setView('iso')}>
          <Box strokeWidth={1.5} />
        </ToolButton>
        <ToolButton label="Top" onClick={() => viewerRef.current?.setView('top')}>
          <PanelTop strokeWidth={1.5} />
        </ToolButton>
        <ToolButton label="Front" onClick={() => viewerRef.current?.setView('front')}>
          <Square strokeWidth={1.5} />
        </ToolButton>
        <ToolButton label="Section" onClick={() => setSection((s) => !s)} pressed={section}>
          <Scissors strokeWidth={1.5} />
        </ToolButton>
      </div>
    </div>
  )
}
