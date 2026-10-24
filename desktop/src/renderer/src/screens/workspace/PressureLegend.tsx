import { qty, unitOf } from '@/lib/format'
import { useUnits } from '@/lib/units'
import type { PressureBins } from '@/workspace/pressure'

const SWATCH = [
  'bg-pressure-1',
  'bg-pressure-2',
  'bg-pressure-3',
  'bg-pressure-4',
  'bg-pressure-5'
] as const

/** Viewer-corner legend for PRESSURE coloring: 5 steps, min and max component ΔP. */
export function PressureLegend({ bins }: { bins: PressureBins }): React.JSX.Element {
  const u = useUnits()
  return (
    <div
      data-testid="pressure-legend"
      className="pointer-events-none absolute right-3 bottom-3 flex flex-col gap-1 border border-border bg-bg px-2 py-1.5"
    >
      <span className="mono-label text-text-muted">
        Component ΔP · <span className="normal-case">{unitOf('pressure', u)}</span>
      </span>
      <span className="flex">
        {SWATCH.map((c) => (
          <span key={c} className={`h-2 w-7 ${c}`} />
        ))}
      </span>
      <span className="flex justify-between gap-4 num text-label text-text">
        <span>{qty('pressure', bins.min, u)}</span>
        <span>{qty('pressure', bins.max, u)}</span>
      </span>
    </div>
  )
}
