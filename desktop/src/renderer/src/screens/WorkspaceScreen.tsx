import { useState } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import type { Project } from '@/lib/sampleProjects'
import { ChatPane } from './workspace/ChatPane'
import { ComponentsPane } from './workspace/ComponentsPane'
import { ResultsStrip } from './workspace/ResultsStrip'
import { ViewerPane } from './workspace/ViewerPane'

const RESULTS_HEADER_PX = 32

export function WorkspaceScreen({ project }: { project: Project }): React.JSX.Element {
  const resultsRef = usePanelRef()
  const [resultsCollapsed, setResultsCollapsed] = useState(false)

  const toggleResults = (): void => {
    const panel = resultsRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }

  return (
    <main className="flex min-h-0 flex-1" data-testid="workspace">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="components" defaultSize="260px" minSize="200px" maxSize="420px">
          <ComponentsPane />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="center" minSize="560px">
          <ResizablePanelGroup orientation="vertical" className="h-full">
            <ResizablePanel id="viewer" minSize="240px">
              <ViewerPane />
            </ResizablePanel>
            <ResizableHandle orientation="horizontal" />
            <ResizablePanel
              id="results"
              panelRef={resultsRef}
              defaultSize="120px"
              minSize="80px"
              maxSize="50%"
              collapsible
              collapsedSize={`${RESULTS_HEADER_PX}px`}
              onResize={(size) => setResultsCollapsed(size.inPixels <= RESULTS_HEADER_PX + 1)}
            >
              <ResultsStrip collapsed={resultsCollapsed} onToggle={toggleResults} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="chat" defaultSize="380px" minSize="300px" maxSize="560px">
          <ChatPane projectName={project.name} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  )
}
