import { useEffect, useMemo } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { componentDims, errorTitle, kCountsText, kValue, MATCH_LABEL } from '@/lib/format'
import type { KOverride, KRow } from '@/lib/apiTypes'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'
import { ComponentGlyph } from '@/workspace/ComponentGlyph'
import { toSetupIn, useSolve } from '@/workspace/SolveContext'
import { useWorkspace } from '@/workspace/WorkspaceContext'
import { NumberField, SourceTag } from './fields'

/** Callout variant per match: family or unverified table values are approximate. */
export function matchVariant(
  match: KRow['match'],
  verified?: boolean | null
): 'default' | 'approximate' | 'selected' | 'danger' {
  if (match === 'missing') return 'danger'
  if (match === 'user') return 'selected'
  if (match === 'family' || verified === false) return 'approximate'
  return 'default'
}

export function MatchTag({
  match,
  verified
}: {
  match: KRow['match']
  verified?: boolean | null
}): React.JSX.Element {
  const approx = match !== 'family' && match !== 'missing' && verified === false
  return (
    <Callout
      variant={matchVariant(match, verified)}
      data-testid="match-tag"
      data-match={match}
      className="h-5 px-1.5"
    >
      {approx ? 'APPROX' : MATCH_LABEL[match]}
    </Callout>
  )
}

function Row({ row, index }: { row: KRow; index: number }): React.JSX.Element {
  const u = useUnits()
  const s = useSolve()
  const { selectedId, hoveredId, select, hover } = useWorkspace()
  const comp = s.graph?.components.find((c) => c.id === row.component_id)
  const selected = selectedId === row.component_id
  const hovered = hoveredId === row.component_id
  const setup = s.setup
  const override = setup?.k_overrides[row.component_id]
  const editable = row.match === 'missing' || row.match === 'user'
  const noLoss = override === 'no_loss'

  const setOverride = (next: KOverride | 'no_loss' | null): void => {
    if (!setup) return
    const base = toSetupIn(setup)
    const k_overrides = { ...base.k_overrides }
    if (next === null) delete k_overrides[row.component_id]
    else k_overrides[row.component_id] = next
    s.saveSetup({ ...base, k_overrides })
  }

  return (
    <li
      data-testid="confirm-row"
      data-component-id={row.component_id}
      data-match={row.match}
      onPointerEnter={() => hover(row.component_id)}
      onPointerLeave={() => hover(null)}
      onClick={() => select(row.component_id, { fit: true })}
      className={cn(
        'flex cursor-pointer flex-col gap-1.5 border-b border-l-2 border-b-border py-2 pr-3 pl-2.5',
        'transition-colors duration-120 ease-out',
        row.match === 'missing'
          ? 'border-l-danger'
          : selected
            ? 'border-l-accent'
            : 'border-l-transparent',
        (selected || hovered) && 'bg-surface-raised'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="w-5 shrink-0 num text-label text-text-muted">
          {String(index + 1).padStart(2, '0')}
        </span>
        <ComponentGlyph type={row.type} className={selected ? 'text-text' : undefined} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate mono-label text-text">{row.label}</span>
          <span className="truncate num text-label text-text-muted">
            {comp ? componentDims(comp, u) : '—'}
          </span>
        </span>
        <span
          className={cn(
            'w-14 shrink-0 text-right num',
            row.match === 'missing' ? 'text-danger' : 'text-text'
          )}
          data-testid="confirm-k"
        >
          {row.type === 'pipe' ? 'f·L/D' : kValue(row.k)}
        </span>
        <span className="flex w-[120px] shrink-0 justify-start overflow-hidden">
          {/* Pipes: the method (friction is computed at solve time) is the useful part. */}
          <SourceTag
            source={row.type === 'pipe' ? row.method : (row.source ?? row.method)}
            title={[row.method, row.source].filter(Boolean).join(' · ')}
          />
        </span>
        <span className="flex w-[72px] shrink-0 justify-end pl-2">
          <MatchTag match={row.match} verified={row.verified} />
        </span>
      </div>
      {editable ? (
        <div
          className="flex items-center gap-2 pl-7"
          onClick={(e) => e.stopPropagation()}
          data-testid="k-entry"
        >
          <label className="mono-label text-text-muted" htmlFor={`k-${row.component_id}`}>
            K
          </label>
          <NumberField
            id={`k-${row.component_id}`}
            data-testid="k-input"
            className={cn('h-6 w-24 px-2', row.match === 'missing' && 'border-danger')}
            placeholder="Enter K"
            disabled={noLoss}
            value={override && override !== 'no_loss' ? override.value : null}
            onCommit={(n) => {
              if (n >= 0) setOverride({ value: n, note: null })
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            data-testid="no-loss"
            aria-pressed={noLoss}
            className={cn(noLoss && 'border-text bg-surface-raised')}
            onClick={() => setOverride(noLoss ? null : 'no_loss')}
          >
            No loss
          </Button>
          {row.note ? (
            <span className="truncate text-body text-text-muted" title={row.note}>
              {row.note}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/**
 * CONFIRM DATASET: a full-height sheet on the right, over the chat pane. Lists every
 * component in path order with its resolved K, source and match; missing Ks are entered
 * inline. Not modal: hovering a row highlights the part in 3D, clicking selects it.
 */
export function ConfirmSheet(): React.JSX.Element | null {
  const s = useSolve()
  const rows = useMemo(() => s.resolved?.rows ?? [], [s.resolved])
  const counts = s.resolved?.counts
  const close = s.closeConfirm
  const open = s.confirmOpen

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !(e.target as HTMLElement | null)?.closest('input')) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null
  const missing = counts?.missing ?? 0
  const busy = s.resolving || s.saving || s.confirming
  const reason = !counts
    ? 'Resolving'
    : missing > 0
      ? `${missing} missing K · enter a value or mark no loss`
      : null

  return (
    <aside
      role="dialog"
      aria-modal={false}
      aria-label="Confirm dataset"
      data-testid="confirm-sheet"
      className="absolute inset-y-0 right-0 z-20 flex w-[600px] max-w-full animate-fade-in flex-col border-l border-border bg-surface"
    >
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border pr-1 pl-3">
        <h2 className="mono-label text-text" data-testid="confirm-title">
          Confirm dataset · <span className="tabular-nums">{rows.length || '…'}</span> components
        </h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}>
          <X />
        </Button>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-border py-1 pr-3 pl-2.5 mono-label text-text-muted">
        <span className="w-5">#</span>
        <span className="w-4" />
        <span className="flex-1">Component</span>
        <span className="w-14 text-right">K</span>
        <span className="w-[120px]">Source</span>
        <span className="w-[72px] text-right">Match</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto" data-testid="confirm-rows">
        {rows.map((r, i) => (
          <Row key={r.component_id} row={r} index={i} />
        ))}
      </ul>
      <div className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-3">
        {s.confirmError ? (
          <p role="alert" className="text-body text-danger">
            {s.confirmError.detail ?? errorTitle(s.confirmError.code)}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span
            data-testid="confirm-counts"
            className={cn('mono-label tabular-nums', missing > 0 ? 'text-danger' : 'text-text')}
          >
            {counts ? kCountsText(counts) : 'Resolving'}
          </span>
          <Button
            variant="primary"
            data-testid="confirm"
            disabled={reason !== null || busy}
            onClick={() => s.confirm()}
          >
            {s.confirming ? 'Confirming' : 'Confirm'}
          </Button>
        </div>
        {reason && counts ? (
          <span className="self-end mono-label text-text-muted" data-testid="confirm-reason">
            {reason}
          </span>
        ) : null}
      </div>
    </aside>
  )
}
