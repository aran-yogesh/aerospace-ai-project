import { useLayoutEffect, useRef, useState } from 'react'
import { qty, sig, toDisplay, TYPE_LABEL, unitOf } from '@/lib/format'
import type { SolveResult } from '@/lib/apiTypes'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/workspace/WorkspaceContext'

const PAD = { left: 72, right: 28, top: 36, bottom: 48 }

/** About `count` round tick values covering [lo, hi]. */
function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  const ticks: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) {
    ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t)
  }
  return ticks
}

function useSize(): [React.RefObject<HTMLDivElement>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

/**
 * ΔP plot: pressure relative to the inlet along the cumulative path length. Each
 * component is one piece of the line (a slope for pipes, a vertical step for zero-length
 * fittings). Hover and selection are shared with every other view.
 */
export function DpPlot({ result }: { result: SolveResult }): React.JSX.Element {
  const u = useUnits()
  const { selectedId, hoveredId, select, hover } = useWorkspace()
  const [ref, { w, h }] = useSize()

  const segs = result.segments
  const xs = (m: number): number => toDisplay('length', m, u)
  const ps = (pa: number): number => toDisplay('pressure', pa, u)
  const xMax = xs(segs[segs.length - 1]?.x_end_m ?? 1) || 1
  const pMin = Math.min(0, ...segs.map((s) => ps(s.p_after_pa ?? 0)))
  const xTicks = niceTicks(0, xMax)
  const yTicks = niceTicks(pMin, 0)
  const yLo = Math.min(pMin, yTicks[0] ?? pMin)
  const xHi = Math.max(xMax, xTicks[xTicks.length - 1] ?? xMax)

  const iw = Math.max(1, w - PAD.left - PAD.right)
  const ih = Math.max(1, h - PAD.top - PAD.bottom)
  const X = (v: number): number => PAD.left + (v / xHi) * iw
  const Y = (v: number): number => PAD.top + (yLo === 0 ? 0 : (v / yLo) * ih)

  const focusId = hoveredId ?? selectedId
  const focusIndex = segs.findIndex((s) => s.component_id === focusId)
  const focus = focusIndex >= 0 ? segs[focusIndex] : undefined

  return (
    <div ref={ref} className="relative size-full bg-bg" data-testid="dp-plot">
      {w > 0 ? (
        <svg width={w} height={h} className="absolute inset-0" shapeRendering="geometricPrecision">
          {/* Grid and ticks. */}
          <g className="stroke-border" strokeWidth={1} shapeRendering="crispEdges">
            {yTicks.map((t) => (
              <line key={`y${t}`} x1={PAD.left} x2={PAD.left + iw} y1={Y(t)} y2={Y(t)} />
            ))}
            {xTicks.map((t) => (
              <line key={`x${t}`} x1={X(t)} x2={X(t)} y1={PAD.top} y2={PAD.top + ih} />
            ))}
          </g>
          <g className="stroke-text-muted" strokeWidth={1} shapeRendering="crispEdges">
            <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + ih} />
            <line x1={PAD.left} x2={PAD.left + iw} y1={PAD.top + ih} y2={PAD.top + ih} />
          </g>
          <g className="num fill-text-muted text-label">
            {yTicks.map((t) => (
              <text key={`yl${t}`} x={PAD.left - 8} y={Y(t) + 4} textAnchor="end">
                {sig(t, 3)}
              </text>
            ))}
            {xTicks.map((t) => (
              <text key={`xl${t}`} x={X(t)} y={PAD.top + ih + 16} textAnchor="middle">
                {sig(t, 2)}
              </text>
            ))}
          </g>
          <text x={PAD.left} y={PAD.top - 14} className="mono-label fill-text-muted">
            Pressure rel. inlet · <tspan className="normal-case">{unitOf('pressure', u)}</tspan>
          </text>
          <text
            x={PAD.left + iw}
            y={PAD.top + ih + 36}
            textAnchor="end"
            className="mono-label fill-text-muted"
          >
            Path length · <tspan className="normal-case">{unitOf('length', u)}</tspan>
          </text>

          {/* Focus band behind the line. */}
          {focus ? (
            <rect
              x={X(xs(focus.x_start_m)) - 3}
              y={PAD.top}
              width={Math.max(6, X(xs(focus.x_end_m)) - X(xs(focus.x_start_m)) + 6)}
              height={ih}
              className="fill-surface-raised"
            />
          ) : null}

          {/* One piece of the step line per component; the shortest last, so their hit
              columns sit on top of a neighbour's. */}
          {[...segs.entries()]
            .sort(([, a], [, b]) => b.x_end_m - b.x_start_m - (a.x_end_m - a.x_start_m))
            .map(([i, s]) => {
              const p0 = ps(i === 0 ? 0 : (segs[i - 1]?.p_after_pa ?? 0))
              const p1 = ps(s.p_after_pa ?? 0)
              const x0 = X(xs(s.x_start_m))
              const x1 = X(xs(s.x_end_m))
              const selected = s.component_id === selectedId
              const hovered = s.component_id === hoveredId
              const d = `M${x0} ${Y(p0)}L${x1} ${Y(p1)}`
              return (
                <g
                  key={s.component_id}
                  data-testid="dp-segment"
                  data-component-id={s.component_id}
                  className="cursor-pointer"
                  onClick={() => select(s.component_id, { fit: true })}
                  onPointerEnter={() => hover(s.component_id)}
                  onPointerLeave={() => hover(null)}
                >
                  {/* Hit column over the segment's x range (min 8px, so zero-length fittings hover). */}
                  <rect
                    x={Math.min(x0, (x0 + x1) / 2 - 4)}
                    y={PAD.top}
                    width={Math.max(8, x1 - x0)}
                    height={ih}
                    className="fill-transparent"
                  />
                  <path
                    d={d}
                    fill="none"
                    strokeWidth={selected || hovered ? 2 : 1.5}
                    strokeLinecap="square"
                    className={cn(
                      'transition-colors duration-120 ease-out',
                      selected ? 'stroke-accent' : 'stroke-text'
                    )}
                  />
                </g>
              )
            })}
          {/* Joints. */}
          <g className="fill-text">
            {segs.map((s) => (
              <rect
                key={`j${s.component_id}`}
                x={X(xs(s.x_end_m)) - 1.5}
                y={Y(ps(s.p_after_pa ?? 0)) - 1.5}
                width={3}
                height={3}
              />
            ))}
          </g>
        </svg>
      ) : null}
      {focus ? (
        <div
          data-testid="dp-readout"
          className="pointer-events-none absolute top-3 right-3 flex items-center gap-2 border border-border bg-bg px-2 py-1"
        >
          <span className="num text-label text-text-muted">
            {String(focusIndex + 1).padStart(2, '0')}
          </span>
          <span className="mono-label text-text">{TYPE_LABEL[focus.type]}</span>
          <span className="num text-text">
            ΔP {qty('pressure', focus.dp_pa, u)}{' '}
            <span className="text-text-muted">{unitOf('pressure', u)}</span>
          </span>
        </div>
      ) : null}
    </div>
  )
}
