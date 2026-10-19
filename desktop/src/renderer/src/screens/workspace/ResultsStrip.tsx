import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelHeader } from '@/components/ui/panel-header'

export function ResultsStrip({
  collapsed,
  onToggle
}: {
  collapsed: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <section aria-label="Results" className="flex h-full flex-col bg-surface">
      <PanelHeader
        label="Results"
        className={collapsed ? 'border-b-0' : undefined}
        actions={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? 'Expand results' : 'Collapse results'}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            {collapsed ? <ChevronUp /> : <ChevronDown />}
          </Button>
        }
      />
      {collapsed ? null : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-body text-text-muted">Run a solve to see pressure drop</p>
        </div>
      )}
    </section>
  )
}
