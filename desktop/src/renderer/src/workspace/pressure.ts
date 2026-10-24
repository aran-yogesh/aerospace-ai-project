/*
 * Pressure coloring: each component's ΔP mapped onto the five --pressure-1..5 tokens by
 * quantile bins over the components with nonzero loss. Zero-loss (or unknown) parts get
 * no entry and stay base gray. Pure, with no imports, so scripts/phase2.ts can self-check it.
 */
export const PRESSURE_STEPS = 5

export interface PressureBins {
  /** component id -> token name ("--pressure-1".."--pressure-5"). */
  colors: Record<string, string>
  min: number
  max: number
}

export function pressureBins(
  segments: readonly { component_id: string; dp_pa: number | null }[]
): PressureBins | null {
  const lossy = segments.filter((s) => s.dp_pa != null && s.dp_pa > 0)
  if (lossy.length === 0) return null
  const sorted = lossy.map((s) => s.dp_pa ?? 0).sort((a, b) => a - b)
  const n = sorted.length
  const colors: Record<string, string> = {}
  for (const s of lossy) {
    // Rank of the first equal value, so ties share a bin. Ranks spread evenly over the
    // 5 steps: the smallest loss is always step 1 and the largest step 5, as the legend says.
    const rank = sorted.indexOf(s.dp_pa ?? 0)
    const bin = n === 1 ? PRESSURE_STEPS : Math.round((rank * (PRESSURE_STEPS - 1)) / (n - 1)) + 1
    colors[s.component_id] = `--pressure-${bin}`
  }
  return { colors, min: sorted[0] ?? 0, max: sorted[n - 1] ?? 0 }
}
