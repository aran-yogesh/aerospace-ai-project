import { StatusDot } from '@/components/ui/status-dot'
import type { BackendStatus } from '@/hooks/useBackendHealth'
import { APP_VERSION } from '@/lib/config'
import { cn } from '@/lib/utils'
import type { ParserStatus } from '@/screens/WorkspaceScreen'

const LABEL: Record<BackendStatus, string> = {
  ok: 'Backend connected',
  connecting: 'Connecting',
  down: 'Backend offline'
}

const TONE: Record<ParserStatus['tone'], string> = {
  muted: 'text-text-muted',
  ok: 'text-text',
  danger: 'text-danger',
  warning: 'text-warning'
}

/** 24px status bar: backend health and active-file parser status left, version right. */
export function StatusBar({
  status,
  parser,
  dataset
}: {
  status: BackendStatus
  parser?: ParserStatus | null
  dataset?: ParserStatus | null
}): React.JSX.Element {
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-4 border-t border-border bg-bg px-3">
      <div className="flex min-w-0 items-center gap-3">
        <div
          role="status"
          aria-live="polite"
          className="flex shrink-0 items-center gap-2"
          data-status={status}
        >
          <StatusDot state={status} />
          <span className="mono-label text-text-muted">{LABEL[status]}</span>
        </div>
        {parser ? (
          <>
            <span aria-hidden className="h-3 w-px shrink-0 bg-border" />
            <span
              role="status"
              aria-live="polite"
              data-testid="parser-status"
              className={cn('truncate mono-label tabular-nums', TONE[parser.tone])}
            >
              {parser.text}
            </span>
          </>
        ) : null}
        {dataset ? (
          <>
            <span aria-hidden className="h-3 w-px shrink-0 bg-border" />
            <span
              role="status"
              aria-live="polite"
              data-testid="dataset-status"
              className={cn('truncate mono-label tabular-nums', TONE[dataset.tone])}
            >
              {dataset.text}
            </span>
          </>
        ) : null}
      </div>
      <span className="shrink-0 mono-label text-text-muted">v{APP_VERSION}</span>
    </footer>
  )
}
