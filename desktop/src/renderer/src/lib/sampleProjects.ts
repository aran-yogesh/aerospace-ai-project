/** Static sample data for Phase 0. There is no project storage yet. */
export interface Project {
  id: string
  name: string
  file: string
  /** ISO date (YYYY-MM-DD). */
  updated: string
  components: number
}

export const SAMPLE_PROJECTS: readonly Project[] = [
  {
    id: 'coolant-loop-a',
    name: 'Coolant Loop A',
    file: 'coolant_loop_a.step',
    updated: '2026-10-14',
    components: 42
  },
  {
    id: 'hx-manifold-rev-c',
    name: 'HX Manifold Rev C',
    file: 'hx_manifold_rev_c.step',
    updated: '2026-10-09',
    components: 17
  },
  {
    id: 'hydraulic-test-rig',
    name: 'Hydraulic Test Rig',
    file: 'test_rig_assembly.step',
    updated: '2026-09-28',
    components: 86
  }
]

export function findProject(id: string): Project | undefined {
  return SAMPLE_PROJECTS.find((p) => p.id === id)
}
