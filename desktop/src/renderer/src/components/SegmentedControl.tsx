import { useRef, type KeyboardEvent } from 'react'
import styles from './SegmentedControl.module.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedControlProps<T extends string> {
  label: string
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

/**
 * Accessible single-select radiogroup (WAI-ARIA radio pattern): one tab stop,
 * arrow keys move and select, Home/End jump to the ends.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className
}: SegmentedControlProps<T>): React.JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )

  function select(index: number): void {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    refs.current[index]?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = options.length - 1
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        select(index === last ? 0 : index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        select(index === 0 ? last : index - 1)
        break
      case 'Home':
        event.preventDefault()
        select(0)
        break
      case 'End':
        event.preventDefault()
        select(last)
        break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={[styles.group, className].filter(Boolean).join(' ')}
    >
      {options.map((option, index) => {
        const checked = index === selectedIndex
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={styles.option}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
