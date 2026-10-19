import { StatusDot } from '@/components/ui/status-dot'
import type { BackendStatus } from '@/hooks/useBackendHealth'
import { APP_VERSION } from '@/lib/config'

const LABEL: Record<BackendStatus, string> = {
  ok: 'Backend connected',
  connecting: 'Connecting',
  down: 'Backend offline'
}

/** 24px status bar: backend health left, app version right. */
export function StatusBar({ status }: { status: BackendStatus }): React.JSX.Element {
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-bg px-3">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2"
        data-status={status}
      >
        <StatusDot state={status} />
        <span className="mono-label text-text-muted">{LABEL[status]}</span>
      </div>
      <span className="mono-label text-text-muted">v{APP_VERSION}</span>
    </footer>
  )
}
