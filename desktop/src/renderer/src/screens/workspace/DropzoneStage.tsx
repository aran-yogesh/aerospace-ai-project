import { Upload } from 'lucide-react'
import { Callout, LeaderLines, type LeaderLine } from '@/components/ui/callout'

/*
 * Empty viewer: a dashed dropzone (visual only, no upload logic) annotated like a
 * drawing. Fixed-size stage so the leader lines land exactly on the dropzone edge.
 */
// The stage is symmetric about the dropzone so the dropzone sits dead center in the viewer.
const STAGE = { w: 760, h: 340 }
const ZONE = { x: 200, y: 50, w: 360, h: 240 }
const ZONE_RIGHT = ZONE.x + ZONE.w
const CALLOUT_X = 640 // left edge of each callout box; its 6px marker sits just left of it
const SHOULDER_X = 608

const CALLOUTS = [
  { label: 'STEP', y: 74, targetY: 110 },
  { label: 'IGES', y: 170, targetY: 170 },
  { label: 'STL (later)', y: 266, targetY: 230 }
] as const

const LINES: LeaderLine[] = CALLOUTS.map((c) => ({
  points: [
    [CALLOUT_X - 7, c.y],
    [SHOULDER_X, c.y],
    [ZONE_RIGHT, c.targetY]
  ]
}))

export function DropzoneStage(): React.JSX.Element {
  return (
    <div
      data-testid="dropzone-stage"
      className="relative shrink-0"
      style={{ width: STAGE.w, height: STAGE.h }}
    >
      <div
        className="absolute flex flex-col items-center justify-center gap-4 border border-dashed border-text-muted bg-bg"
        style={{ left: ZONE.x, top: ZONE.y, width: ZONE.w, height: ZONE.h }}
      >
        <Upload aria-hidden className="size-4 text-text-muted" strokeWidth={1.5} />
        <Callout variant="filled">Drop a STEP file</Callout>
        <p className="text-body text-text-muted">Your assembly opens here.</p>
      </div>
      <LeaderLines width={STAGE.w} height={STAGE.h} lines={LINES} />
      {CALLOUTS.map((c) => (
        <Callout
          key={c.label}
          className="absolute -translate-y-1/2"
          style={{ left: CALLOUT_X, top: c.y }}
        >
          {c.label}
        </Callout>
      ))}
    </div>
  )
}
