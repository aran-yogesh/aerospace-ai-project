import { useState } from 'react'
import { SettingsDialog } from '@/components/app/SettingsDialog'
import { StatusBar } from '@/components/app/StatusBar'
import { TopBar, type Crumb } from '@/components/app/TopBar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useBackendHealth } from '@/hooks/useBackendHealth'
import { useHashRoute } from '@/hooks/useHashRoute'
import { findProject, SAMPLE_PROJECTS } from '@/lib/sampleProjects'
import { ProjectsScreen } from '@/screens/ProjectsScreen'
import { WorkspaceScreen } from '@/screens/WorkspaceScreen'
import { ThemeProvider } from '@/theme/ThemeProvider'

function Shell(): React.JSX.Element {
  const [route, navigate] = useHashRoute()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const health = useBackendHealth()

  const goHome = (): void => navigate('/')
  const project = route.name === 'workspace' ? findProject(route.projectId) : undefined

  const crumbs: Crumb[] = [{ label: 'Projects', onSelect: goHome }]
  if (project) crumbs.push({ label: project.name })

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <TopBar crumbs={crumbs} onOpenSettings={() => setSettingsOpen(true)} />
      {project ? (
        <WorkspaceScreen key={project.id} project={project} />
      ) : (
        <ProjectsScreen
          projects={route.name === 'projects' && route.empty ? [] : SAMPLE_PROJECTS}
          onOpen={(p) => navigate(`/workspace/${encodeURIComponent(p.id)}`)}
        />
      )}
      <StatusBar status={health} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

export function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <Shell />
      </TooltipProvider>
    </ThemeProvider>
  )
}
