import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/*
 * Callout: the signature element. A boxed mono uppercase label with a 6x6 solid accent
 * square attached to its left edge, like a callout on an engineering drawing.
 * Pair with <LeaderLines> to draw 1px accent leader lines to a target point.
 */
const calloutVariants = cva(
  [
    'relative inline-flex h-6 items-center border px-2 mono-label whitespace-nowrap',
    // The 6x6 accent marker, flush against the left edge, vertically centered.
    "before:absolute before:top-1/2 before:-left-[7px] before:size-1.5 before:-translate-y-1/2 before:bg-accent before:content-['']"
  ],
  {
    variants: {
      variant: {
        default: 'border-border bg-bg text-text',
        selected: 'border-accent bg-bg text-text',
        approximate: 'border-dashed border-accent bg-bg text-text',
        filled: 'border-accent bg-accent text-on-accent',
        // Status variants recolor the marker too, so they never read as a selection.
        warning: 'border-warning bg-bg text-warning before:bg-warning',
        danger: 'border-danger bg-bg text-danger before:bg-danger'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

export interface CalloutProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof calloutVariants> {}

export const Callout = React.forwardRef<HTMLSpanElement, CalloutProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(calloutVariants({ variant }), className)} {...props} />
  )
)
Callout.displayName = 'Callout'

export interface LeaderLine {
  /** Polyline points in the SVG's coordinate space; the last point is the target. */
  points: readonly (readonly [number, number])[]
}

/**
 * 1px accent leader lines (stroke = currentColor = var(--accent)), each ending in a
 * small square terminal at its target. Absolutely fills its positioned parent.
 */
export function LeaderLines({
  width,
  height,
  lines,
  className
}: {
  width: number
  height: number
  lines: readonly LeaderLine[]
  className?: string
}): React.JSX.Element {
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('pointer-events-none absolute inset-0 text-accent', className)}
      shapeRendering="crispEdges"
    >
      {lines.map((line, i) => {
        const target = line.points[line.points.length - 1]
        return (
          <g key={i}>
            <polyline
              points={line.points.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              shapeRendering={line.points.length > 2 ? 'geometricPrecision' : 'crispEdges'}
            />
            {target ? (
              <rect x={target[0] - 2} y={target[1] - 2} width={4} height={4} fill="currentColor" />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

export { calloutVariants }
