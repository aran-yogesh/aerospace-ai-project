import type { Component, ComponentType, SystemGraph } from '@/types/geometry'

/** Strip a trailing ".0" so 12.0 prints as 12. */
function trim(n: number, digits: number): string {
  const s = n.toFixed(digits)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

export const mm = (m: number): string => trim(m * 1000, 1)

export const diameter = (m: number): string => `Ø${mm(m)} MM`

export function meters(m: number): string {
  return `${m.toFixed(m >= 0.1 ? 2 : 3)} M`
}

export const degrees = (deg: number): string => `${trim(deg, 1)}°`

export const rOverD = (v: number): string => `R/D ${v.toFixed(1)}`

export const TYPE_LABEL: Record<ComponentType, string> = {
  pipe: 'Pipe',
  bend: 'Bend',
  transition: 'Transition',
  valve: 'Valve',
  unclassified: 'Unclassified'
}

/** "SWAGELOK BALLVALVE · CV 12", falling back to the part name. */
function valveText(c: Extract<Component, { type: 'valve' }>): string {
  const head = [c.vendor, c.valve_type].filter(Boolean).join(' ') || c.name
  const parts = [head.replace(/_/g, ' ')]
  if (c.cv != null) parts.push(`CV ${trim(c.cv, 2)}`)
  return parts.join(' · ').toUpperCase()
}

/** Key dimensions for a components-pane row. */
export function componentDims(c: Component): string {
  switch (c.type) {
    case 'pipe':
      return `${diameter(c.inner_diameter_m)} · ${meters(c.length_m)}`
    case 'bend':
      return `${diameter(c.inner_diameter_m)} · ${degrees(c.angle_deg)} · ${rOverD(c.r_over_d)}`
    case 'transition':
      return `Ø${mm(c.d_in_m)}→${mm(c.d_out_m)} MM · ${meters(c.length_m)}`
    case 'valve':
      return valveText(c)
    case 'unclassified':
      return c.name.toUpperCase()
  }
}

/** On-canvas callout text, e.g. "BEND 90° · Ø12 MM · R/D 2.0". */
export function calloutText(c: Component): string {
  switch (c.type) {
    case 'pipe':
      return `PIPE · ${diameter(c.inner_diameter_m)} · ${meters(c.length_m)}`
    case 'bend':
      return `BEND ${degrees(c.angle_deg)} · ${diameter(c.inner_diameter_m)} · ${rOverD(c.r_over_d)}`
    case 'transition':
      return `TRANSITION · Ø${mm(c.d_in_m)}→${mm(c.d_out_m)} MM · ${c.kind.toUpperCase()}`
    case 'valve':
      return `VALVE · ${valveText(c)}`
    case 'unclassified':
      return `UNCLASSIFIED · ${c.name.toUpperCase()}`
  }
}

/** Short schematic label under a symbol: [type, dimension]. */
export function schematicLabel(c: Component): [string, string] {
  switch (c.type) {
    case 'pipe':
      return ['PIPE', meters(c.length_m)]
    case 'bend':
      return ['BEND', degrees(c.angle_deg)]
    case 'transition':
      return ['TRANS', `Ø${mm(c.d_in_m)}→${mm(c.d_out_m)}`]
    case 'valve':
      return ['VALVE', c.cv != null ? `CV ${trim(c.cv, 2)}` : '—']
    case 'unclassified':
      return ['UNCL', c.name.toUpperCase().slice(0, 10)]
  }
}

/** Components in display order: ordered_path for lines, otherwise grouped by type. */
export function orderedComponents(graph: SystemGraph): Component[] {
  const byId = new Map(graph.components.map((c) => [c.id, c]))
  if (graph.topology === 'line' && graph.ordered_path) {
    const ordered = graph.ordered_path.flatMap((id) => {
      const c = byId.get(id)
      return c ? [c] : []
    })
    // Anything not on the path (should not happen for a line) goes last.
    const rest = graph.components.filter((c) => !graph.ordered_path?.includes(c.id))
    return [...ordered, ...rest]
  }
  const order: ComponentType[] = ['pipe', 'bend', 'transition', 'valve', 'unclassified']
  return [...graph.components].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function seconds(s: number): string {
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} S`
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Human error text for a structured {"error", "detail"} pair. */
export function errorTitle(code: string): string {
  const known: Record<string, string> = {
    unsupported_file_type: 'Unsupported file type',
    file_too_large: 'File too large',
    not_step_file: 'Not a STEP file',
    not_found: 'Not found',
    timeout: 'Parser timed out',
    out_of_memory: 'Parser ran out of memory',
    parser_crashed: 'Parser crashed',
    network_error: 'Backend unreachable',
    mesh_invalid: 'Model could not be displayed'
  }
  return known[code] ?? code.replace(/_/g, ' ')
}
