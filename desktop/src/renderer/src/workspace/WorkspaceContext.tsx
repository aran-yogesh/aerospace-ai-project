import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { CadViewerApi } from '@/viewer'

/**
 * Selection for one workspace: the single source of truth shared by the 3D viewer,
 * the components pane, the schematic and the on-canvas callout.
 */
export interface WorkspaceValue {
  selectedId: string | null
  hoveredId: string | null
  /** Select a component; `fit` also frames it in the 3D viewer. */
  select: (id: string | null, opts?: { fit?: boolean }) => void
  hover: (id: string | null) => void
  clearSelection: () => void
  /** Viewer3D registers its API here so panes can ask it to fit. */
  registerViewer: (api: CadViewerApi | null) => void
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function WorkspaceProvider({
  children,
  resetKey
}: {
  children: ReactNode
  /** Selection resets when this changes (e.g. the active file). */
  resetKey: string | null
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const viewer = useRef<CadViewerApi | null>(null)
  const [prevKey, setPrevKey] = useState(resetKey)

  if (prevKey !== resetKey) {
    setPrevKey(resetKey)
    setSelectedId(null)
    setHoveredId(null)
  }

  const select = useCallback((id: string | null, opts?: { fit?: boolean }) => {
    setSelectedId(id)
    if (id && opts?.fit) viewer.current?.fitTo(id)
  }, [])
  const hover = useCallback((id: string | null) => setHoveredId(id), [])
  const clearSelection = useCallback(() => setSelectedId(null), [])
  const registerViewer = useCallback((api: CadViewerApi | null) => {
    viewer.current = api
  }, [])

  // Esc clears the selection, unless a dialog or text field owns the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [role="dialog"]')) return
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo(
    () => ({ selectedId, hoveredId, select, hover, clearSelection, registerViewer }),
    [selectedId, hoveredId, select, hover, clearSelection, registerViewer]
  )
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  return ctx
}
