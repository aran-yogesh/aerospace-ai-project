import type { Component, ComponentType, SystemGraph } from '@/types/geometry'

/*
 * The one display-formatting module. Everything the UI prints goes through here; the
 * API is always SI. `UnitSystem` (Settings: SI | US) picks the display units.
 */
export type UnitSystem = 'SI' | 'US'

/** Strip a trailing ".0" so 12.0 prints as 12. */
function trim(n: number, digits: number): string {
  const s = n.toFixed(digits)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** `digits` significant figures, trailing zeros kept (tables line up); E notation outside 1e-3..1e6. */
export function sig(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1e6 || a < 1e-3) return n.toExponential(digits - 1).replace(/e\+?/, 'E')
  return n.toFixed(Math.max(0, digits - 1 - Math.floor(Math.log10(a))))
}

type Kind =
  'pressure' | 'flow' | 'length' | 'diameter' | 'velocity' | 'density' | 'viscosity' | 'roughness'

/** [unit label, multiply SI by this] per kind and system. */
const DISPLAY: Record<Kind, Record<UnitSystem, readonly [string, number]>> = {
  pressure: { SI: ['kPa', 1e-3], US: ['psi', 1 / 6894.757293168] },
  flow: { SI: ['kg/s', 1], US: ['lbm/s', 1 / 0.45359237] },
  length: { SI: ['m', 1], US: ['ft', 1 / 0.3048] },
  diameter: { SI: ['mm', 1e3], US: ['in', 1 / 0.0254] },
  velocity: { SI: ['m/s', 1], US: ['ft/s', 1 / 0.3048] },
  density: { SI: ['kg/m³', 1], US: ['lbm/ft³', 0.3048 ** 3 / 0.45359237] },
  // 1 mPa·s = 1 cP: US engineering practice quotes viscosity in centipoise.
  viscosity: { SI: ['mPa·s', 1e3], US: ['cP', 1e3] },
  roughness: { SI: ['µm', 1e6], US: ['in', 1 / 0.0254] }
}

export const unitOf = (kind: Kind, u: UnitSystem): string => DISPLAY[kind][u][0]

/** SI value -> display value (number) in the chosen system. */
export const toDisplay = (kind: Kind, si: number, u: UnitSystem): number => si * DISPLAY[kind][u][1]

/** Display value typed by the user -> SI. */
export const fromDisplay = (kind: Kind, v: number, u: UnitSystem): number => v / DISPLAY[kind][u][1]

/** "12.3" (no unit), for table cells under a unit header. */
export const qty = (
  kind: Kind,
  si: number | null | undefined,
  u: UnitSystem,
  digits = 3
): string => (si == null ? '—' : sig(toDisplay(kind, si, u), digits))

/** "12.3 kPa". */
export const withUnit = (kind: Kind, si: number | null | undefined, u: UnitSystem): string =>
  si == null ? '—' : `${qty(kind, si, u)} ${unitOf(kind, u)}`

/** Geometry dims (Phase 1 style, uppercase): "Ø12 MM" / "Ø0.472 IN". */
export const diameter = (m: number, u: UnitSystem): string =>
  u === 'SI' ? `Ø${trim(m * 1000, 1)} MM` : `Ø${trim(m / 0.0254, 3)} IN`

export function meters(m: number, u: UnitSystem): string {
  if (u === 'US') return `${(m / 0.3048).toFixed(m >= 0.1 ? 2 : 3)} FT`
  return `${m.toFixed(m >= 0.1 ? 2 : 3)} M`
}

/** "Ø16→10 MM" / "Ø0.63→0.394 IN". */
function diameters(a: number, b: number, u: UnitSystem): string {
  return u === 'SI'
    ? `Ø${trim(a * 1000, 1)}→${trim(b * 1000, 1)} MM`
    : `Ø${trim(a / 0.0254, 3)}→${trim(b / 0.0254, 3)} IN`
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
export function componentDims(c: Component, u: UnitSystem): string {
  switch (c.type) {
    case 'pipe':
      return `${diameter(c.inner_diameter_m, u)} · ${meters(c.length_m, u)}`
    case 'bend':
      return `${diameter(c.inner_diameter_m, u)} · ${degrees(c.angle_deg)} · ${rOverD(c.r_over_d)}`
    case 'transition':
      return `${diameters(c.d_in_m, c.d_out_m, u)} · ${meters(c.length_m, u)}`
    case 'valve':
      return valveText(c)
    case 'unclassified':
      return c.name.toUpperCase()
  }
}

/** On-canvas callout text, e.g. "BEND 90° · Ø12 MM · R/D 2.0". */
export function calloutText(c: Component, u: UnitSystem): string {
  switch (c.type) {
    case 'pipe':
      return `PIPE · ${diameter(c.inner_diameter_m, u)} · ${meters(c.length_m, u)}`
    case 'bend':
      return `BEND ${degrees(c.angle_deg)} · ${diameter(c.inner_diameter_m, u)} · ${rOverD(c.r_over_d)}`
    case 'transition':
      return `TRANSITION · ${diameters(c.d_in_m, c.d_out_m, u)} · ${c.kind.toUpperCase()}`
    case 'valve':
      return `VALVE · ${valveText(c)}`
    case 'unclassified':
      return `UNCLASSIFIED · ${c.name.toUpperCase()}`
  }
}

/** Short schematic label under a symbol: [type, dimension]. */
export function schematicLabel(c: Component, u: UnitSystem): [string, string] {
  switch (c.type) {
    case 'pipe':
      return ['PIPE', meters(c.length_m, u)]
    case 'bend':
      return ['BEND', degrees(c.angle_deg)]
    case 'transition':
      return ['TRANS', diameters(c.d_in_m, c.d_out_m, u).replace(/ (MM|IN)$/, '')]
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

// ---- Phase 2: input units (values typed by the user, converted to SI for the API)

/** Unit label -> SI factor. Inputs offer every unit; the default follows the system. */
export const FLOW_UNITS = { 'kg/s': 1, 'lbm/s': 0.45359237 } as const
export const DP_UNITS = { bar: 1e5, psi: 6894.757293168, kPa: 1e3 } as const
export const PRESSURE_UNITS = { bar: 1e5, psi: 6894.757293168 } as const
export type FlowUnit = keyof typeof FLOW_UNITS
export type DpUnit = keyof typeof DP_UNITS
export type PressureUnit = keyof typeof PRESSURE_UNITS
export type TempUnit = 'K' | '°C' | '°F'

export function toKelvin(v: number, unit: TempUnit): number {
  if (unit === 'K') return v
  if (unit === '°C') return v + 273.15
  return ((v - 32) * 5) / 9 + 273.15
}

export function fromKelvin(k: number, unit: TempUnit): number {
  if (unit === 'K') return k
  if (unit === '°C') return k - 273.15
  return ((k - 273.15) * 9) / 5 + 32
}

/** Input box text for a converted value: up to 4 decimals, no trailing zeros. */
export const inputText = (n: number): string => trim(n, 4)

/** Loss coefficient. */
export const kValue = (k: number | null | undefined): string => (k == null ? '—' : k.toFixed(3))

export const reynolds = (re: number | null | undefined): string =>
  re == null ? '—' : re >= 1e6 ? sig(re, 3) : Math.round(re).toString()

export const friction = (f: number | null | undefined): string => (f == null ? '—' : f.toFixed(4))

export const percent = (part: number, total: number): string =>
  total > 0 ? `${((part / total) * 100).toFixed(1)}` : '—'

/** Match tag text in the confirm sheet and the results table. */
export const MATCH_LABEL: Record<string, string> = {
  computed: 'CALC',
  exact: 'EXACT',
  family: 'APPROX',
  user: 'USER',
  missing: 'MISSING'
}

/** "5 COMPUTED · 1 APPROXIMATE · 1 MISSING" (zero counts left out). */
export function kCountsText(c: {
  computed: number
  exact: number
  family: number
  user: number
  missing: number
}): string {
  const parts: [number, string][] = [
    [c.computed, 'COMPUTED'],
    [c.exact, 'EXACT'],
    [c.family, 'APPROXIMATE'],
    [c.user, 'USER'],
    [c.missing, 'MISSING']
  ]
  return parts
    .filter(([n]) => n > 0)
    .map(([n, t]) => `${n} ${t}`)
    .join(' · ')
}
