import type { SystemGraph } from '@/types/geometry'
import { plural } from '@/lib/format'

export interface GraphWarning {
  key: string
  text: string
  /** Components a click on the warning selects (cycled on repeated clicks). */
  targets: string[]
}

function degrees(graph: SystemGraph): Map<string, number> {
  const deg = new Map<string, number>()
  for (const [a, b] of graph.edges) {
    deg.set(a, (deg.get(a) ?? 0) + 1)
    deg.set(b, (deg.get(b) ?? 0) + 1)
  }
  return deg
}

/** Warnings block content, most important first. */
export function deriveWarnings(graph: SystemGraph): GraphWarning[] {
  const out: GraphWarning[] = []
  const unclassified = graph.components.filter((c) => c.type === 'unclassified').map((c) => c.id)
  if (unclassified.length > 0) {
    out.push({
      key: 'unclassified',
      text: `${plural(unclassified.length, 'part', 'parts')} unclassified`,
      targets: unclassified
    })
  }
  if (graph.topology === 'network') {
    const deg = degrees(graph)
    const junctions = graph.components.filter((c) => (deg.get(c.id) ?? 0) > 2).map((c) => c.id)
    out.push({
      key: 'network',
      text: 'Network topology: single-path solve not available',
      targets: junctions
    })
  }
  for (const [i, w] of graph.warnings.entries()) {
    if (/flow direction assumed/i.test(w)) {
      out.push({
        key: 'flow',
        text: 'Flow direction assumed',
        targets: graph.inlet_id ? [graph.inlet_id] : []
      })
    } else if (/unclassified/i.test(w) && unclassified.length > 0) {
      continue // already summarised above
    } else if (/network/i.test(w) && graph.topology === 'network') {
      continue
    } else {
      out.push({ key: `graph-${i}`, text: w, targets: [] })
    }
  }
  // Per-component warnings, deduplicated by text.
  const byText = new Map<string, string[]>()
  for (const c of graph.components) {
    for (const w of c.warnings) byText.set(w, [...(byText.get(w) ?? []), c.id])
  }
  for (const [text, ids] of byText) {
    out.push({
      key: `comp-${text}`,
      text: ids.length > 1 ? `${text} (${ids.length})` : text,
      targets: ids
    })
  }
  return out
}
