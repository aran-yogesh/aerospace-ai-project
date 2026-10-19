import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import type { Project } from '@/lib/apiTypes'
import { errorTitle } from '@/lib/format'

const MAX_NAME = 200

/** NEW PROJECT: name it, create it (POST /projects), then open its workspace. */
export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: Project) => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: (n: string) => api.createProject(n),
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      setName('')
      onOpenChange(false)
      onCreated(project)
    }
  })

  const trimmed = name.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= MAX_NAME
  const error = create.error
  const errorText =
    error instanceof ApiError
      ? (error.detail ?? errorTitle(error.code))
      : error
        ? String(error)
        : null

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (valid && !create.isPending) create.mutate(trimmed)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) create.reset()
        onOpenChange(o)
      }}
    >
      <DialogContent title="New project" data-testid="new-project-dialog">
        <DialogDescription className="sr-only">Name the new project.</DialogDescription>
        <form onSubmit={submit}>
          <div className="flex flex-col gap-2 px-4 py-4">
            <label htmlFor="project-name" className="mono-label text-text">
              Name
            </label>
            <Input
              id="project-name"
              autoFocus
              value={name}
              maxLength={MAX_NAME}
              placeholder="e.g. Coolant loop A"
              onChange={(e) => setName(e.target.value)}
              data-testid="project-name-input"
              aria-invalid={errorText ? true : undefined}
            />
            {errorText ? (
              <p role="alert" className="text-body text-danger">
                {errorText}
              </p>
            ) : (
              <p className="text-body text-text-muted">
                A project holds one fluid system. Add its STEP file next.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              disabled={!valid || create.isPending}
              data-testid="create-project"
            >
              {create.isPending ? 'Creating' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
