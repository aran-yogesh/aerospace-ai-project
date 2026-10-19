import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import styles from './Splitter.module.css'

export interface SplitterProps {
  /** 'vertical' = a vertical bar that resizes horizontally (columns). */
  orientation: 'vertical' | 'horizontal'
  /** Current size (px) of the pane this splitter controls. */
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  /** +1 if dragging right/down grows the pane, -1 if it shrinks it. */
  direction?: 1 | -1
  label: string
  /** id of the pane being resized (for aria-controls). */
  controls?: string
  step?: number
}

/** Accessible window splitter (WAI-ARIA "separator" pattern) with pointer + keyboard. */
export function Splitter({
  orientation,
  value,
  min,
  max,
  onChange,
  direction = 1,
  label,
  controls,
  step = 16
}: SplitterProps): React.JSX.Element {
  const start = useRef<{ pos: number; value: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const clamp = (v: number): number => Math.min(max, Math.max(min, v))
  const axis = (e: PointerEvent): number => (orientation === 'vertical' ? e.clientX : e.clientY)

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    start.current = { pos: axis(e), value }
    setDragging(true)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    if (!start.current) return
    onChange(clamp(start.current.value + (axis(e) - start.current.pos) * direction))
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>): void {
    if (!start.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    start.current = null
    setDragging(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const grow = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
    const shrink = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
    const delta = e.shiftKey ? step * 4 : step
    let next: number | null = null
    if (e.key === grow) next = value + delta * direction
    else if (e.key === shrink) next = value - delta * direction
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    if (next === null) return
    e.preventDefault()
    onChange(clamp(next))
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      // ARIA: a vertical separator separates columns.
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      className={[styles.splitter, styles[orientation], dragging ? styles.dragging : '']
        .filter(Boolean)
        .join(' ')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  )
}
