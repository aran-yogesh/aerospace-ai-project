// GENERATED FILE: do not edit. Source: backend/app/schema/geometry.py
// Regenerate with `make types`.

export interface Bend {
  id: string
  confidence: number
  warnings: string[]
  /** Indices of wetted B-rep faces. */
  face_ids: number[]
  type: 'bend'
  inner_diameter_m: number
  angle_deg: number
  /** Centerline radius (torus major radius). */
  bend_radius_m: number
  /** bend_radius_m / inner_diameter_m. */
  r_over_d: number
}

/** Returned by the parser instead of raising. Same shape as API errors. */
export interface ParseError {
  error: string
  detail: string | null
}

export interface Pipe {
  id: string
  confidence: number
  warnings: string[]
  /** Indices of wetted B-rep faces. */
  face_ids: number[]
  type: 'pipe'
  inner_diameter_m: number
  length_m: number
}

export interface SystemGraph {
  units: 'm'
  components: (Pipe | Bend | Transition | Valve | Unclassified)[]
  edges: [string, string][]
  inlet_id: string | null
  outlet_id: string | null
  ordered_path: string[] | null
  topology: 'line' | 'network' | 'disconnected'
  warnings: string[]
  parser_version: string
}

export interface Transition {
  id: string
  confidence: number
  warnings: string[]
  /** Indices of wetted B-rep faces. */
  face_ids: number[]
  type: 'transition'
  d_in_m: number
  d_out_m: number
  /** Axial length, not slant length. */
  length_m: number
  half_angle_deg: number
  kind: 'contraction' | 'expansion' | 'unknown'
}

export interface Unclassified {
  id: string
  confidence: number
  warnings: string[]
  /** Indices of wetted B-rep faces. */
  face_ids: number[]
  type: 'unclassified'
  name: string
  reason: string
  part_path: string
}

export interface Valve {
  id: string
  confidence: number
  warnings: string[]
  /** Indices of wetted B-rep faces. */
  face_ids: number[]
  type: 'valve'
  name: string
  vendor: string | null
  valve_type: string | null
  cv: number | null
  /** Assembly path of the part, e.g. /feed_line/valve. */
  part_path: string
}

export type Component = Pipe | Bend | Transition | Valve | Unclassified

export type ComponentType = Component['type']
