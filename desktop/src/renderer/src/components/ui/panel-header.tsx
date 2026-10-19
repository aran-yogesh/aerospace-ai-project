import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 32px panel header: mono label left, icon actions right, 1px bottom border. */
export function PanelHeader({
  label,
  actions,
  className
}: {
  label: ReactNode
  actions?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border pr-1 pl-3',
        className
      )}
    >
      <h2 className="mono-label truncate text-text">{label}</h2>
      {actions ? <div className="flex items-center gap-0.5">{actions}</div> : null}
    </div>
  )
}
