/**
 * Typed client for the LemmaLab backend (contract: docs Phase 1, REST section).
 * Every non-2xx answer becomes an ApiError carrying the backend's {"error", "detail"}.
 */
import type { SystemGraph } from '@/types/geometry'
import type { MeshShapes } from '@/viewer'
import { API_URL } from './config'
import type { FileInfo, FileStatusEvent, Project, ProjectDetail, ProjectList } from './apiTypes'
import type {
  Dataset,
  FluidList,
  MaterialList,
  ResolveResult,
  SetupIn,
  SetupView,
  SolveIn,
  SolveRun
} from './apiTypes'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: string | null

  constructor(status: number, code: string, detail: string | null) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

interface ErrorBody {
  error?: unknown
  detail?: unknown
}

function detailText(detail: unknown): string | null {
  if (detail == null) return null
  if (typeof detail === 'string') return detail
  // FastAPI validation errors arrive as a list of {loc, msg}.
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String(d.msg) : JSON.stringify(d)))
      .join('; ')
  }
  return JSON.stringify(detail)
}

function toApiError(status: number, body: unknown): ApiError {
  const b = (body && typeof body === 'object' ? body : {}) as ErrorBody
  const code =
    typeof b.error === 'string' ? b.error : status === 0 ? 'network_error' : `http_${status}`
  return new ApiError(status, code, detailText(b.detail))
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { cache: 'no-store', ...init })
  } catch (err) {
    throw new ApiError(0, 'network_error', err instanceof Error ? err.message : String(err))
  }
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!res.ok) throw toApiError(res.status, body)
  return body as T
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

export const api = {
  listProjects: () => request<ProjectList>('/projects').then((r) => r.items),
  getProject: (id: string) => request<ProjectDetail>(`/projects/${encodeURIComponent(id)}`),
  createProject: (name: string) => request<Project>('/projects', json({ name })),
  getFile: (id: string) => request<FileInfo>(`/files/${encodeURIComponent(id)}`),
  getGraph: (id: string) => request<SystemGraph>(`/files/${encodeURIComponent(id)}/graph`),
  getMesh: (id: string) => request<MeshShapes>(`/files/${encodeURIComponent(id)}/mesh`),
  listFluids: () => request<FluidList>('/fluids').then((r) => r.items),
  listMaterials: () => request<MaterialList>('/materials'),
  getSetup: (fileId: string) => request<SetupView>(`/files/${encodeURIComponent(fileId)}/setup`),
  putSetup: (fileId: string, body: SetupIn) =>
    request<SetupView>(`/files/${encodeURIComponent(fileId)}/setup`, json(body, 'PUT')),
  resolve: (fileId: string) =>
    request<ResolveResult>(`/files/${encodeURIComponent(fileId)}/resolve`, { method: 'POST' }),
  confirm: (fileId: string) =>
    request<Dataset>(`/files/${encodeURIComponent(fileId)}/datasets`, { method: 'POST' }),
  getDataset: (id: string) => request<Dataset>(`/datasets/${encodeURIComponent(id)}`),
  solve: (datasetId: string, body: SolveIn) =>
    request<SolveRun>(`/datasets/${encodeURIComponent(datasetId)}/solve`, json(body))
}

/** ws://host/ws/files/{id}, derived from API_URL. */
export function fileSocketUrl(fileId: string): string {
  const url = new URL(`${API_URL}/ws/files/${encodeURIComponent(fileId)}`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export function isFileStatusEvent(value: unknown): value is FileStatusEvent {
  return (
    !!value &&
    typeof value === 'object' &&
    'file_id' in value &&
    'status' in value &&
    typeof (value as { status: unknown }).status === 'string'
  )
}

export interface UploadHandle {
  promise: Promise<FileInfo>
  abort: () => void
}

/**
 * POST /projects/{id}/files as multipart "file". Uses XHR (fetch has no upload progress).
 * onProgress receives 0..1.
 */
export function uploadFile(
  projectId: string,
  file: File,
  onProgress: (fraction: number) => void
): UploadHandle {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<FileInfo>((resolve, reject) => {
    xhr.open('POST', `${API_URL}/projects/${encodeURIComponent(projectId)}/files`)
    xhr.responseType = 'text'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: unknown
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1)
        resolve(body as FileInfo)
      } else reject(toApiError(xhr.status, body))
    }
    xhr.onerror = () =>
      reject(new ApiError(0, 'network_error', 'Upload failed: backend unreachable'))
    xhr.onabort = () => reject(new ApiError(0, 'aborted', null))
    const form = new FormData()
    form.append('file', file, file.name)
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}
