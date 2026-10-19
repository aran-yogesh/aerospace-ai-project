import { FileBox, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import type { Project } from '@/lib/sampleProjects'

function ProjectCard({
  project,
  onOpen
}: {
  project: Project
  onOpen: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="project-card"
      className="group flex flex-col border border-border bg-surface text-left transition-colors duration-120 ease-out hover:border-accent"
    >
      <div className="halftone relative h-48 border-b border-border">
        <span className="absolute top-2 left-2 mono-label text-text-muted">
          {project.components} parts
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
            {project.file}
          </span>
          <span className="num shrink-0 text-text-muted">{project.updated}</span>
        </div>
      </div>
    </button>
  )
}

function EmptyProjects({ onNew }: { onNew: () => void }): React.JSX.Element {
  return (
    <div
      data-testid="projects-empty"
      className="halftone flex min-h-0 flex-1 items-center justify-center border border-border"
    >
      <div className="flex w-[400px] flex-col items-center gap-4 bg-bg px-10 py-8 text-center outline outline-1 outline-border">
        <Callout variant="filled">No projects yet</Callout>
        <p className="text-body text-text-muted">
          A project holds one fluid system and its results. Create one, then add a STEP file of the
          assembly.
        </p>
        <Button variant="primary" onClick={onNew}>
          <Plus />
          New project
        </Button>
      </div>
    </div>
  )
}

export function ProjectsScreen({
  projects,
  onOpen
}: {
  projects: readonly Project[]
  onOpen: (project: Project) => void
}): React.JSX.Element {
  // Project creation arrives in a later phase; the button is the visual entry point.
  const onNew = (): void => {}
  const empty = projects.length === 0

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-8 py-6">
      <div className="flex h-8 shrink-0 items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="mono-label text-text">Projects</h1>
          <span className="num text-text-muted">{String(projects.length).padStart(2, '0')}</span>
        </div>
        {empty ? null : (
          <Button variant="primary" onClick={onNew}>
            <Plus />
            New project
          </Button>
        )}
      </div>
      {empty ? (
        <EmptyProjects onNew={onNew} />
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
