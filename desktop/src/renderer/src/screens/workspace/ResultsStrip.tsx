import { useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  TriangleAlert
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { PanelHeader } from '@/components/ui/panel-header'
import {
  friction,
  kValue,
  percent,
  qty,
  reynolds,
  TYPE_LABEL,
  unitOf,
  withUnit
} from '@/lib/format'
import type { Dataset, SegmentResult, SolveRun } from '@/lib/apiTypes'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useSolve } from '@/workspace/SolveContext'
import { useWorkspace } from '@/workspace/WorkspaceContext'
import { MatchTag } from './ConfirmSheet'
import { SolveBar } from './SolveBar'

type Labels = Map<string, string>

const REGIME_SHORT = { laminar: 'Lam', transitional: 'Trans', turbulent: 'Turb' } as const

function labelOf(labels: Labels, s: { component_id: string; type: SegmentResult['type'] }): string {
  return labels.get(s.component_id) ?? TYPE_LABEL[s.type]
}

function Hero({ run, labels }: { run: SolveRun; labels: Labels }): React.JSX.Element {
  const u = useUnits()
  const r = run.result
  const complete = r.status === 'complete'
  const flowMode = r.mode === 'flow'
  const value = flowMode
    ? complete
      ? qty('flow', r.mdot_kg_s, u, 4)
      : '—'
    : complete
      ? qty('pressure', r.total_dp_pa, u, 4)
      : '—'
  const missing = r.missing.map((id) => labels.get(id) ?? id)
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-3 pt-3 pb-2"
      data-testid="results-hero"
      data-status={r.status}
    >
      <span className="flex items-baseline gap-2">
        <span className="mono-label text-text-muted">{flowMode ? 'Mass flow' : 'Total ΔP'}</span>
        <span
          className="font-mono text-[32px] leading-none font-medium text-text tabular-nums"
          data-testid="results-total"
        >
          {value}
        </span>
        <span className="num text-text-muted">{unitOf(flowMode ? 'flow' : 'pressure', u)}</span>
      </span>
      <span className="num text-label text-text-muted">
        {flowMode
          ? `AT ΔP ${withUnit('pressure', run.input_value, u)}`
          : `AT ${withUnit('flow', run.input_value, u)}`}
      </span>
      {complete ? (
        <Callout data-testid="results-status" className="ml-1.5">
          Complete
        </Callout>
      ) : (
        <Callout
          variant="danger"
          data-testid="results-status"
          className="ml-1.5 h-auto min-h-6 py-0.5 whitespace-normal"
          title={missing.join(', ')}
        >
          Incomplete · K missing: {missing.join(', ')}
        </Callout>
      )}
    </div>
  )
}

interface WarningGroup {
  text: string
  targets: string[]
}

function Warnings({ run, labels }: { run: SolveRun; labels: Labels }): React.JSX.Element | null {
  const { select } = useWorkspace()
  const cursor = useRef(new Map<string, number>())
  const groups = useMemo(() => {
    const map = new Map<string, WarningGroup>()
    for (const s of run.result.segments) {
      for (const w of s.warnings) {
        const g = map.get(w) ?? { text: w, targets: [] }
        g.targets.push(s.component_id)
        map.set(w, g)
      }
    }
    for (const w of run.result.warnings) if (!map.has(w)) map.set(w, { text: w, targets: [] })
    return [...map.values()]
  }, [run])
  if (groups.length === 0) return null
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-3" data-testid="results-warnings">
      {groups.map((g) => {
        const n = g.targets.length
        const suffix =
          n === 0 ? '' : n === 1 ? ` · ${labels.get(g.targets[0] ?? '') ?? ''}` : ` · ${n} parts`
        return (
          <button
            key={g.text}
            type="button"
            disabled={n === 0}
            onClick={() => {
              const i = cursor.current.get(g.text) ?? 0
              cursor.current.set(g.text, (i + 1) % n)
              select(g.targets[i] ?? null, { fit: true })
            }}
            className={cn(
              'inline-flex h-6 items-center gap-1.5 border border-warning bg-bg px-2 mono-label text-warning',
              'transition-colors duration-120 ease-out',
              n > 0 ? 'hover:bg-surface-raised' : 'cursor-default'
            )}
          >
            <TriangleAlert aria-hidden className="size-3.5" strokeWidth={1.5} />
            {g.text}
            {suffix}
          </button>
        )
      })}
    </div>
  )
}

function SegmentTable({ run, labels }: { run: SolveRun; labels: Labels }): React.JSX.Element {
  const u = useUnits()
  const { selectedId, hoveredId, select, hover } = useWorkspace()
  const [byDp, setByDp] = useState(false)
  const r = run.result
  const total = r.total_dp_pa ?? r.segments.reduce((a, s) => a + (s.dp_pa ?? 0), 0)
  const largest = r.segments.reduce<SegmentResult | null>(
    (best, s) => ((s.dp_pa ?? -1) > (best?.dp_pa ?? -1) ? s : best),
    null
  )
  const indexed = r.segments.map((s, i) => ({ s, i }))
  const rows = byDp ? [...indexed].sort((a, b) => (b.s.dp_pa ?? -1) - (a.s.dp_pa ?? -1)) : indexed
  const th = 'px-1.5 py-1 text-right font-medium whitespace-nowrap'
  const thl = 'px-1.5 py-1 text-left font-medium whitespace-nowrap'
  return (
    <table className="w-full border-collapse" data-testid="results-table">
      <thead className="bg-surface">
        <tr className="mono-label text-text-muted">
          <th className="w-8 py-1 pr-2 pl-3 text-left font-medium">#</th>
          <th className={thl}>Component</th>
          <th className={th}>
            D <span className="normal-case">{unitOf('diameter', u)}</span>
          </th>
          <th className={th}>
            V <span className="normal-case">{unitOf('velocity', u)}</span>
          </th>
          <th className={th}>Re</th>
          <th className={thl}>Regime</th>
          <th className={th}>f</th>
          <th className={th}>K</th>
          <th className={thl}>K source</th>
          <th className={th}>
            <button
              type="button"
              data-testid="sort-dp"
              aria-pressed={byDp}
              onClick={() => setByDp((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1 transition-colors duration-120 ease-out hover:text-text',
                byDp && 'text-text'
              )}
            >
              ΔP <span className="normal-case">{unitOf('pressure', u)}</span>
              <ArrowDown
                aria-hidden
                className={cn('size-3', byDp ? 'opacity-100' : 'opacity-40')}
                strokeWidth={1.5}
              />
            </button>
          </th>
          <th className={cn(th, 'pr-3')}>%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ s, i }) => {
          const selected = selectedId === s.component_id
          const hovered = hoveredId === s.component_id
          const top = largest?.component_id === s.component_id && (s.dp_pa ?? 0) > 0
          return (
            <tr
              key={s.component_id}
              data-testid="results-row"
              data-component-id={s.component_id}
              data-largest={top || undefined}
              aria-selected={selected}
              onClick={() => select(s.component_id, { fit: true })}
              onPointerEnter={() => hover(s.component_id)}
              onPointerLeave={() => hover(null)}
              className={cn(
                'cursor-pointer border-t border-border font-mono text-[12px] leading-5 tabular-nums transition-colors duration-120 ease-out',
                selected || hovered ? 'bg-surface-raised text-text' : 'text-text'
              )}
            >
              <td
                className={cn(
                  'border-l-2 py-1 pr-2 pl-2.5',
                  top ? 'border-l-accent' : 'border-l-transparent',
                  selected ? 'text-accent' : 'text-text-muted'
                )}
              >
                {String(i + 1).padStart(2, '0')}
              </td>
              <td
                className="max-w-[200px] truncate px-1.5 py-1 mono-label"
                title={labelOf(labels, s)}
              >
                {labelOf(labels, s)}
              </td>
              <td className="px-1.5 py-1 text-right">{qty('diameter', s.d_m, u)}</td>
              <td className="px-1.5 py-1 text-right">{qty('velocity', s.velocity_m_s, u)}</td>
              <td className="px-1.5 py-1 text-right">{reynolds(s.re)}</td>
              <td className="px-1.5 py-1 mono-label text-text-muted" title={s.regime ?? undefined}>
                {s.regime ? REGIME_SHORT[s.regime] : '—'}
              </td>
              <td className="px-1.5 py-1 text-right">{friction(s.f)}</td>
              <td className="px-1.5 py-1 text-right">{s.type === 'pipe' ? '—' : kValue(s.k)}</td>
              <td className="py-1 pr-1.5 pl-3" title={s.k_source ?? undefined}>
                {s.k_match ? (
                  <MatchTag match={s.k_match} />
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </td>
              <td className="px-1.5 py-1 text-right" data-testid="results-dp">
                {qty('pressure', s.dp_pa, u)}
              </td>
              <td className="py-1 pr-3 pl-2 text-right text-text-muted">
                {s.dp_pa != null ? percent(s.dp_pa, total) : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Provenance({
  run,
  dataset
}: {
  run: SolveRun
  dataset: Dataset | undefined
}): React.JSX.Element {
  const cv = dataset?.constants_versions
  const parts = [
    `Dataset ${dataset?.short_hash ?? run.dataset_id.slice(0, 4)}`,
    `Solver ${run.result.solver_version}`,
    cv ? `K-values ${cv.k_values}` : null,
    cv ? `Materials ${cv.materials}` : null,
    cv ? `Fluids ${cv.fluids}` : null,
    dataset ? `${dataset.fluid_props.name}: ${dataset.fluid_props.density_kg_m3.source}` : null,
    dataset ? `Roughness: ${dataset.roughness.source}` : null,
    `${run.runtime_ms.toFixed(1)} ms`
  ].filter(Boolean)
  const text = parts.join(' · ')
  return (
    <p
      title={text}
      data-testid="results-provenance"
      className="shrink-0 truncate border-t border-border px-3 py-1.5 mono-label text-text-muted tabular-nums"
    >
      {text}
    </p>
  )
}

function Body(): React.JSX.Element {
  const s = useSolve()
  const run = s.run
  const labels = useMemo<Labels>(
    () => new Map((s.dataset?.resolved_k ?? []).map((k) => [k.component_id, k.label])),
    [s.dataset]
  )
  if (!run) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-body text-text-muted">Run a solve to see pressure drop</p>
      </div>
    )
  }
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="results">
        <Hero run={run} labels={labels} />
        <Warnings run={run} labels={labels} />
        <div className="pt-2">
          <SegmentTable run={run} labels={labels} />
        </div>
      </div>
      <Provenance run={run} dataset={s.dataset} />
    </>
  )
}

export function ResultsStrip({
  collapsed,
  maximized,
  onToggle,
  onMaximize
}: {
  collapsed: boolean
  /** At its 50% maximum height. */
  maximized: boolean
  onToggle: () => void
  onMaximize: () => void
}): React.JSX.Element {
  return (
    <section aria-label="Results" className="flex h-full flex-col bg-surface">
      <PanelHeader
        label="Results"
        className={collapsed ? 'border-b-0' : undefined}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="results-maximize"
              aria-label={maximized ? 'Restore results height' : 'Expand results to half height'}
              aria-pressed={maximized}
              onClick={onMaximize}
            >
              {maximized ? <Minimize2 /> : <Maximize2 />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={collapsed ? 'Expand results' : 'Collapse results'}
              aria-expanded={!collapsed}
              onClick={onToggle}
            >
              {collapsed ? <ChevronUp /> : <ChevronDown />}
            </Button>
          </>
        }
      />
      {collapsed ? null : (
        <>
          <SolveBar />
          <Body />
        </>
      )}
    </section>
  )
}
