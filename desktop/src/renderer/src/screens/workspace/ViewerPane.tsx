import { useCallback, useMemo, useRef, useState } from 'react'
import { Callout } from '@/components/ui/callout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { calloutText } from '@/lib/format'
import { useUnits } from '@/lib/units'
import { useTheme } from '@/theme/useTheme'
import type { SystemGraph } from '@/types/geometry'
import { Viewer3D, type MeshShapes } from '@/viewer'
import { useSolve } from '@/workspace/SolveContext'
import { useWorkspace } from '@/workspace/WorkspaceContext'
import { DpPlot } from './DpPlot'
import { DropzoneStage } from './DropzoneStage'
import { PressureLegend } from './PressureLegend'
import { SchematicView } from './SchematicView'
import { FailedStage, ParsingStage, UploadingStage } from './ViewerStages'

export type ViewerStage =
  | { kind: 'empty' }
  | { kind: 'uploading'; filename: string; size: number; progress: number }
  | { kind: 'parsing'; label: string; filename: string | null }
  | {
      kind: 'failed'
      title: string
      code: string
      detail: string | null
      filename: string | null
      canRetry: boolean
    }
  | { kind: 'model'; mesh: MeshShapes; graph: SystemGraph }

const VIEWS = [
  { value: '3d', label: '3D' },
  { value: 'schematic', label: 'Schematic' },
  { value: 'dp', label: 'ΔP plot' }
] as const
type View = (typeof VIEWS)[number]['value']

function hasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files')
}

function ModelView({
  mesh,
  graph,
  onViewerError
}: {
  mesh: MeshShapes
  graph: SystemGraph
  onViewerError: (err: Error) => void
}): React.JSX.Element {
  const { resolved } = useTheme()
  const u = useUnits()
  const { selectedId, hoveredId, select, hover, registerViewer } = useWorkspace()
  const { bins, pressureOn, setPressureOn } = useSolve()
  const byId = useMemo(() => new Map(graph.components.map((c) => [c.id, c])), [graph])
  const text = useCallback(
    (id: string) => {
      const c = byId.get(id)
      return c ? calloutText(c, u) : null
    },
    [byId, u]
  )
  const coloring = pressureOn && bins !== null
  return (
    <Viewer3D
      shapes={mesh}
      theme={resolved}
      selectedId={selectedId}
      hoveredId={hoveredId}
      onSelect={(id) => select(id)}
      onHover={hover}
      calloutText={text}
      onReady={registerViewer}
      onError={onViewerError}
      colorMap={coloring ? bins.colors : null}
      pressure={{ on: coloring, onToggle: () => setPressureOn(!pressureOn), disabled: !bins }}
    >
      {coloring ? <PressureLegend bins={bins} /> : null}
    </Viewer3D>
  )
}

function DpTab(): React.JSX.Element {
  const { run } = useSolve()
  const result = run?.result
  if (result?.status === 'complete') return <DpPlot result={result} />
  return (
    <div
      data-testid="dp-placeholder"
      className="flex w-[360px] flex-col items-start gap-3 border border-border bg-bg px-6 py-5"
    >
      <Callout variant={result ? 'danger' : 'default'}>
        {result ? 'Solve incomplete' : 'Available after solve'}
      </Callout>
      <p className="text-body text-text-muted">
        {result
          ? 'The plot needs a complete solve. Resolve the missing loss coefficients and solve again.'
          : 'Pressure drop along the flow path is plotted here once a solve has run.'}
      </p>
    </div>
  )
}

export function ViewerPane({
  stage,
  graph,
  onFile,
  onRetry,
  onViewerError
}: {
  stage: ViewerStage
  /** The parsed graph, if any (schematic tab). */
  graph: SystemGraph | null
  onFile: (file: File) => void
  onRetry: () => void
  onViewerError: (err: Error) => void
}): React.JSX.Element {
  const [view, setView] = useState<View>('3d')
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const browse = (): void => input.current?.click()
  const busy = stage.kind === 'uploading'

  const dragProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current += 1
      setDragging(true)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = busy ? 'none' : 'copy'
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file && !busy) {
        setView('3d')
        onFile(file)
      }
    }
  }

  let stageNode: React.ReactNode
  switch (stage.kind) {
    case 'empty':
      stageNode = <DropzoneStage onBrowse={browse} dragging={dragging} />
      break
    case 'uploading':
      stageNode = (
        <UploadingStage filename={stage.filename} size={stage.size} progress={stage.progress} />
      )
      break
    case 'parsing':
      stageNode = <ParsingStage label={stage.label} filename={stage.filename} />
      break
    case 'failed':
      stageNode = (
        <FailedStage
          title={stage.title}
          code={stage.code}
          detail={stage.detail}
          filename={stage.filename}
          onRetry={stage.canRetry ? onRetry : undefined}
          onBrowse={browse}
        />
      )
      break
    case 'model':
      stageNode = <ModelView mesh={stage.mesh} graph={stage.graph} onViewerError={onViewerError} />
      break
  }

  // Over a loaded model (or another state) the whole viewer becomes the drop target.
  const dropOverlay =
    dragging && stage.kind !== 'empty' && !busy ? (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center border border-dashed border-accent"
      >
        <Callout variant="filled">Release to upload</Callout>
      </div>
    ) : null

  return (
    <Tabs
      value={view}
      onValueChange={(v) => setView(v as View)}
      className="flex h-full flex-col bg-bg"
      data-testid="viewer-pane"
      {...dragProps}
    >
      <TabsList aria-label="Viewer">
        {VIEWS.map((v) => (
          <TabsTrigger key={v.value} value={v.value} data-testid={`tab-${v.value}`}>
            {v.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <input
        ref={input}
        type="file"
        accept=".step,.stp,.STEP,.STP"
        className="hidden"
        data-testid="browse-input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // allow picking the same file again
          if (file) onFile(file)
        }}
      />
      <TabsContent
        value="3d"
        forceMount
        className="halftone relative flex items-center justify-center overflow-hidden data-[state=inactive]:hidden"
      >
        {stageNode}
        {dropOverlay}
      </TabsContent>
      <TabsContent
        value="schematic"
        className="halftone relative flex items-center justify-center overflow-hidden"
      >
        <SchematicView graph={graph} />
        {dropOverlay}
      </TabsContent>
      <TabsContent
        value="dp"
        className="halftone relative flex items-center justify-center overflow-hidden"
      >
        <DpTab />
        {dropOverlay}
      </TabsContent>
    </Tabs>
  )
}
