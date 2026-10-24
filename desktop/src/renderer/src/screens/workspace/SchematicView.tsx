import { useMemo } from 'react'
import { Callout } from '@/components/ui/callout'
import { orderedComponents, schematicLabel, withUnit } from '@/lib/format'
import type { SegmentResult } from '@/lib/apiTypes'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { Component, SystemGraph } from '@/types/geometry'
import { useSolve } from '@/workspace/SolveContext'
import { useWorkspace } from '@/workspace/WorkspaceContext'

const CELL = 96
const PAD_X = 56
const TOP = 40
const MID = 64 // y of the flow line
const HEIGHT = 136
const HEIGHT_SOLVED = 160 // room for the ΔP line

/** One symbol, centered at cx on the flow line. Lines run to the cell edges. */
function Symbol({ c, x }: { c: Component; x: number }): React.JSX.Element {
  const cx = x + CELL / 2
  const y = MID
  const lead = (from: number, to: number): React.JSX.Element => (
    <path d={`M${x} ${y}H${from}M${to} ${y}H${x + CELL}`} />
  )
  switch (c.type) {
    case 'pipe':
      return (
        <>
          <path d={`M${x} ${y}H${x + CELL}`} />
          <path d={`M${x + 8} ${y - 4}V${y + 4}M${x + CELL - 8} ${y - 4}V${y + 4}`} />
        </>
      )
    case 'bend':
      return (
        <>
          {lead(cx - 18, cx + 18)}
          <path d={`M${cx - 18} ${y}A18 18 0 0 1 ${cx + 18} ${y}`} />
        </>
      )
    case 'transition': {
      // Wide end on the larger diameter side.
      const big = 11
      const small = 5
      const [l, r] = c.d_in_m >= c.d_out_m ? [big, small] : [small, big]
      return (
        <>
          {lead(cx - 16, cx + 16)}
          <path d={`M${cx - 16} ${y - l}L${cx + 16} ${y - r}V${y + r}L${cx - 16} ${y + l}Z`} />
        </>
      )
    }
    case 'valve':
      return (
        <>
          {lead(cx - 16, cx + 16)}
          <path d={`M${cx - 16} ${y - 10}L${cx + 16} ${y + 10}V${y - 10}L${cx - 16} ${y + 10}Z`} />
        </>
      )
    case 'unclassified':
      return (
        <>
          {lead(cx - 16, cx + 16)}
          <rect x={cx - 16} y={y - 11} width={32} height={22} strokeDasharray="3 2" />
        </>
      )
  }
}

function Cell({
  c,
  index,
  seg,
  height
}: {
  c: Component
  index: number
  /** This component's solve result, when a solve has run. */
  seg: SegmentResult | undefined
  height: number
}): React.JSX.Element {
  const u = useUnits()
  const { selectedId, hoveredId, select, hover } = useWorkspace()
  const x = PAD_X + index * CELL
  const selected = selectedId === c.id
  const hovered = hoveredId === c.id
  const [kind, dim] = schematicLabel(c, u)
  return (
    <g
      data-testid="schematic-cell"
      data-component-id={c.id}
      role="button"
      aria-pressed={selected}
      aria-label={`${kind} ${dim}`}
      className="cursor-pointer"
      onClick={() => select(c.id, { fit: true })}
      onPointerEnter={() => hover(c.id)}
      onPointerLeave={() => hover(null)}
    >
      <rect
        x={x}
        y={TOP - 28}
        width={CELL}
        height={height - TOP + 28}
        className={cn(
          'transition-colors duration-120 ease-out',
          hovered && !selected ? 'fill-surface-raised' : 'fill-transparent'
        )}
      />
      <text
        x={x + CELL / 2}
        y={TOP - 12}
        textAnchor="middle"
        className={cn('mono-label tabular-nums', selected ? 'fill-text' : 'fill-text-muted')}
      >
        {String(index + 1).padStart(2, '0')}
      </text>
      <g
        fill="none"
        strokeWidth={selected ? 1.5 : 1}
        className={cn(
          'transition-colors duration-120 ease-out',
          selected ? 'stroke-accent' : 'stroke-text'
        )}
      >
        <Symbol c={c} x={x} />
      </g>
      <text x={x + CELL / 2} y={MID + 36} textAnchor="middle" className="mono-label fill-text">
        {kind}
      </text>
      <text
        x={x + CELL / 2}
        y={MID + 52}
        textAnchor="middle"
        className="mono-label fill-text-muted tabular-nums normal-case"
      >
        {dim}
      </text>
      {seg ? (
        <text
          x={x + CELL / 2}
          y={MID + 76}
          textAnchor="middle"
          data-testid="schematic-dp"
          className={cn('num text-label', selected ? 'fill-accent' : 'fill-text')}
        >
          ΔP {withUnit('pressure', seg.dp_pa, u)}
        </text>
      ) : null}
    </g>
  )
}

function Message({ title, text }: { title: string; text: string }): React.JSX.Element {
  return (
    <div className="flex w-[420px] flex-col items-start gap-3 border border-border bg-bg px-6 py-5">
      <Callout>{title}</Callout>
      <p className="text-body text-text-muted">{text}</p>
    </div>
  )
}

export function SchematicView({ graph }: { graph: SystemGraph | null }): React.JSX.Element {
  const components = useMemo(() => (graph ? orderedComponents(graph) : []), [graph])
  const { run } = useSolve()
  const segs = useMemo(
    () => new Map((run?.result.segments ?? []).map((s) => [s.component_id, s])),
    [run]
  )
  const height = run ? HEIGHT_SOLVED : HEIGHT

  if (!graph) {
    return <Message title="Schematic" text="The schematic appears once a model is parsed." />
  }
  if (graph.topology !== 'line' || !graph.ordered_path) {
    return (
      <div data-testid="schematic-network">
        <Message
          title={graph.topology === 'network' ? 'Network topology' : 'Disconnected geometry'}
          text="The schematic draws a single flow path. This system branches or has separate pieces, so its components are listed by type in the components pane instead."
        />
      </div>
    )
  }

  const width = PAD_X * 2 + components.length * CELL
  return (
    <div className="flex max-w-full overflow-x-auto px-6 py-px" data-testid="schematic">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0 border border-border bg-bg"
        shapeRendering="geometricPrecision"
      >
        {/* Inlet / outlet: flow arrows and labels (direction is assumed). */}
        <g className="stroke-text-muted" fill="none" strokeWidth={1}>
          <path
            d={`M16 ${MID}H${PAD_X}M${PAD_X - 8} ${MID - 4}L${PAD_X} ${MID}L${PAD_X - 8} ${MID + 4}`}
          />
          <path
            d={`M${width - PAD_X} ${MID}H${width - 16}M${width - 24} ${MID - 4}L${width - 16} ${MID}L${width - 24} ${MID + 4}`}
          />
        </g>
        <text x={16} y={MID + 36} className="mono-label fill-text-muted">
          In
        </text>
        <text x={width - 16} y={MID + 36} textAnchor="end" className="mono-label fill-text-muted">
          Out
        </text>
        {components.map((c, i) => (
          <Cell key={c.id} c={c} index={i} seg={segs.get(c.id)} height={height} />
        ))}
      </svg>
    </div>
  )
}
