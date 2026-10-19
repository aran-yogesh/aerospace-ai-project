import { Fragment, useEffect, useMemo, useRef } from 'react'
import { TriangleAlert } from 'lucide-react'
import { PanelHeader } from '@/components/ui/panel-header'
import { componentDims, orderedComponents, TYPE_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Component, SystemGraph } from '@/types/geometry'
import { ComponentGlyph } from '@/workspace/ComponentGlyph'
import { useWorkspace } from '@/workspace/WorkspaceContext'
import { deriveWarnings, type GraphWarning } from '@/workspace/warnings'

const SEGMENTS = 5

/** Confidence 0..1 as a 5-segment bar. */
function ConfidenceBar({ value }: { value: number }): React.JSX.Element {
  const filled = Math.max(0, Math.min(SEGMENTS, Math.round(value * SEGMENTS)))
  return (
    <span
      role="img"
      aria-label={`Confidence ${Math.round(value * 100)}%`}
      title={`Confidence ${Math.round(value * 100)}%`}
      className="flex shrink-0 items-center gap-px"
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span key={i} className={cn('h-2 w-1', i < filled ? 'bg-text-muted' : 'bg-border')} />
      ))}
    </span>
  )
}

function WarningsBlock({ warnings }: { warnings: GraphWarning[] }): React.JSX.Element {
  const { select } = useWorkspace()
  const cursor = useRef(new Map<string, number>())
  return (
    <div
      className="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-3"
      data-testid="warnings"
    >
      {warnings.map((w) => {
        const clickable = w.targets.length > 0
        const onClick = (): void => {
          const i = cursor.current.get(w.key) ?? 0
          cursor.current.set(w.key, (i + 1) % w.targets.length)
          select(w.targets[i] ?? null, { fit: true })
        }
        return (
          <button
            key={w.key}
            type="button"
            disabled={!clickable}
            onClick={clickable ? onClick : undefined}
            className={cn(
              'flex min-h-6 w-full items-start gap-2 border border-warning px-2 py-1 text-left',
              'mono-label text-warning transition-colors duration-120 ease-out',
              clickable ? 'hover:bg-surface-raised' : 'cursor-default'
            )}
          >
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" strokeWidth={1.5} />
            <span className="min-w-0 break-words">{w.text}</span>
          </button>
        )
      })}
    </div>
  )
}

function Row({ c }: { c: Component }): React.JSX.Element {
  const { selectedId, hoveredId, select, hover } = useWorkspace()
  const ref = useRef<HTMLButtonElement>(null)
  const selected = selectedId === c.id
  const hovered = hoveredId === c.id

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <li>
      <button
        ref={ref}
        type="button"
        data-testid="component-row"
        data-component-id={c.id}
        aria-pressed={selected}
        title={c.type === 'unclassified' ? `${c.name}: ${c.reason}` : undefined}
        onClick={() => select(c.id, { fit: true })}
        onPointerEnter={() => hover(c.id)}
        onPointerLeave={() => hover(null)}
        className={cn(
          'flex w-full items-center gap-2 border-l-2 py-1.5 pr-3 pl-2.5 text-left',
          'transition-colors duration-120 ease-out',
          selected
            ? 'border-accent bg-surface-raised text-text'
            : hovered
              ? 'border-transparent bg-surface-raised text-text'
              : 'border-transparent text-text-muted'
        )}
      >
        <ComponentGlyph type={c.type} className={selected ? 'text-text' : undefined} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="mono-label text-text">{TYPE_LABEL[c.type]}</span>
          <span className="truncate num text-label text-text-muted">{componentDims(c)}</span>
        </span>
        <ConfidenceBar value={c.confidence} />
      </button>
    </li>
  )
}

function Empty({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-start px-3 py-3">
      <p className="text-body text-text-muted">{text}</p>
    </div>
  )
}

export function ComponentsPane({
  graph,
  emptyText
}: {
  graph: SystemGraph | null
  /** Shown while there is no graph (no file yet, parsing, failed). */
  emptyText: string
}): React.JSX.Element {
  const components = useMemo(() => (graph ? orderedComponents(graph) : []), [graph])
  const warnings = useMemo(() => (graph ? deriveWarnings(graph) : []), [graph])
  const grouped = graph !== null && !(graph.topology === 'line' && graph.ordered_path)

  return (
    <section aria-label="Components" className="flex h-full flex-col bg-surface">
      <PanelHeader
        label={
          graph ? (
            <>
              Components <span className="text-text-muted">·</span>{' '}
              <span className="tabular-nums" data-testid="component-count">
                {graph.components.length}
              </span>
            </>
          ) : (
            'Components'
          )
        }
      />
      {graph ? (
        <>
          {warnings.length > 0 ? <WarningsBlock warnings={warnings} /> : null}
          <ul className="min-h-0 flex-1 overflow-auto py-1" data-testid="component-list">
            {components.map((c, i) => {
              const header = grouped && (i === 0 || components[i - 1]?.type !== c.type)
              return (
                <Fragment key={c.id}>
                  {header ? (
                    <li
                      aria-hidden
                      className="px-3 pt-2 pb-1 mono-label text-text-muted first:pt-1"
                    >
                      {TYPE_LABEL[c.type]}
                    </li>
                  ) : null}
                  <Row c={c} />
                </Fragment>
              )
            })}
          </ul>
        </>
      ) : (
        <Empty text={emptyText} />
      )}
    </section>
  )
}
