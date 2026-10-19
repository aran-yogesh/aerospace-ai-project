import { Group, Panel, Separator } from 'react-resizable-panels'
import { cn } from '@/lib/utils'

// shadcn/ui Resizable on react-resizable-panels v4, restyled: a 1px hairline handle that
// turns muted on hover and accent while dragged or focused.
const ResizablePanelGroup = Group
const ResizablePanel = Panel

function ResizableHandle({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof Separator> & {
  /** Orientation of the handle line itself. */
  orientation?: 'vertical' | 'horizontal'
}): React.JSX.Element {
  return (
    <Separator
      className={cn(
        'shrink-0 bg-border transition-colors duration-120 ease-out outline-none',
        orientation === 'vertical' ? 'w-px' : 'h-px',
        'data-[separator=hover]:bg-text-muted data-[separator=active]:bg-accent data-[separator=focus]:bg-accent',
        className
      )}
      {...props}
    />
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
