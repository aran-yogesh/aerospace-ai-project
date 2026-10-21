import { FolderOpen, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { bytes } from '@/lib/format'

/** Shared frame: a bordered box on the halftone, same footprint as the dropzone. */
function Frame({
  children,
  testId
}: {
  children: React.ReactNode
  testId: string
}): React.JSX.Element {
  return (
    <div
      data-testid={testId}
      className="flex w-[360px] flex-col gap-4 border border-border bg-bg px-6 py-5"
    >
      {children}
    </div>
  )
}

export function UploadingStage({
  filename,
  size,
  progress
}: {
  filename: string
  size: number
  /** 0..1 */
  progress: number
}): React.JSX.Element {
  const pct = Math.round(progress * 100)
  return (
    <Frame testId="stage-uploading">
      <div className="flex items-baseline justify-between gap-3">
        <span className="mono-label text-text">Uploading</span>
        <span className="num text-text-muted">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-0.5 w-full bg-border"
      >
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-body text-text">{filename}</span>
        <span className="shrink-0 num text-text-muted">{bytes(size)}</span>
      </div>
    </Frame>
  )
}

/** Full-viewer parsing state: a 1px scan line sweeps the halftone. No spinner. */
export function ParsingStage({
  label,
  filename
}: {
  label: string
  filename: string | null
}): React.JSX.Element {
  return (
    <div
      className="relative flex size-full items-center justify-center"
      data-testid="stage-parsing"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 animate-scan motion-reduce:translate-y-1/2 motion-reduce:animate-none"
      >
        <div className="h-px w-full bg-text-muted opacity-60" />
      </div>
      <div className="relative flex flex-col items-center gap-2 border border-border bg-bg px-6 py-4">
        <span role="status" className="mono-label text-text">
          {label}
        </span>
        {filename ? <span className="num text-text-muted">{filename}</span> : null}
      </div>
    </div>
  )
}

export function FailedStage({
  title,
  code,
  detail,
  filename,
  onRetry,
  onBrowse
}: {
  title: string
  code: string
  detail: string | null
  filename: string | null
  /** Re-upload the same file; omitted when it is not available any more. */
  onRetry?: () => void
  onBrowse: () => void
}): React.JSX.Element {
  return (
    <Frame testId="stage-failed">
      <Callout variant="danger" className="self-start">
        {title}
      </Callout>
      <dl className="flex flex-col gap-1">
        {filename ? (
          <div className="flex gap-3">
            <dt className="w-12 shrink-0 mono-label text-text-muted">File</dt>
            <dd className="min-w-0 truncate num text-text">{filename}</dd>
          </div>
        ) : null}
        <div className="flex gap-3">
          <dt className="w-12 shrink-0 mono-label text-text-muted">Code</dt>
          <dd className="min-w-0 truncate num text-text">{code}</dd>
        </div>
      </dl>
      {detail ? (
        <p className="max-h-32 overflow-auto text-body break-words text-text-muted select-text">
          {detail}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onRetry ?? onBrowse} data-testid="retry-button">
          <RotateCcw />
          Retry
        </Button>
        {onRetry ? (
          <Button variant="ghost" onClick={onBrowse}>
            <FolderOpen />
            Choose file
          </Button>
        ) : null}
      </div>
    </Frame>
  )
}
