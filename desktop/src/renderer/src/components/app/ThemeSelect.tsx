import { SegmentedControl } from '@/components/ui/segmented-control'
import { useTheme } from '@/theme/useTheme'
import type { ThemeMode } from '../../../../shared/theme'

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' }
] as const satisfies readonly { value: ThemeMode; label: string }[]

export function ThemeSelect({ className }: { className?: string }): React.JSX.Element {
  const { mode, setMode } = useTheme()
  return (
    <SegmentedControl
      label="Theme"
      value={mode}
      onValueChange={setMode}
      options={OPTIONS}
      className={className}
    />
  )
}
