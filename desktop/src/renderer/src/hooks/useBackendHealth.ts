import { useEffect, useState } from 'react'
import { API_URL } from '@/lib/config'

export type BackendStatus = 'connecting' | 'ok' | 'down'

const POLL_MS = 5000
const TIMEOUT_MS = 3000

interface HealthBody {
  status?: unknown
  db?: unknown
}

async function checkHealth(signal: AbortSignal): Promise<boolean> {
  const res = await fetch(`${API_URL}/health`, { signal, cache: 'no-store' })
  if (!res.ok) return false
  const body = (await res.json()) as HealthBody
  return body.status === 'ok'
}

/** Polls GET /health every 5s. Starts as 'connecting' until the first answer. */
export function useBackendHealth(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>('connecting')

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let inflight: AbortController | undefined

    const tick = async (): Promise<void> => {
      inflight = new AbortController()
      const timeout = setTimeout(() => inflight?.abort(), TIMEOUT_MS)
      let ok: boolean
      try {
        ok = await checkHealth(inflight.signal)
      } catch {
        ok = false
      } finally {
        clearTimeout(timeout)
      }
      if (disposed) return
      setStatus(ok ? 'ok' : 'down')
      timer = setTimeout(() => void tick(), POLL_MS)
    }

    void tick()
    return () => {
      disposed = true
      inflight?.abort()
      if (timer) clearTimeout(timer)
    }
  }, [])

  return status
}
