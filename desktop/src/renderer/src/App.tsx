import { useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { NewProjectDialog } from '@/components/app/NewProjectDialog'
import { SettingsDialog } from '@/components/app/SettingsDialog'
import { StatusBar } from '@/components/app/StatusBar'
import { TopBar, type Crumb } from '@/components/app/TopBar'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useBackendHealth } from '@/hooks/useBackendHealth'
import { useHashRoute } from '@/hooks/useHashRoute'
import { api, ApiError } from '@/lib/api'
import { errorTitle } from '@/lib/format'
import { ProjectsScreen } from '@/screens/ProjectsScreen'
import { WorkspaceScreen, type ParserStatus } from '@/screens/WorkspaceScreen'
import { ThemeProvider } from '@/theme/ThemeProvider'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false
    }
  }
})

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.detail ?? errorTitle(err.code)
  return err instanceof Error ? err.message : String(err)
}

function WorkspaceMessage({
  title,
  text,
  onBack
}: {
  title: string
  text: string
  onBack?: () => void
}): React.JSX.Element {
  return (
    <main
      className="halftone flex min-h-0 flex-1 items-center justify-center"
      data-testid="workspace-message"
    >
      <div className="flex w-[400px] flex-col items-start gap-3 border border-border bg-bg px-6 py-5">
        <Callout variant={onBack ? 'danger' : 'default'}>{title}</Callout>
        <p className="text-body text-text-muted">{text}</p>
        {onBack ? (
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft />
            Projects
          </Button>
        ) : null}
      </div>
    </main>
  )
}

function Shell(): React.JSX.Element {
  const [route, navigate] = useHashRoute()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [parser, setParser] = useState<ParserStatus | null>(null)
  const health = useBackendHealth()

  const goHome = (): void => navigate('/')
  const openProject = (id: string): void => navigate(`/workspace/${encodeURIComponent(id)}`)
  const projectId = route.name === 'workspace' ? route.projectId : null

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: api.listProjects,
    enabled: projectId === null
  })
  const projectQ = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId ?? ''),
    enabled: projectId !== null
  })
  const project = projectId ? projectQ.data : undefined

  const crumbs: Crumb[] = [{ label: 'Projects', onSelect: goHome }]
  if (project) crumbs.push({ label: project.name })

  let body: React.ReactNode
  if (projectId === null) {
    const forcedEmpty = route.name === 'projects' && route.empty
    body = (
      <ProjectsScreen
        projects={forcedEmpty ? [] : (projectsQ.data ?? [])}
        loading={!forcedEmpty && projectsQ.isPending}
        error={!forcedEmpty && projectsQ.isError ? messageOf(projectsQ.error) : null}
        onRetry={() => void projectsQ.refetch()}
        onOpen={(p) => openProject(p.id)}
        onNew={() => setNewOpen(true)}
      />
    )
  } else if (projectQ.isPending) {
    body = <WorkspaceMessage title="Loading" text="Opening the project." />
  } else if (projectQ.isError || !project) {
    const notFound = projectQ.error instanceof ApiError && projectQ.error.status === 404
    body = (
      <WorkspaceMessage
        title={notFound ? 'Project not found' : 'Project unavailable'}
        text={notFound ? 'It may have been deleted.' : messageOf(projectQ.error)}
        onBack={goHome}
      />
    )
  } else {
    body = <WorkspaceScreen key={project.id} project={project} onParserStatus={setParser} />
  }

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <TopBar crumbs={crumbs} onOpenSettings={() => setSettingsOpen(true)} />
      {body}
      <StatusBar status={health} parser={projectId ? parser : null} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <NewProjectDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(p) => openProject(p.id)}
      />
    </div>
  )
}

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Shell />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
