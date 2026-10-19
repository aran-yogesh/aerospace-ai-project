import { Fragment } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ThemeSelect } from './ThemeSelect'

export interface Crumb {
  label: string
  onSelect?: () => void
}

const isMac = window.lemma?.platform === 'darwin'

/** 44px top bar: wordmark + breadcrumb left, theme + settings right. Window drag region. */
export function TopBar({
  crumbs,
  onOpenSettings
}: {
  crumbs: readonly Crumb[]
  onOpenSettings: () => void
}): React.JSX.Element {
  return (
    <header
      className={cn(
        'app-drag flex h-11 shrink-0 items-center justify-between border-b border-border bg-bg pr-2',
        // Leave room for the inset macOS traffic lights.
        isMac ? 'pl-[84px]' : 'pl-4'
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="wordmark text-text">LemmaLab</span>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1
            return (
              <Fragment key={`${crumb.label}-${i}`}>
                <span aria-hidden className="mono-label text-border">
                  /
                </span>
                {crumb.onSelect && !last ? (
                  <button
                    type="button"
                    onClick={crumb.onSelect}
                    className="app-no-drag mono-label truncate text-text-muted transition-colors duration-120 ease-out hover:text-text"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className="mono-label truncate text-text-muted"
                  >
                    {crumb.label}
                  </span>
                )}
              </Fragment>
            )
          })}
        </nav>
      </div>
      <div className="app-no-drag flex items-center gap-2">
        <ThemeSelect />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Settings"
              onClick={onOpenSettings}
              data-testid="open-settings"
            >
              <Settings />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            Settings
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
