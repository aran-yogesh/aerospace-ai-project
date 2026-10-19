import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

/**
 * Single-choice segmented control on Radix ToggleGroup. Boxed, hairline dividers;
 * the selected segment is raised with text color and a 2px accent bottom bar.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className
}: {
  value: T
  onValueChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  /** Accessible name for the group. */
  label: string
  className?: string
}): React.JSX.Element {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      onValueChange={(next) => {
        // Radix allows deselecting; a segmented control always has a value.
        if (next) onValueChange(next as T)
      }}
      className={cn('inline-flex h-6 items-stretch border border-border', className)}
    >
      {options.map((opt) => (
        <ToggleGroup.Item
          key={opt.value}
          value={opt.value}
          className={cn(
            'relative flex items-center px-2.5 mono-label text-text-muted',
            'border-l border-border first:border-l-0',
            'transition-colors duration-120 ease-out hover:text-text',
            'focus-visible:outline-offset-[-3px]',
            "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-transparent after:content-['']",
            'data-[state=on]:bg-surface-raised data-[state=on]:text-text data-[state=on]:after:bg-accent'
          )}
        >
          {opt.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
