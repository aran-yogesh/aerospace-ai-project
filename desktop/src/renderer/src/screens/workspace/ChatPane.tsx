import { SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PanelHeader } from '@/components/ui/panel-header'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function ChatPane({ projectName }: { projectName: string }): React.JSX.Element {
  return (
    <section aria-label="Chat" className="flex h-full flex-col bg-surface">
      <PanelHeader label="Chat" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4">
        <article className="flex flex-col gap-2">
          <header className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 bg-text-muted" />
            <span className="mono-label text-text-muted">Lemma</span>
          </header>
          <div className="flex flex-col gap-2 text-body text-text select-text">
            <p>
              Welcome to LemmaLab. This is the workspace for{' '}
              <span className="font-medium">{projectName}</span>.
            </p>
            <p>
              Chat arrives in a later phase. Then I can help you trace flow paths, check line sizes
              and explain where the pressure drop comes from.
            </p>
          </div>
        </article>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Disabled controls swallow pointer events, so the wrapper carries the tooltip. */}
          <div
            tabIndex={0}
            data-testid="chat-input"
            className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-3"
          >
            <Input disabled placeholder="Ask about your system" aria-label="Message" />
            <Button variant="secondary" size="icon" disabled aria-label="Send" className="size-8">
              <SendHorizontal />
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">Available in Phase 3</TooltipContent>
      </Tooltip>
    </section>
  )
}
