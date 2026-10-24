import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { API_URL } from '@/lib/config'
import { useSetUnits } from '@/lib/units'
import { ThemeSelect } from './ThemeSelect'

const UNIT_OPTIONS = [
  { value: 'SI', label: 'SI' },
  { value: 'US', label: 'US' }
] as const

/** Settings: theme, display units and the backend URL. */
export function SettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { units, setUnits } = useSetUnits()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Settings" data-testid="settings-dialog">
        <DialogDescription className="sr-only">
          Choose the app theme and display units, and see which backend the app talks to.
        </DialogDescription>
        <div className="flex flex-col">
          <section className="flex items-center justify-between gap-4 border-b border-border px-4 py-4">
            <div className="flex flex-col gap-1">
              <h3 className="mono-label text-text">Theme</h3>
              <p className="text-body text-text-muted">Auto follows the system appearance.</p>
            </div>
            <ThemeSelect />
          </section>
          <section className="flex items-center justify-between gap-4 border-b border-border px-4 py-4">
            <div className="flex flex-col gap-1">
              <h3 className="mono-label text-text">Units</h3>
              <p className="text-body text-text-muted">
                Display only. The backend always works in SI.
              </p>
            </div>
            <SegmentedControl
              label="Units"
              value={units}
              onValueChange={setUnits}
              options={UNIT_OPTIONS}
            />
          </section>
          <section className="flex flex-col gap-2 px-4 py-4">
            <label htmlFor="backend-url" className="mono-label text-text">
              Backend URL
            </label>
            <Input id="backend-url" readOnly value={API_URL} aria-readonly />
            <p className="text-body text-text-muted">Set with VITE_API_URL at build time.</p>
          </section>
        </div>
        <div className="flex justify-end border-t border-border px-4 py-3">
          <DialogClose asChild>
            <Button variant="primary">Done</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
