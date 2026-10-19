import { cn } from '@/lib/utils'

export type StatusDotState = 'ok' | 'connecting' | 'down'

const COLOR: Record<StatusDotState, string> = {
  ok: 'bg-success',
  connecting: 'bg-accent animate-pulse',
  down: 'bg-danger'
}

/** A 6x6 square status indicator: green ok, accent connecting, danger down. */
export function StatusDot({
  state,
  className
}: {
  state: StatusDotState
  className?: string
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      data-state={state}
      className={cn('inline-block size-1.5 shrink-0', COLOR[state], className)}
    />
  )
}
