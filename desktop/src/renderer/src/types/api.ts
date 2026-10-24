// GENERATED FILE: do not edit. Source: backend/app/schema/api.py, solve.py
// Regenerate with `make types`.

import type { ParseError } from './geometry'

export interface ConstantsVersions {
  k_values: string
  materials: string
  fluids: string
}

export interface Dataset {
  id: string
  file_id: string
  content_hash: string
  /** First 4 hex digits of content_hash, upper case. */
  short_hash: string
  created_at: string
  stale: boolean
  graph_hash: string
  setup: SetupIn
  resolved_k: KRow[]
  segments: SegmentInput[]
  fluid_props: FluidProps
  roughness: Provenanced
  constants_versions: ConstantsVersions
  solver_version: string
}

export interface DatasetRef {
  id: string
  short_hash: string
  content_hash: string
  created_at: string
  stale: boolean
}

export interface FileInfo {
  id: string
  project_id: string
  filename: string
  size_bytes: number
  status: 'uploaded' | 'parsing' | 'parsed' | 'failed'
  /** Set when status is failed. */
  error: ParseError | null
  parser_version: string | null
  parse_seconds: number | null
  component_count: number | null
  created_at: string
}

/** Pushed on /ws/files/{id} on connect and on every status change. */
export interface FileStatusEvent {
  file_id: string
  status: 'uploaded' | 'parsing' | 'parsed' | 'failed'
  error: ParseError | null
  parse_seconds: number | null
  component_count: number | null
}

export interface FluidIn {
  kind: 'coolprop' | 'table' | 'custom'
  name: string
  temperature_k: number | null
  pressure_pa: number | null
  /** Custom fluid only. */
  density_kg_m3: number | null
  /** Custom fluid only. */
  viscosity_pa_s: number | null
}

export interface FluidInfo {
  name: string
  kind: 'coolprop' | 'table' | 'custom'
  group: 'CRYOGENIC' | 'PROPELLANT' | 'REFERENCE' | 'CUSTOM'
  t_min_k: number | null
  t_max_k: number | null
  source: string
}

export interface FluidList {
  items: FluidInfo[]
}

export interface FluidProps {
  name: string
  density_kg_m3: Provenanced
  viscosity_pa_s: Provenanced
}

export interface KCounts {
  computed: number
  exact: number
  family: number
  user: number
  missing: number
}

export interface KOverride {
  value: number
  note: string | null
}

export interface KRow {
  component_id: string
  type: 'pipe' | 'bend' | 'transition' | 'valve' | 'unclassified'
  label: string
  k: number | null
  k_ref_d_m: number | null
  method: string | null
  source: string | null
  match: 'exact' | 'family' | 'computed' | 'user' | 'missing'
  /** Table entries only: has Rohith verified it? */
  verified: boolean | null
  note: string | null
}

export interface MaterialInfo {
  key: string
  label: string
  roughness_m: number
  source: string
}

export interface MaterialList {
  version: string
  items: MaterialInfo[]
}

export interface Project {
  id: string
  name: string
  created_at: string
  latest_file: FileInfo | null
}

export interface ProjectCreate {
  name: string
}

export interface ProjectDetail {
  id: string
  name: string
  created_at: string
  latest_file: FileInfo | null
  /** Newest first. */
  files: FileInfo[]
}

export interface ProjectList {
  /** Newest first. */
  items: Project[]
}

export interface PropsError {
  error: 'not_liquid' | 'out_of_range' | 'unknown_fluid' | 'invalid_input'
  detail: string
}

/** A number with where it came from: a formula, a table entry, or a user input. */
export interface Provenanced {
  value: number
  unit: string
  source: string
}

export interface ResolveResult {
  /** Path order. */
  rows: KRow[]
  counts: KCounts
}

/** One item of ordered_path, ready to solve. Pipes need length; everything else needs a K. */
export interface SegmentInput {
  component_id: string
  type: 'pipe' | 'bend' | 'transition' | 'valve' | 'unclassified'
  /** Flow diameter for velocity and Re. */
  d_m: number | null
  /** Path length along the centerline (plot x). */
  length_m: number
  /** Resolved loss coefficient. */
  k: number | null
  /** Diameter K is referenced to. */
  k_ref_d_m: number | null
  k_source: string | null
  k_match: 'exact' | 'family' | 'computed' | 'user' | 'missing' | null
}

export interface SegmentResult {
  component_id: string
  type: 'pipe' | 'bend' | 'transition' | 'valve' | 'unclassified'
  d_m: number | null
  velocity_m_s: number | null
  re: number | null
  regime: 'laminar' | 'transitional' | 'turbulent' | null
  /** Darcy friction factor (pipes and bends). */
  f: number | null
  k: number | null
  k_source: string | null
  k_match: 'exact' | 'family' | 'computed' | 'user' | 'missing' | null
  dp_pa: number | null
  /** Gauge pressure after this segment, inlet = 0. */
  p_after_pa: number | null
  x_start_m: number
  x_end_m: number
  warnings: string[]
}

export interface SetupIn {
  fluid: FluidIn
  material_key: string
  k_overrides: Record<string, KOverride | 'no_loss'>
}

export interface SetupView {
  fluid: FluidIn
  material_key: string
  k_overrides: Record<string, KOverride | 'no_loss'>
  /** Null until the setup is first saved. */
  updated_at: string | null
  props: FluidProps | null
  roughness: Provenanced | null
  props_error: PropsError | null
  latest_dataset: DatasetRef | null
}

export interface SolveIn {
  /** dp: input is mdot in kg/s. flow: input is dP in Pa. */
  mode: 'dp' | 'flow'
  value: number
}

export interface SolveResult {
  status: 'complete' | 'incomplete'
  mode: 'dp' | 'flow'
  /** Input in dp mode, solved in flow mode. */
  mdot_kg_s: number | null
  /** Only present when status is complete. */
  total_dp_pa: number | null
  segments: SegmentResult[]
  /** Why it's incomplete. */
  missing: string[]
  warnings: string[]
  solver_version: string
}

export interface SolveRun {
  id: string
  dataset_id: string
  mode: 'dp' | 'flow'
  input_value: number
  status: 'complete' | 'incomplete'
  result: SolveResult
  runtime_ms: number
  created_at: string
}

export type FileStatus = FileInfo['status']

export type KMatch = KRow['match']

export type SolveMode = SolveIn['mode']
