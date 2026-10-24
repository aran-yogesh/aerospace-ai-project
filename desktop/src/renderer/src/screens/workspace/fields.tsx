import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { inputText } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Numeric input that commits on Enter or blur (not per keystroke), so each committed value
 * is one PUT. Resyncs when the value it shows changes (server answer or unit switch).
 */
export function NumberField({
  value,
  onCommit,
  className,
  ...props
}: {
  value: number | null
  onCommit: (n: number) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>): React.JSX.Element {
  const shown = value == null ? '' : inputText(value)
  const [text, setText] = useState(shown)
  const [prev, setPrev] = useState(shown)
  if (prev !== shown) {
    setPrev(shown)
    setText(shown)
  }
  const n = Number(text)
  const invalid = text.trim() !== '' && !Number.isFinite(n)
  const commit = (): void => {
    if (text.trim() === '' || invalid || inputText(n) === shown) return
    onCommit(n)
  }
  return (
    <Input
      {...props}
      inputMode="decimal"
      value={text}
      aria-invalid={invalid || undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        props.onKeyDown?.(e)
      }}
      className={cn('num', invalid && 'border-danger focus-visible:border-danger', className)}
    />
  )
}

/** Native <select> restyled to the Input look (square, hairline, mono), with a chevron. */
export function NativeSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <span className={cn('relative flex min-w-0', className)}>
      <select
        {...props}
        className={cn(
          'h-8 w-full min-w-0 appearance-none text-ellipsis border border-border bg-bg pr-8 pl-3 mono-label text-text',
          'transition-colors duration-120 ease-out outline-none focus-visible:border-accent',
          'disabled:cursor-not-allowed disabled:opacity-60'
        )}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        strokeWidth={1.5}
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-text-muted"
      />
    </span>
  )
}

/** Mono field label. */
export function FieldLabel({
  htmlFor,
  children
}: {
  htmlFor?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label htmlFor={htmlFor} className="mono-label text-text-muted">
      {children}
    </label>
  )
}

/** Small boxed source tag: truncated, full text on hover. */
export function SourceTag({
  source,
  title,
  className
}: {
  source: string | null | undefined
  /** Full tooltip text; defaults to the source. */
  title?: string
  className?: string
}): React.JSX.Element | null {
  if (!source) return null
  return (
    <span
      title={title || source}
      data-testid="source-tag"
      className={cn(
        'inline-block max-w-full truncate border border-border px-1 mono-label text-text-muted',
        className
      )}
    >
      {source}
    </span>
  )
}
