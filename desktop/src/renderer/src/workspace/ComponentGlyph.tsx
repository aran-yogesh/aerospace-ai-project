import type { ComponentType } from '@/types/geometry'
import { cn } from '@/lib/utils'

/**
 * 16px engineering glyphs, the same vocabulary as the schematic: pipe = line,
 * bend = arc, transition = trapezoid, valve = bowtie, unclassified = dashed box.
 */
export function ComponentGlyph({
  type,
  className
}: {
  type: ComponentType
  className?: string
}): React.JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cn('size-4 shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinejoin="miter"
    >
      {type === 'pipe' ? <path d="M2 8H14M2 5.5V10.5M14 5.5V10.5" /> : null}
      {type === 'bend' ? <path d="M3 14V9.5A6.5 6.5 0 0 1 9.5 3H14" /> : null}
      {type === 'transition' ? <path d="M2.5 3.5L13.5 6V10L2.5 12.5Z" /> : null}
      {type === 'valve' ? <path d="M2.5 4L13.5 12V4L2.5 12Z" /> : null}
      {type === 'unclassified' ? (
        <rect x={2.5} y={3.5} width={11} height={9} strokeDasharray="2 1.5" />
      ) : null}
    </svg>
  )
}
