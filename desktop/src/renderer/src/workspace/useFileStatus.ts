import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, fileSocketUrl, isFileStatusEvent } from '@/lib/api'
import type { FileInfo, FileStatus } from '@/lib/apiTypes'

const POLL_MS = 1500
const TERMINAL: readonly FileStatus[] = ['parsed', 'failed']

export const fileKey = (id: string) => ['file', id] as const

export function isTerminal(status: FileStatus | undefined): boolean {
  return status !== undefined && TERMINAL.includes(status)
}

/**
 * Live status of one uploaded file. The WebSocket /ws/files/{id} pushes every change into
 * the react-query cache; while the socket is not open (or never opens) GET /files/{id} is
 * polled instead. Both stop once the file is parsed or failed.
 */
export function useFileStatus(fileId: string | null) {
  const qc = useQueryClient()
  const [socketOpen, setSocketOpen] = useState(false)

  const query = useQuery({
    queryKey: fileKey(fileId ?? ''),
    queryFn: () => api.getFile(fileId ?? ''),
    enabled: fileId !== null,
    refetchInterval: (q) => (isTerminal(q.state.data?.status) || socketOpen ? false : POLL_MS)
  })

  const status = query.data?.status
  const terminal = isTerminal(status)

  useEffect(() => {
    if (!fileId || terminal) return
    let closedByUs = false
    let ws: WebSocket | null = null
    const connect = (): void => {
      const sock = new WebSocket(fileSocketUrl(fileId))
      ws = sock
      sock.onopen = () => {
        // Closing a CONNECTING socket makes Chromium log an error; close it here instead.
        if (closedByUs) sock.close()
        else setSocketOpen(true)
      }
      sock.onmessage = onMessage
      // Errors are followed by close; polling takes over. Nothing to log.
      sock.onerror = () => undefined
      sock.onclose = () => {
        if (!closedByUs) setSocketOpen(false)
      }
    }
    const onMessage = (msg: MessageEvent): void => {
      if (closedByUs) return
      let event: unknown
      try {
        event = JSON.parse(String(msg.data))
      } catch {
        return
      }
      if (!isFileStatusEvent(event) || event.file_id !== fileId) return
      qc.setQueryData<FileInfo>(fileKey(fileId), (prev) =>
        prev
          ? {
              ...prev,
              status: event.status,
              error: event.error,
              parse_seconds: event.parse_seconds,
              component_count: event.component_count
            }
          : prev
      )
      if (!qc.getQueryData(fileKey(fileId)))
        void qc.invalidateQueries({ queryKey: fileKey(fileId) })
      if (isTerminal(event.status)) {
        // Pick up parser_version etc. that the event does not carry.
        void qc.invalidateQueries({ queryKey: fileKey(fileId) })
        void qc.invalidateQueries({ queryKey: ['projects'] })
        void qc.invalidateQueries({ queryKey: ['project'] })
      }
    }
    // Deferred so React StrictMode's mount/unmount/mount never opens a throwaway socket.
    const timer = setTimeout(connect, 0)
    return () => {
      closedByUs = true
      clearTimeout(timer)
      setSocketOpen(false)
      const sock = ws as WebSocket | null
      if (sock?.readyState === WebSocket.OPEN) sock.close()
    }
  }, [fileId, terminal, qc])

  return query
}
