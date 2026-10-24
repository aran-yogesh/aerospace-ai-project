import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { DP_UNITS, errorTitle, FLOW_UNITS, type DpUnit, type FlowUnit } from '@/lib/format'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useSolve } from '@/workspace/SolveContext'

type Mode = 'dp' | 'flow'
const MODES = [
  { value: 'dp', label: 'ΔP from flow' },
  { value: 'flow', label: 'Flow from ΔP' }
] as const satisfies readonly { value: Mode; label: string }[]
const FLOW_OPTS = (Object.keys(FLOW_UNITS) as FlowUnit[]).map((v) => ({ value: v, label: v }))
const DP_OPTS = (Object.keys(DP_UNITS) as DpUnit[]).map((v) => ({ value: v, label: v }))

/** Top of the results strip: mode, input value + unit, SOLVE. Enter solves. */
export function SolveBar(): React.JSX.Element {
  const u = useUnits()
  const s = useSolve()
  const [mode, setMode] = useState<Mode>('dp')
  const [text, setText] = useState<Record<Mode, string>>({ dp: '', flow: '' })
  const [flowUnit, setFlowUnit] = useState<FlowUnit>(u === 'US' ? 'lbm/s' : 'kg/s')
  const [dpUnit, setDpUnit] = useState<DpUnit>(u === 'US' ? 'psi' : 'kPa')

  const raw = text[mode]
  const n = Number(raw)
  const valid = raw.trim() !== '' && Number.isFinite(n) && n > 0
  const blocked = s.solveBlocked
  const disabled = blocked !== null || s.solving
  const reason = blocked ?? (raw.trim() !== '' && !valid ? 'Enter a positive number' : null)

  const run = (): void => {
    if (disabled || !valid) return
    const value = mode === 'dp' ? n * FLOW_UNITS[flowUnit] : n * DP_UNITS[dpUnit]
    s.solve({ mode, value })
  }

  return (
    <div
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3"
      data-testid="solve-bar"
      data-blocked={blocked ?? ''}
    >
      <SegmentedControl
        label="Solve mode"
        value={mode}
        onValueChange={setMode}
        options={MODES}
        className="shrink-0 whitespace-nowrap"
      />
      <span className="mono-label text-text-muted">{mode === 'dp' ? 'Flow' : 'ΔP'}</span>
      <Input
        aria-label={mode === 'dp' ? 'Mass flow' : 'Pressure drop'}
        data-testid="solve-value"
        inputMode="decimal"
        placeholder={mode === 'dp' ? '0.2' : '50'}
        value={raw}
        disabled={blocked !== null}
        onChange={(e) => {
          const v = e.target.value
          setText((t) => ({ ...t, [mode]: v }))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') run()
        }}
        className={cn('h-6 w-24 px-2 num', raw.trim() !== '' && !valid && 'border-danger')}
      />
      {mode === 'dp' ? (
        <SegmentedControl
          label="Flow unit"
          value={flowUnit}
          onValueChange={setFlowUnit}
          options={FLOW_OPTS}
          className="shrink-0"
        />
      ) : (
        <SegmentedControl
          label="Pressure drop unit"
          value={dpUnit}
          onValueChange={setDpUnit}
          options={DP_OPTS}
          className="shrink-0"
        />
      )}
      <Button
        variant="primary"
        size="sm"
        data-testid="solve"
        disabled={disabled || !valid}
        onClick={run}
      >
        {s.solving ? 'Solving' : 'Solve'}
      </Button>
      <span
        data-testid="solve-reason"
        className={cn(
          'ml-auto min-w-0 truncate mono-label',
          s.solveError ? 'text-danger' : s.stale ? 'text-warning' : 'text-text-muted'
        )}
      >
        {s.solveError ? (s.solveError.detail ?? errorTitle(s.solveError.code)) : reason}
      </span>
    </div>
  )
}
