import { FileBox, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import type { FileStatus, Project } from '@/lib/apiTypes'
import { plural, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const STATUS_LABEL: Record<FileStatus, string> = {
  uploaded: 'Uploaded',
  parsing: 'Parsing',
  parsed: 'Parsed',
  failed: 'Parse failed'
}

function cornerLabel(project: Project): string {
  const f = project.latest_file
  if (!f) return 'No file'
  if (f.status === 'parsed' && f.component_count != null) {
    return plural(f.component_count, 'part', 'parts')
  }
  return STATUS_LABEL[f.status]
}

function ProjectCard({
  project,
  onOpen
}: {
  project: Project
  onOpen: () => void
}): React.JSX.Element {
  const f = project.latest_file
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="project-card"
      data-project-id={project.id}
      className="group flex flex-col border border-border bg-surface text-left transition-colors duration-120 ease-out hover:border-accent"
    >
      <div className="halftone relative h-48 border-b border-border">
        <span
          className={cn(
            'absolute top-2 left-2 mono-label',
            f?.status === 'failed' ? 'text-danger' : 'text-text-muted'
          )}
        >
          {cornerLabel(project)}
        </span>
        <FileBox
          aria-hidden
          strokeWidth={1}
          className="absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 text-text-muted transition-colors duration-120 ease-out group-hover:text-text"
        />
      </div>
      <div className="flex flex-col gap-2 px-3 py-3">
        <span className="truncate text-body font-medium text-text">{project.name}</span>
        <div className="flex items-center justify-between gap-3">
          <span className="truncate mono-label text-text-muted normal-case tracking-normal">
            {f ? f.filename : 'No STEP file yet'}
          </span>
          <span className="num shrink-0 text-text-muted">
            {shortDate(f?.created_at ?? project.created_at)}
          </span>
        </div>
      </div>
    </button>
  )
}

function CenterBox({
  children,
  testId
}: {
  children: React.ReactNode
  testId: string
}): React.JSX.Element {
  return (
    <div
      data-testid={testId}
      className="halftone flex min-h-0 flex-1 items-center justify-center border border-border"
    >
      <div className="flex w-[400px] flex-col items-center gap-4 bg-bg px-10 py-8 text-center outline outline-1 outline-border">
        {children}
      </div>
    </div>
  )
}

export function ProjectsScreen({
  projects,
  loading,
  error,
  onRetry,
  onOpen,
  onNew
}: {
  projects: readonly Project[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpen: (project: Project) => void
  onNew: () => void
}): React.JSX.Element {
  const empty = !loading && !error && projects.length === 0
  const showList = !loading && !error && projects.length > 0

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-8 py-6">
      <div className="flex h-8 shrink-0 items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="mono-label text-text">Projects</h1>
          {showList ? (
            <span className="num text-text-muted">{String(projects.length).padStart(2, '0')}</span>
          ) : null}
        </div>
        {showList ? (
          <Button variant="primary" onClick={onNew} data-testid="new-project">
            <Plus />
            New project
          </Button>
        ) : null}
      </div>
      {loading ? (
        <CenterBox testId="projects-loading">
          <span role="status" className="mono-label text-text-muted">
            Loading projects
          </span>
        </CenterBox>
      ) : error ? (
        <CenterBox testId="projects-error">
          <Callout variant="danger">Backend unreachable</Callout>
          <p className="text-body text-text-muted">{error}</p>
          <Button variant="secondary" onClick={onRetry}>
            <RotateCcw />
            Retry
          </Button>
        </CenterBox>
      ) : empty ? (
        <CenterBox testId="projects-empty">
          <Callout variant="filled">No projects yet</Callout>
          <p className="text-body text-text-muted">
            A project holds one fluid system and its results. Create one, then add a STEP file of
            the assembly.
          </p>
          <Button variant="primary" onClick={onNew} data-testid="new-project">
            <Plus />
            New project
          </Button>
        </CenterBox>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => onOpen(p)} />
          ))}
        </div>
      )}
    </main>
  )
}
