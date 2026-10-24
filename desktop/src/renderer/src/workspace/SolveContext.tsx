import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { Dataset, ResolveResult, SetupIn, SetupView, SolveIn, SolveRun } from '@/lib/apiTypes'
import type { SystemGraph } from '@/types/geometry'
import { pressureBins, type PressureBins } from './pressure'

/**
 * Phase 2 state for the active file: setup (server), resolved K rows, the latest
 * dataset, the last solve run and the PRESSURE coloring toggle. Selection stays in
 * WorkspaceContext; this never duplicates it.
 */
export interface SolveValue {
  fileId: string | null
  graph: SystemGraph | null
  setup: SetupView | undefined
  setupError: ApiError | null
  saveSetup: (next: SetupIn) => void
  saving: boolean
  resolved: ResolveResult | null
  resolveError: ApiError | null
  resolving: boolean
  runResolve: () => void
  confirmOpen: boolean
  openConfirm: () => void
  closeConfirm: () => void
  confirm: () => void
  confirming: boolean
  confirmError: ApiError | null
  dataset: Dataset | undefined
  /** A dataset exists, and setup or geometry changed after it was confirmed. */
  stale: boolean
  /** Why SOLVE is disabled, or null when a confirmed, current dataset exists. */
  solveBlocked: string | null
  run: SolveRun | null
  solve: (body: SolveIn) => void
  solving: boolean
  solveError: ApiError | null
  pressureOn: boolean
  setPressureOn: (on: boolean) => void
  bins: PressureBins | null
}

const SolveContext = createContext<SolveValue | null>(null)
export const SolveProvider = SolveContext.Provider

/** The editable part of a SetupView, i.e. what PUT takes. */
export function toSetupIn(v: SetupView): SetupIn {
  return { fluid: v.fluid, material_key: v.material_key, k_overrides: v.k_overrides }
}

function asApiError(err: unknown): ApiError | null {
  if (!err) return null
  if (err instanceof ApiError) return err
  return new ApiError(0, 'unexpected_error', err instanceof Error ? err.message : String(err))
}

/** Per-file state, keyed so switching files never shows another file's run. */
function useKeyed<T>(fileId: string | null): [T | null, (v: T | null) => void] {
  const [map, setMap] = useState<Record<string, T | null>>({})
  const value = fileId ? (map[fileId] ?? null) : null
  const set = useCallback(
    (v: T | null) => {
      if (fileId) setMap((m) => ({ ...m, [fileId]: v }))
    },
    [fileId]
  )
  return [value, set]
}

export function useSolveState(fileId: string | null, graph: SystemGraph | null): SolveValue {
  const qc = useQueryClient()
  const enabled = fileId !== null && graph !== null
  const setupKey = ['setup', fileId]
  const setupQ = useQuery({
    queryKey: setupKey,
    queryFn: () => api.getSetup(fileId ?? ''),
    enabled
  })
  const setup = setupQ.data

  const [resolved, setResolved] = useKeyed<ResolveResult>(fileId)
  const [run, setRun] = useKeyed<SolveRun>(fileId)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pressureOn, setPressureOn] = useState(false)

  const resolveM = useMutation({
    mutationFn: () => api.resolve(fileId ?? ''),
    onSuccess: setResolved
  })
  const resolveMutate = resolveM.mutate

  const saveM = useMutation({
    mutationFn: (next: SetupIn) => api.putSetup(fileId ?? '', next),
    onSuccess: (view) => {
      qc.setQueryData(['setup', fileId], view)
      // K overrides change the rows; keep an open review current.
      if (resolved) resolveMutate()
    }
  })

  const datasetId = setup?.latest_dataset?.id ?? null
  const datasetQ = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => api.getDataset(datasetId ?? ''),
    enabled: datasetId !== null,
    staleTime: Infinity // immutable
  })

  const confirmM = useMutation({
    mutationFn: () => api.confirm(fileId ?? ''),
    onSuccess: (ds) => {
      qc.setQueryData(['dataset', ds.id], ds)
      void qc.invalidateQueries({ queryKey: ['setup', fileId] })
      setConfirmOpen(false)
    }
  })

  const solveM = useMutation({
    mutationFn: (body: SolveIn) => api.solve(datasetId ?? '', body),
    onSuccess: setRun,
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'dataset_stale') {
        void qc.invalidateQueries({ queryKey: ['setup', fileId] })
      }
    }
  })

  const stale = setup?.latest_dataset?.stale ?? false
  let solveBlocked: string | null = null
  if (!enabled) solveBlocked = 'NO MODEL'
  else if (!setup?.latest_dataset) solveBlocked = 'NO DATASET · REVIEW AND CONFIRM SETUP'
  else if (stale) solveBlocked = 'SETUP CHANGED · RECONFIRM'

  const result = run?.result
  const bins = useMemo(() => (result ? pressureBins(result.segments) : null), [result])

  const openConfirm = useCallback(() => {
    setConfirmOpen(true)
    resolveMutate()
  }, [resolveMutate])

  return {
    fileId,
    graph,
    setup,
    setupError: asApiError(setupQ.error),
    saveSetup: saveM.mutate,
    saving: saveM.isPending,
    resolved,
    resolveError: asApiError(resolveM.error),
    resolving: resolveM.isPending,
    runResolve: resolveMutate,
    confirmOpen,
    openConfirm,
    closeConfirm: () => setConfirmOpen(false),
    confirm: confirmM.mutate,
    confirming: confirmM.isPending,
    confirmError: asApiError(confirmM.error),
    dataset: datasetQ.data,
    stale,
    solveBlocked,
    run,
    solve: solveM.mutate,
    solving: solveM.isPending,
    solveError: asApiError(solveM.error),
    pressureOn,
    setPressureOn,
    bins
  }
}

export function useSolve(): SolveValue {
  const ctx = useContext(SolveContext)
  if (!ctx) throw new Error('useSolve must be used inside <SolveProvider>')
  return ctx
}
