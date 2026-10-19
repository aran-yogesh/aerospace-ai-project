import { PanelHeader } from '@/components/ui/panel-header'

export function ComponentsPane(): React.JSX.Element {
  return (
    <section aria-label="Components" className="flex h-full flex-col bg-surface">
      <PanelHeader label="Components" />
      <div className="flex flex-1 items-start px-3 py-3">
        <p className="text-body text-text-muted">Upload a STEP file to see components</p>
      </div>
    </section>
  )
}
