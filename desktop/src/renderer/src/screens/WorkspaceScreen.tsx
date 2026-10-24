import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePanelRef } from 'react-resizable-panels'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '@/components/ui/resizable'
import { api, ApiError, uploadFile, type UploadHandle } from '@/lib/api'
import type { ProjectDetail } from '@/lib/apiTypes'
import { errorTitle, plural, seconds } from '@/lib/format'
import { fileKey, useFileStatus } from '@/workspace/useFileStatus'
import { SolveProvider, useSolveState } from '@/workspace/SolveContext'
import { WorkspaceProvider } from '@/workspace/WorkspaceContext'
import { ChatPane } from './workspace/ChatPane'
import { ComponentsPane } from './workspace/ComponentsPane'
import { ConfirmSheet } from './workspace/ConfirmSheet'
import { ResultsStrip } from './workspace/ResultsStrip'
import { ViewerPane, type ViewerStage } from './workspace/ViewerPane'

const RESULTS_HEADER_PX = 32
const RESULTS_DEFAULT = '120px'
const RESULTS_MAX = '50%'
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const STEP_EXT = /\.(step|stp)$/i

export interface ParserStatus {
  text: string
  tone: 'muted' | 'ok' | 'danger' | 'warning'
}

type Upload =
  | { phase: 'uploading'; file: File; progress: number }
  | { phase: 'error'; file: File; error: ApiError }

function asApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  return new ApiError(0, 'unexpected_error', err instanceof Error ? err.message : String(err))
}

/** Client-side checks mirroring the server's, so obvious mistakes fail instantly. */
function precheck(file: File): ApiError | null {
  if (!STEP_EXT.test(file.name)) {
    return new ApiError(415, 'unsupported_file_type', 'Only .step and .stp files are supported.')
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return new ApiError(413, 'file_too_large', 'The upload limit is 50 MB.')
  }
  return null
}

export function WorkspaceScreen({
  project,
  onParserStatus,
  onDatasetStatus
}: {
  project: ProjectDetail
  onParserStatus: (status: ParserStatus | null) => void
  /** "DATASET 3F2A · CONFIRMED" in the status bar. */
  onDatasetStatus: (status: ParserStatus | null) => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const resultsRef = usePanelRef()
  const [resultsCollapsed, setResultsCollapsed] = useState(false)
  const [resultsMax, setResultsMax] = useState(false)
  const [activeFileId, setActiveFileId] = useState<string | null>(project.latest_file?.id ?? null)
  const [upload, setUpload] = useState<Upload | null>(null)
  const [viewerError, setViewerError] = useState<Error | null>(null)
  const [lastFile, setLastFile] = useState<File | null>(null)
  const handle = useRef<UploadHandle | null>(null)

  useEffect(() => () => handle.current?.abort(), [])

  const fileQ = useFileStatus(activeFileId)
  const file = fileQ.data
  const parsed = file?.status === 'parsed'
  const graphQ = useQuery({
    queryKey: ['graph', activeFileId],
    queryFn: () => api.getGraph(activeFileId ?? ''),
    enabled: parsed && activeFileId !== null,
    staleTime: Infinity
  })
  const meshQ = useQuery({
    queryKey: ['mesh', activeFileId],
    queryFn: () => api.getMesh(activeFileId ?? ''),
    enabled: parsed && activeFileId !== null,
    staleTime: Infinity,
    gcTime: 30_000
  })

  const startUpload = useCallback(
    (f: File) => {
      setLastFile(f)
      setViewerError(null)
      const bad = precheck(f)
      if (bad) {
        setUpload({ phase: 'error', file: f, error: bad })
        return
      }
      handle.current?.abort()
      setUpload({ phase: 'uploading', file: f, progress: 0 })
      const h = uploadFile(project.id, f, (progress) =>
        setUpload((u) => (u?.phase === 'uploading' && u.file === f ? { ...u, progress } : u))
      )
      handle.current = h
      h.promise.then(
        (info) => {
          if (handle.current !== h) return
          handle.current = null
          qc.setQueryData(fileKey(info.id), info)
          setActiveFileId(info.id)
          setUpload(null)
          void qc.invalidateQueries({ queryKey: ['projects'] })
          void qc.invalidateQueries({ queryKey: ['project', project.id] })
        },
        (err: unknown) => {
          if (handle.current !== h) return
          handle.current = null
          const e = asApiError(err)
          if (e.code === 'aborted') return
          setUpload({ phase: 'error', file: f, error: e })
        }
      )
    },
    [project.id, qc]
  )

  const retry = useCallback(() => {
    if (lastFile) startUpload(lastFile)
  }, [lastFile, startUpload])

  // ---- what the viewer shows
  const canRetry = lastFile !== null
  let stage: ViewerStage
  if (upload?.phase === 'uploading') {
    stage = {
      kind: 'uploading',
      filename: upload.file.name,
      size: upload.file.size,
      progress: upload.progress
    }
  } else if (upload?.phase === 'error') {
    stage = {
      kind: 'failed',
      title: 'Upload failed',
      code: upload.error.code,
      detail: upload.error.detail ?? errorTitle(upload.error.code),
      filename: upload.file.name,
      canRetry: true
    }
  } else if (!activeFileId) {
    stage = { kind: 'empty' }
  } else if (fileQ.isError) {
    const e = asApiError(fileQ.error)
    stage = {
      kind: 'failed',
      title: 'File unavailable',
      code: e.code,
      detail: e.detail,
      filename: null,
      canRetry
    }
  } else if (!file) {
    stage = { kind: 'parsing', label: 'Loading file', filename: null }
  } else if (file.status === 'failed') {
    stage = {
      kind: 'failed',
      title: 'Parse failed',
      code: file.error?.error ?? 'parse_failed',
      detail: file.error?.detail ?? errorTitle(file.error?.error ?? 'parse_failed'),
      filename: file.filename,
      canRetry
    }
  } else if (file.status !== 'parsed') {
    stage = { kind: 'parsing', label: 'Parsing geometry', filename: file.filename }
  } else if (graphQ.isError || meshQ.isError || viewerError) {
    const e = viewerError
      ? new ApiError(0, 'mesh_invalid', viewerError.message)
      : asApiError(graphQ.error ?? meshQ.error)
    stage = {
      kind: 'failed',
      title: 'Display failed',
      code: e.code,
      detail: e.detail,
      filename: file.filename,
      canRetry
    }
  } else if (!graphQ.data || !meshQ.data) {
    stage = { kind: 'parsing', label: 'Loading model', filename: file.filename }
  } else {
    stage = { kind: 'model', mesh: meshQ.data, graph: graphQ.data }
  }

  const graph = parsed ? (graphQ.data ?? null) : null
  const solve = useSolveState(
    stage.kind === 'model' ? activeFileId : null,
    stage.kind === 'model' ? graph : null
  )

  // ---- status bar
  let status: ParserStatus | null = null
  if (upload?.phase === 'uploading') {
    status = { text: `Uploading · ${Math.round(upload.progress * 100)}%`, tone: 'muted' }
  } else if (upload?.phase === 'error') {
    status = { text: `Upload failed · ${upload.error.code.replace(/_/g, ' ')}`, tone: 'danger' }
  } else if (file?.status === 'parsed') {
    const n = file.component_count ?? graph?.components.length ?? 0
    const t = file.parse_seconds != null ? ` · ${seconds(file.parse_seconds)}` : ''
    status = { text: `Parsed · ${plural(n, 'component', 'components')}${t}`, tone: 'ok' }
  } else if (file?.status === 'failed') {
    status = {
      text: `Failed · ${(file.error?.error ?? 'parse failed').replace(/_/g, ' ')}`,
      tone: 'danger'
    }
  } else if (file) {
    status = { text: `Parsing · ${file.filename}`, tone: 'muted' }
  }
  const statusText = status?.text ?? null
  const statusTone = status?.tone ?? 'muted'
  useEffect(() => {
    onParserStatus(statusText ? { text: statusText, tone: statusTone } : null)
  }, [statusText, statusTone, onParserStatus])
  useEffect(() => () => onParserStatus(null), [onParserStatus])

  const ds = solve.setup?.latest_dataset
  const dsText = ds
    ? `Dataset ${ds.short_hash} · ${ds.stale ? 'Setup changed · Reconfirm' : 'Confirmed'}`
    : null
  const dsTone = ds?.stale ? 'warning' : 'ok'
  useEffect(() => {
    onDatasetStatus(dsText ? { text: dsText, tone: dsTone } : null)
  }, [dsText, dsTone, onDatasetStatus])
  useEffect(() => () => onDatasetStatus(null), [onDatasetStatus])

  // The first result of a file opens the strip to half height.
  const runId = solve.run?.id ?? null
  useEffect(() => {
    const panel = resultsRef.current
    if (!runId || !panel) return
    if (panel.getSize().inPixels < 200) panel.resize(RESULTS_MAX)
  }, [runId, resultsRef])

  const emptyText =
    stage.kind === 'empty'
      ? 'Upload a STEP file to see components'
      : stage.kind === 'failed'
        ? 'No components: the file did not parse.'
        : stage.kind === 'model'
          ? ''
          : 'Components appear when parsing finishes.'

  const toggleResults = (): void => {
    const panel = resultsRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }

  const maximizeResults = (): void => {
    resultsRef.current?.resize(resultsMax ? RESULTS_DEFAULT : RESULTS_MAX)
  }

  return (
    <WorkspaceProvider resetKey={activeFileId}>
      <SolveProvider value={solve}>
        <main
          className="relative flex min-h-0 flex-1"
          data-testid="workspace"
          data-stage={stage.kind}
          data-file-id={activeFileId ?? ''}
          data-upload={upload?.phase ?? ''}
        >
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
            <ResizablePanel id="components" defaultSize="260px" minSize="200px" maxSize="420px">
              <ComponentsPane graph={stage.kind === 'model' ? graph : null} emptyText={emptyText} />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="center" minSize="560px">
              <ResizablePanelGroup orientation="vertical" className="h-full">
                <ResizablePanel id="viewer" minSize="240px">
                  <ViewerPane
                    stage={stage}
                    graph={stage.kind === 'model' ? graph : null}
                    onFile={startUpload}
                    onRetry={retry}
                    onViewerError={setViewerError}
                  />
                </ResizablePanel>
                <ResizableHandle orientation="horizontal" />
                <ResizablePanel
                  id="results"
                  panelRef={resultsRef}
                  defaultSize={RESULTS_DEFAULT}
                  minSize="80px"
                  maxSize={RESULTS_MAX}
                  collapsible
                  collapsedSize={`${RESULTS_HEADER_PX}px`}
                  onResize={(size) => {
                    setResultsCollapsed(size.inPixels <= RESULTS_HEADER_PX + 1)
                    setResultsMax(size.asPercentage >= 49.5)
                  }}
                >
                  <ResultsStrip
                    collapsed={resultsCollapsed}
                    maximized={resultsMax}
                    onToggle={toggleResults}
                    onMaximize={maximizeResults}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="chat" defaultSize="380px" minSize="300px" maxSize="560px">
              <ChatPane projectName={project.name} />
            </ResizablePanel>
          </ResizablePanelGroup>
          <ConfirmSheet />
        </main>
      </SolveProvider>
    </WorkspaceProvider>
  )
}
